import { NextResponse } from "next/server";
import zipcodes from "zipcodes";
import type { Customer } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";

type DistanceRequest = {
  customers?: Customer[];
  warehouseZip?: string;
  warehouseAddress?: string;
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
  const lookup = zipcodes.lookup(normalizeZip(zip));
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

async function drivingDistanceKm(
  points: Array<{ latitude: number; longitude: number }>,
  startPoint?: { latitude: number; longitude: number } | null,
): Promise<{ distanceKm: number; durationSeconds: number } | null> {
  const coordinates: string[] = [];
  if (startPoint) {
    coordinates.push(`${startPoint.longitude},${startPoint.latitude}`);
  }
  for (const point of points) {
    coordinates.push(`${point.longitude},${point.latitude}`);
  }

  if (coordinates.length < 2) {
    return { distanceKm: 0, durationSeconds: 0 };
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates.join(
    ";",
  )}?overview=false`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      routes?: Array<{ distance?: number; duration?: number }>;
    };
    const meters = data.routes?.[0]?.distance;
    const durationSeconds = data.routes?.[0]?.duration;
    if (typeof meters !== "number" || typeof durationSeconds !== "number") {
      return null;
    }
    return { distanceKm: meters / 1000, durationSeconds };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as DistanceRequest;
    const customers = Array.isArray(body.customers) ? body.customers : [];
    if (customers.length === 0) {
      return NextResponse.json({ totalKm: 0, totalSeconds: 0, unresolvedStops: 0 });
    }

    const customerPoints = await Promise.all(
      customers.map(async (customer) => ({
        customer,
        point: await getCustomerPoint(customer),
      })),
    );

    const points = customerPoints
      .filter(
        (
          entry,
        ): entry is { customer: Customer; point: { latitude: number; longitude: number } } =>
          entry.point !== null,
      )
      .map((entry) => entry.point);

    const unresolvedStops = customers.length - points.length;
    if (points.length <= 1) {
      return NextResponse.json({ totalKm: 0, totalSeconds: 0, unresolvedStops });
    }

    const addressPoint = body.warehouseAddress
      ? await geocodeAddress(body.warehouseAddress)
      : null;
    const addressZip = body.warehouseAddress
      ? extractZipFromAddress(body.warehouseAddress)
      : null;
    const zipFallback = body.warehouseZip
      ? getZipPoint(body.warehouseZip)
      : addressZip
        ? getZipPoint(addressZip)
        : null;
    const warehousePoint = addressPoint ?? zipFallback;
    let totalKm = 0;
    let prevLat = warehousePoint?.latitude ?? points[0].latitude;
    let prevLon = warehousePoint?.longitude ?? points[0].longitude;
    const startIndex = warehousePoint ? 0 : 1;

    for (let i = startIndex; i < points.length; i += 1) {
      const current = points[i];
      totalKm += haversineKm(prevLat, prevLon, current.latitude, current.longitude);
      prevLat = current.latitude;
      prevLon = current.longitude;
    }

    const driving = await drivingDistanceKm(points, warehousePoint);
    const fallbackSeconds = (totalKm / 40) * 3600;
    return NextResponse.json({
      totalKm: driving?.distanceKm ?? totalKm,
      totalSeconds: driving?.durationSeconds ?? fallbackSeconds,
      unresolvedStops,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to calculate route distance" },
      { status: 500 },
    );
  }
}
