import { NextResponse } from "next/server";
import zipcodes from "zipcodes";
import type { Customer } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";

type RouteRequest = {
  customers?: Customer[];
  warehouseZip?: string;
  warehouseAddress?: string;
  startLatitude?: number;
  startLongitude?: number;
};

type OptimizationResult = {
  customers: Customer[];
  totalKm: number;
  unresolvedStops: number;
};

type RoutePoint = {
  customer: Customer;
  latitude: number;
  longitude: number;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function normalizeZip(zip: string): string {
  return zip.trim().slice(0, 5);
}

function getZipPoint(zip: string): { latitude: number; longitude: number } | null {
  const normalized = normalizeZip(zip);
  const lookup = zipcodes.lookup(normalized);
  if (!lookup) {
    return null;
  }
  return { latitude: lookup.latitude, longitude: lookup.longitude };
}

const geocodeCache = new Map<string, { latitude: number; longitude: number } | null>();

function extractZipFromAddress(address: string): string | null {
  const match = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? match[0].slice(0, 5) : null;
}

async function geocodeAddress(
  address: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const key = address.trim().toLowerCase();
  if (!key) {
    return null;
  }
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key) ?? null;
  }

  try {
    const endpoint = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      address,
    )}`;
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "Makro-Route/1.0" },
      cache: "no-store",
    });
    if (!response.ok) {
      geocodeCache.set(key, null);
      return null;
    }

    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const first = data[0];
    const latitude = first?.lat ? Number(first.lat) : Number.NaN;
    const longitude = first?.lon ? Number(first.lon) : Number.NaN;
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      geocodeCache.set(key, null);
      return null;
    }

    const point = { latitude, longitude };
    geocodeCache.set(key, point);
    return point;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}

function customerAddress(customer: Customer): string {
  return [
    customer.addressLine1,
    customer.city,
    customer.state,
    customer.zip,
    customer.country,
  ]
    .filter(Boolean)
    .join(", ");
}

async function getCustomerPoint(
  customer: Customer,
): Promise<{ latitude: number; longitude: number } | null> {
  const addressPoint = await geocodeAddress(customerAddress(customer));
  if (addressPoint) {
    return addressPoint;
  }
  return getZipPoint(customer.zip);
}

function routeDistance(
  route: RoutePoint[],
  startPoint?: { latitude: number; longitude: number } | null,
): number {
  if (route.length === 0) {
    return 0;
  }

  let total = 0;
  let prevLat = startPoint?.latitude ?? route[0].latitude;
  let prevLon = startPoint?.longitude ?? route[0].longitude;
  const startIndex = startPoint ? 0 : 1;

  for (let i = startIndex; i < route.length; i += 1) {
    const current = route[i];
    total += haversineKm(prevLat, prevLon, current.latitude, current.longitude);
    prevLat = current.latitude;
    prevLon = current.longitude;
  }

  return total;
}

async function drivingRouteDistanceKm(
  route: RoutePoint[],
  startPoint?: { latitude: number; longitude: number } | null,
): Promise<number> {
  if (route.length === 0) {
    return 0;
  }

  const coordinates: string[] = [];
  if (startPoint) {
    coordinates.push(`${startPoint.longitude},${startPoint.latitude}`);
  }
  for (const point of route) {
    coordinates.push(`${point.longitude},${point.latitude}`);
  }

  if (coordinates.length < 2) {
    return 0;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates.join(
    ";",
  )}?overview=false`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return routeDistance(route, startPoint);
    }
    const data = (await response.json()) as {
      routes?: Array<{ distance?: number }>;
    };
    const meters = data.routes?.[0]?.distance;
    if (typeof meters !== "number") {
      return routeDistance(route, startPoint);
    }
    return meters / 1000;
  } catch {
    return routeDistance(route, startPoint);
  }
}

function runTwoOpt(
  initialRoute: RoutePoint[],
  startPoint?: { latitude: number; longitude: number } | null,
): RoutePoint[] {
  if (initialRoute.length < 4 || initialRoute.length > 120) {
    return initialRoute;
  }

  let best = [...initialRoute];
  let bestDistance = routeDistance(best, startPoint);
  let improved = true;
  let iteration = 0;
  const maxIterations = 8;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration += 1;

    for (let i = 0; i < best.length - 2; i += 1) {
      for (let k = i + 1; k < best.length - 1; k += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];

        const candidateDistance = routeDistance(candidate, startPoint);
        if (candidateDistance + 1e-9 < bestDistance) {
          best = candidate;
          bestDistance = candidateDistance;
          improved = true;
        }
      }
    }
  }

  return best;
}

async function optimizeCustomers(
  customers: Customer[],
  warehouseZip?: string,
  warehouseAddress?: string,
  startLatitude?: number,
  startLongitude?: number,
): Promise<OptimizationResult> {
  if (customers.length <= 1) {
    const point = customers[0] ? getZipPoint(customers[0].zip) : null;
    const unresolvedStops = point ? 0 : customers.length;
    return { customers, totalKm: 0, unresolvedStops };
  }

  const withCoords: RoutePoint[] = [];
  const withoutCoords: Customer[] = [];

  const points = await Promise.all(
    customers.map(async (customer) => ({ customer, point: await getCustomerPoint(customer) })),
  );

  for (const entry of points) {
    if (!entry.point) {
      withoutCoords.push(entry.customer);
      continue;
    }
    withCoords.push({ customer: entry.customer, ...entry.point });
  }

  if (withCoords.length <= 1) {
    const orderedCustomers = [
      ...withCoords.map((item) => item.customer),
      ...withoutCoords,
    ];
    return {
      customers: orderedCustomers,
      totalKm: 0,
      unresolvedStops: withoutCoords.length,
    };
  }

  const explicitStartPoint =
    typeof startLatitude === "number" && typeof startLongitude === "number"
      ? { latitude: startLatitude, longitude: startLongitude }
      : null;
  const addressPoint = warehouseAddress ? await geocodeAddress(warehouseAddress) : null;
  const addressZip = warehouseAddress ? extractZipFromAddress(warehouseAddress) : null;
  const zipFallback = warehouseZip
    ? getZipPoint(warehouseZip)
    : addressZip
      ? getZipPoint(addressZip)
      : null;
  const warehousePoint = explicitStartPoint ?? addressPoint ?? zipFallback;
  let currentLat = warehousePoint?.latitude;
  let currentLon = warehousePoint?.longitude;

  if (currentLat === undefined || currentLon === undefined) {
    const latSum = withCoords.reduce((sum, item) => sum + item.latitude, 0);
    const lonSum = withCoords.reduce((sum, item) => sum + item.longitude, 0);
    currentLat = latSum / withCoords.length;
    currentLon = lonSum / withCoords.length;
  }

  const remaining = [...withCoords];
  const nearestNeighborRoute: RoutePoint[] = [];

  while (remaining.length > 0) {
    let closestIdx = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const distance = haversineKm(
        currentLat,
        currentLon,
        candidate.latitude,
        candidate.longitude,
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIdx = i;
      }
    }

    const [nextPoint] = remaining.splice(closestIdx, 1);
    nearestNeighborRoute.push(nextPoint);
    currentLat = nextPoint.latitude;
    currentLon = nextPoint.longitude;
  }

  const improvedRoute = runTwoOpt(nearestNeighborRoute, warehousePoint);
  const orderedCustomers = improvedRoute.map((point) => point.customer);
  const totalKm = await drivingRouteDistanceKm(improvedRoute, warehousePoint);

  return {
    customers: [...orderedCustomers, ...withoutCoords],
    totalKm,
    unresolvedStops: withoutCoords.length,
  };
}

export async function POST(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RouteRequest;
    const customers = Array.isArray(body.customers) ? body.customers : [];

    if (customers.length === 0) {
      return NextResponse.json({ customers: [], totalKm: 0, unresolvedStops: 0 });
    }

    const optimized = await optimizeCustomers(
      customers,
      body.warehouseZip,
      body.warehouseAddress,
      body.startLatitude,
      body.startLongitude,
    );
    return NextResponse.json(optimized);
  } catch {
    return NextResponse.json(
      { error: "Failed to optimize route" },
      { status: 500 },
    );
  }
}
