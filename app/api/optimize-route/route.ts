import { NextResponse } from "next/server";
import type { Customer } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";

// Allow up to 60s so geocoding + OSRM matrix finish on Vercel (default is 10s)
export const maxDuration = 60;

type RouteRequest = {
  customers?: Customer[];
  warehouseAddress?: string;
  startLatitude?: number;
  startLongitude?: number;
};

type OptimizationResult = {
  customers: Customer[];
  totalKm: number;
  unresolvedStops: number;
  totalSeconds: number;
  legEtas: Array<{
    stopId: string;
    customerName: string;
    legDurationSec: number;
    legDistanceKm: number;
    etaHouston: string;
  }>;
  warnings: string[];
  averageGeocodeQuality: number;
};

type RoutePoint = {
  customer: Customer;
  latitude: number;
  longitude: number;
  quality: number;
  pointId: string;
};

type GeocodeResult = {
  latitude: number;
  longitude: number;
  quality: number;
  label: string;
  source: "nominatim" | "census";
};

type Matrix = {
  durations: number[][];
  distances: number[][];
};

const HOUSTON_TZ = "America/Chicago";
const STOP_QUALITY_THRESHOLD = 0.55;
const LOW_CONFIDENCE_THRESHOLD = 0.35;
const MATRIX_CACHE_TTL_MS = 30 * 60 * 1000;

const geocodeCache = new Map<string, GeocodeResult | null>();
const matrixCache = new Map<string, { expiresAt: number; matrix: Matrix }>();

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

async function geocodeAddress(
  address: string,
  preferredZip?: string,
  preferredCity?: string,
): Promise<GeocodeResult | null> {
  const key = `${address.trim().toLowerCase()}|${(preferredZip ?? "").trim()}|${(preferredCity ?? "").trim().toLowerCase()}`;
  if (!key) {
    return null;
  }
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key) ?? null;
  }

  const candidates: GeocodeResult[] = [];

  try {
    const endpoint = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(
      address,
    )}`;
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "Makro-Route/1.0" },
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as Array<{
        lat?: string;
        lon?: string;
        display_name?: string;
        importance?: number;
        place_rank?: number;
        address?: Record<string, string>;
      }>;
      const first = data[0];
      const latitude = first?.lat ? Number(first.lat) : Number.NaN;
      const longitude = first?.lon ? Number(first.lon) : Number.NaN;
      if (!Number.isNaN(latitude) && !Number.isNaN(longitude)) {
        const importance = typeof first.importance === "number" ? first.importance : 0.4;
        const placeRank = typeof first.place_rank === "number" ? first.place_rank : 10;
        const resultAddress = first.address ?? {};
        const houseNumber = resultAddress.house_number ? 0.15 : 0;
        const road = resultAddress.road ? 0.15 : 0;
        const zipMatch =
          preferredZip && resultAddress.postcode?.includes(preferredZip.slice(0, 5))
            ? 0.15
            : 0;
        const cityMatch =
          preferredCity &&
          Object.values(resultAddress)
            .join(" ")
            .toLowerCase()
            .includes(preferredCity.toLowerCase())
            ? 0.1
            : 0;
        const rankBonus = Math.min(Math.max((placeRank - 10) / 100, 0), 0.1);
        const quality = Math.min(
          1,
          Math.max(0, importance + houseNumber + road + zipMatch + cityMatch + rankBonus),
        );
        candidates.push({
          latitude,
          longitude,
          quality,
          label: first.display_name ?? address,
          source: "nominatim",
        });
      }
    }
  } catch {
    // Ignore provider error; we still try fallback.
  }

  try {
    const endpoint = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
      address,
    )}&benchmark=Public_AR_Current&format=json`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as {
        result?: {
          addressMatches?: Array<{
            matchedAddress?: string;
            coordinates?: { x?: number; y?: number };
            matchType?: string;
          }>;
        };
      };
      const match = payload.result?.addressMatches?.[0];
      const longitude = match?.coordinates?.x;
      const latitude = match?.coordinates?.y;
      if (typeof latitude === "number" && typeof longitude === "number") {
        const matchType = (match?.matchType ?? "").toLowerCase();
        const base = matchType.includes("exact") ? 0.8 : 0.65;
        const zipBoost = preferredZip && address.includes(preferredZip.slice(0, 5)) ? 0.1 : 0;
        candidates.push({
          latitude,
          longitude,
          quality: Math.min(1, base + zipBoost),
          label: match?.matchedAddress ?? address,
          source: "census",
        });
      }
    }
  } catch {
    // Ignore fallback provider error.
  }

  if (candidates.length === 0) {
    geocodeCache.set(key, null);
    return null;
  }

  const best = candidates.reduce((winner, current) =>
    current.quality > winner.quality ? current : winner,
  );
  geocodeCache.set(key, best);
  return best;
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

function cleanAddressLine(addressLine: string): string {
  return addressLine
    .replace(/\b(suite|ste|unit|apt|#)\s*[a-z0-9-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function customerAddressVariants(customer: Customer): string[] {
  const full = customerAddress(customer);
  const cleanedLine = cleanAddressLine(customer.addressLine1);
  const cleanedFull = [
    cleanedLine,
    customer.city,
    customer.state,
    customer.zip,
    customer.country,
  ]
    .filter(Boolean)
    .join(", ");
  const cityStateZip = [customer.city, customer.state, customer.zip, customer.country]
    .filter(Boolean)
    .join(", ");
  const lineZip = [cleanedLine || customer.addressLine1, customer.zip, customer.country]
    .filter(Boolean)
    .join(", ");

  return [...new Set([full, cleanedFull, lineZip, cityStateZip].filter(Boolean))];
}

async function getCustomerPoint(
  customer: Customer,
): Promise<GeocodeResult | null> {
  const variants = customerAddressVariants(customer);
  let best: GeocodeResult | null = null;

  for (const variant of variants) {
    const candidate = await geocodeAddress(variant, customer.zip, customer.city);
    if (!candidate) {
      continue;
    }
    if (!best || candidate.quality > best.quality) {
      best = candidate;
    }
    if (candidate.quality >= STOP_QUALITY_THRESHOLD) {
      break;
    }
  }
  return best;
}

function matrixKey(coordinates: Array<{ latitude: number; longitude: number }>): string {
  return coordinates
    .map((c) => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`)
    .join("|");
}

function buildHaversineMatrix(
  coordinates: Array<{ latitude: number; longitude: number }>,
): Matrix {
  const n = coordinates.length;
  const durations: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const distances: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const avgSpeedKmH = 40;

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const d = haversineKm(
        coordinates[i].latitude,
        coordinates[i].longitude,
        coordinates[j].latitude,
        coordinates[j].longitude,
      );
      distances[i][j] = d;
      durations[i][j] = (d / avgSpeedKmH) * 3600;
    }
  }

  return { durations, distances };
}

async function buildDrivingMatrix(
  coordinates: Array<{ latitude: number; longitude: number }>,
): Promise<Matrix> {
  const key = matrixKey(coordinates);
  const cached = matrixCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.matrix;
  }

  const coordString = coordinates
    .map((p) => `${p.longitude},${p.latitude}`)
    .join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coordString}?annotations=duration,distance`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const fallback = buildHaversineMatrix(coordinates);
      matrixCache.set(key, { matrix: fallback, expiresAt: Date.now() + MATRIX_CACHE_TTL_MS });
      return fallback;
    }
    const payload = (await response.json()) as {
      durations?: number[][];
      distances?: number[][];
    };
    if (!payload.durations || !payload.distances) {
      const fallback = buildHaversineMatrix(coordinates);
      matrixCache.set(key, { matrix: fallback, expiresAt: Date.now() + MATRIX_CACHE_TTL_MS });
      return fallback;
    }
    const matrix: Matrix = {
      durations: payload.durations,
      distances: payload.distances.map((row) => row.map((meters) => meters / 1000)),
    };
    matrixCache.set(key, { matrix, expiresAt: Date.now() + MATRIX_CACHE_TTL_MS });
    return matrix;
  } catch {
    const fallback = buildHaversineMatrix(coordinates);
    matrixCache.set(key, { matrix: fallback, expiresAt: Date.now() + MATRIX_CACHE_TTL_MS });
    return fallback;
  }
}

function evaluateRoute(order: number[], matrix: Matrix): { seconds: number; km: number } {
  let seconds = 0;
  let km = 0;
  let prev = 0; // warehouse/start node
  for (const node of order) {
    seconds += matrix.durations[prev][node] ?? Number.POSITIVE_INFINITY;
    km += matrix.distances[prev][node] ?? Number.POSITIVE_INFINITY;
    prev = node;
  }
  return { seconds, km };
}

function isBetter(a: { seconds: number; km: number }, b: { seconds: number; km: number }) {
  if (a.seconds !== b.seconds) {
    return a.seconds < b.seconds;
  }
  return a.km < b.km;
}

function nearestNeighborSeed(stopCount: number, matrix: Matrix): number[] {
  const remaining = new Set<number>();
  for (let i = 1; i <= stopCount; i += 1) {
    remaining.add(i);
  }
  const order: number[] = [];
  let current = 0;

  while (remaining.size > 0) {
    let bestNode = -1;
    let bestSec = Number.POSITIVE_INFINITY;
    let bestKm = Number.POSITIVE_INFINITY;
    for (const node of remaining) {
      const sec = matrix.durations[current][node];
      const km = matrix.distances[current][node];
      if (sec < bestSec || (sec === bestSec && km < bestKm)) {
        bestSec = sec;
        bestKm = km;
        bestNode = node;
      }
    }
    if (bestNode === -1) break;
    order.push(bestNode);
    remaining.delete(bestNode);
    current = bestNode;
  }
  return order;
}

function runTwoOpt(order: number[], matrix: Matrix): number[] {
  if (order.length < 4) return order;
  let best = [...order];
  let bestScore = evaluateRoute(best, matrix);
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 12) {
    improved = false;
    iterations += 1;
    for (let i = 0; i < best.length - 2; i += 1) {
      for (let k = i + 1; k < best.length - 1; k += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const score = evaluateRoute(candidate, matrix);
        if (isBetter(score, bestScore)) {
          best = candidate;
          bestScore = score;
          improved = true;
        }
      }
    }
  }
  return best;
}

function runThreeOpt(order: number[], matrix: Matrix): number[] {
  if (order.length < 6) return order;
  let best = [...order];
  let bestScore = evaluateRoute(best, matrix);
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 4) {
    improved = false;
    iterations += 1;
    for (let i = 1; i < best.length - 4; i += 1) {
      for (let j = i + 1; j < best.length - 2; j += 1) {
        for (let k = j + 1; k < best.length - 1; k += 1) {
          const a = best.slice(0, i);
          const b = best.slice(i, j);
          const c = best.slice(j, k);
          const d = best.slice(k);

          const candidates = [
            [...a, ...c, ...b, ...d],
            [...a, ...b.reverse(), ...c, ...d],
            [...a, ...b, ...c.reverse(), ...d],
            [...a, ...c.reverse(), ...b.reverse(), ...d],
          ];

          for (const candidate of candidates) {
            const score = evaluateRoute(candidate, matrix);
            if (isBetter(score, bestScore)) {
              best = candidate;
              bestScore = score;
              improved = true;
            }
          }
        }
      }
    }
  }
  return best;
}

function formatHoustonEta(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

async function optimizeCustomers(
  customers: Customer[],
  warehouseAddress?: string,
  startLatitude?: number,
  startLongitude?: number,
): Promise<OptimizationResult> {
  if (customers.length === 0) {
    return {
      customers: [],
      totalKm: 0,
      unresolvedStops: 0,
      totalSeconds: 0,
      legEtas: [],
      warnings: [],
      averageGeocodeQuality: 0,
    };
  }

  const warnings: string[] = [];
  const unresolved: Customer[] = [];
  const geocodedHigh: RoutePoint[] = [];
  const geocodedLow: RoutePoint[] = [];

  const geocodeRows = await Promise.all(
    customers.map(async (customer) => {
      const geo = await getCustomerPoint(customer);
      return { customer, geo };
    }),
  );

  for (const row of geocodeRows) {
    if (!row.geo) {
      warnings.push(`No geocode result for: ${row.customer.name}`);
      unresolved.push(row.customer);
      continue;
    }
    const routePoint: RoutePoint = {
      customer: row.customer,
      latitude: row.geo.latitude,
      longitude: row.geo.longitude,
      quality: row.geo.quality,
      pointId: row.customer.id,
    };

    if (row.geo.quality >= STOP_QUALITY_THRESHOLD) {
      geocodedHigh.push(routePoint);
      continue;
    }
    if (row.geo.quality >= LOW_CONFIDENCE_THRESHOLD) {
      warnings.push(
        `Low geocode quality (${row.geo.quality.toFixed(2)}) for: ${row.customer.name} (kept with warning)`,
      );
      geocodedLow.push(routePoint);
      continue;
    }
    warnings.push(
      `Very low geocode quality (${row.geo.quality.toFixed(2)}) for: ${row.customer.name} (excluded)`,
    );
    unresolved.push(row.customer);
  }

  let geocoded = geocodedHigh;
  if (geocoded.length === 0 && geocodedLow.length > 0) {
    warnings.push(
      "No high-confidence stops found. Using low-confidence stops for optimization.",
    );
    geocoded = geocodedLow;
  }

  if (geocoded.length === 0) {
    return {
      customers: [],
      totalKm: 0,
      unresolvedStops: unresolved.length,
      totalSeconds: 0,
      legEtas: [],
      warnings: [...warnings, "No routable stops after geocode validation."],
      averageGeocodeQuality: 0,
    };
  }

  let startPoint:
    | { latitude: number; longitude: number; label: string; quality: number }
    | null = null;
  if (typeof startLatitude === "number" && typeof startLongitude === "number") {
    startPoint = {
      latitude: startLatitude,
      longitude: startLongitude,
      label: "Live location",
      quality: 1,
    };
  } else if (warehouseAddress) {
    const geo = await geocodeAddress(warehouseAddress);
    if (geo) {
      startPoint = {
        latitude: geo.latitude,
        longitude: geo.longitude,
        label: geo.label,
        quality: geo.quality,
      };
    } else {
      warnings.push("Warehouse address could not be geocoded. Using first stop as start.");
    }
  }

  const coordinates = [
    startPoint
      ? { latitude: startPoint.latitude, longitude: startPoint.longitude }
      : { latitude: geocoded[0].latitude, longitude: geocoded[0].longitude },
    ...geocoded.map((point) => ({ latitude: point.latitude, longitude: point.longitude })),
  ];

  const matrix = await buildDrivingMatrix(coordinates);
  const seed = nearestNeighborSeed(geocoded.length, matrix);
  const twoOpt = runTwoOpt(seed, matrix);
  const threeOpt = runThreeOpt(twoOpt, matrix);
  const bestOrder = threeOpt;
  const score = evaluateRoute(bestOrder, matrix);

  const orderedPoints = bestOrder.map((nodeIndex) => geocoded[nodeIndex - 1]);
  const orderedCustomers = [
    ...orderedPoints.map((point) => point.customer),
    ...geocodedLow
      .filter((point) => !orderedPoints.some((ordered) => ordered.pointId === point.pointId))
      .map((point) => point.customer),
  ];

  let cumulativeSec = 0;
  let prevNode = 0;
  const now = new Date();
  const legEtas = orderedPoints.map((point, idx) => {
    const node = bestOrder[idx];
    const legDurationSec = matrix.durations[prevNode][node] ?? 0;
    const legDistanceKm = matrix.distances[prevNode][node] ?? 0;
    cumulativeSec += legDurationSec;
    const eta = new Date(now.getTime() + cumulativeSec * 1000);
    prevNode = node;
    return {
      stopId: point.pointId,
      customerName: point.customer.name,
      legDurationSec: Math.max(0, Math.round(legDurationSec)),
      legDistanceKm: Number(legDistanceKm.toFixed(2)),
      etaHouston: formatHoustonEta(eta),
    };
  });

  const averageGeocodeQuality =
    (geocodedHigh.length + geocodedLow.length) > 0
      ? [...geocodedHigh, ...geocodedLow].reduce((sum, point) => sum + point.quality, 0) /
        (geocodedHigh.length + geocodedLow.length)
      : 0;

  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} stop(s) were excluded due to low/invalid geocode quality.`,
    );
  }

  if (!startPoint) {
    warnings.push("Start point defaulted to first valid stop due to missing warehouse geocode.");
  } else if (startPoint.quality < STOP_QUALITY_THRESHOLD) {
    warnings.push(
      `Warehouse geocode quality is low (${startPoint.quality.toFixed(2)}). Route quality may degrade.`,
    );
  }

  if (geocoded.length <= 1) {
    return {
      customers: orderedCustomers,
      totalKm: score.km,
      unresolvedStops: unresolved.length,
      totalSeconds: score.seconds,
      legEtas,
      warnings,
      averageGeocodeQuality: Number(averageGeocodeQuality.toFixed(2)),
    };
  }

  return {
    customers: orderedCustomers,
    totalKm: Number(score.km.toFixed(2)),
    unresolvedStops: unresolved.length,
    totalSeconds: Math.round(score.seconds),
    legEtas,
    warnings,
    averageGeocodeQuality: Number(averageGeocodeQuality.toFixed(2)),
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
      return NextResponse.json({
        customers: [],
        totalKm: 0,
        unresolvedStops: 0,
        totalSeconds: 0,
        legEtas: [],
        warnings: [],
        averageGeocodeQuality: 0,
      });
    }

    const optimized = await optimizeCustomers(
      customers,
      body.warehouseAddress,
      body.startLatitude,
      body.startLongitude,
    );
    return NextResponse.json(optimized);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to optimize route";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
