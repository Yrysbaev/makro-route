import type { Customer } from "@/lib/customers";
import zipcodes from "zipcodes";

export type MapPinSource = "census" | "nominatim" | "zip";

export type MapPinResult = {
  lat: number;
  lng: number;
  source: MapPinSource;
};

const resultCache = new Map<string, MapPinResult | null>();

let lastNominatimCall = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

/** Whitespace / line breaks — messy Sheet cells often break geocoders. */
function normalizeAddressLine1(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}

/** Same idea as route optimization: suite numbers often break Census street-range match. */
function cleanStreetForGeocode(addressLine: string): string {
  return normalizeAddressLine1(addressLine)
    .replace(/\b(suite|ste|unit|apt|#)\s*[a-z0-9-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Street line for Census structured + Nominatim structured: prefer a real street fragment
 * when the cell mixes venue name + street (e.g. "The Triangle, 4700 W Guadalupe …").
 */
function streetForStructured(customer: Customer): string {
  const normalized = normalizeAddressLine1(customer.addressLine1);
  const parts = normalized
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return normalized;
  if (/^\d/.test(parts[0])) return parts[0];
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  return parts[0];
}

function oneLineAddress(customer: Customer, streetLine: string): string {
  return [streetLine, customer.city, customer.state, customer.zip, customer.country || "US"]
    .filter(Boolean)
    .join(", ");
}

function normalizeZip(zip: string): string {
  return zip.trim().slice(0, 5);
}

type CensusMatch = {
  coordinates?: { x?: number; y?: number };
  addressComponents?: { zip?: string };
};

function censusZipMatchesMatch(match: CensusMatch | undefined, customerZip: string): boolean {
  if (!match) return false;
  const want = normalizeZip(customerZip);
  if (!/^\d{5}$/.test(want)) return true;
  const comp = match.addressComponents?.zip;
  if (typeof comp !== "string" || !/^\d/.test(comp)) return true;
  return normalizeZip(comp) === want;
}

function parseCensusFirstMatch(
  payload: { result?: { addressMatches?: CensusMatch[] } },
  customerZip: string,
): { lat: number; lng: number } | null {
  const match = payload.result?.addressMatches?.[0];
  if (!match || !censusZipMatchesMatch(match, customerZip)) return null;
  const longitude = match.coordinates?.x;
  const latitude = match.coordinates?.y;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return { lat: latitude, lng: longitude };
}

async function geocodeCensusOneLine(
  address: string,
  customerZip: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const endpoint = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
      address,
    )}&benchmark=Public_AR_Current&format=json`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: { addressMatches?: CensusMatch[] };
    };
    return parseCensusFirstMatch(payload, customerZip);
  } catch {
    return null;
  }
}

async function geocodeCensusStructured(customer: Customer): Promise<{ lat: number; lng: number } | null> {
  const street = streetForStructured(customer);
  const zip = normalizeZip(customer.zip);
  const city = customer.city.trim();
  const state = customer.state.trim();
  if (!street || !city || !state || !/^\d{5}$/.test(zip)) return null;
  try {
    const endpoint =
      `https://geocoding.geo.census.gov/geocoder/locations/address?` +
      `street=${encodeURIComponent(street)}` +
      `&city=${encodeURIComponent(city)}` +
      `&state=${encodeURIComponent(state)}` +
      `&zip=${encodeURIComponent(zip)}` +
      `&benchmark=Public_AR_Current&format=json`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: { addressMatches?: CensusMatch[] };
    };
    return parseCensusFirstMatch(payload, zip);
  } catch {
    return null;
  }
}

async function nominatimDelay(): Promise<void> {
  const now = Date.now();
  const wait = NOMINATIM_MIN_INTERVAL_MS - (now - lastNominatimCall);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastNominatimCall = Date.now();
}

type NominatimHit = {
  lat: number;
  lng: number;
  postcode?: string;
};

function parseNominatimFirst(
  data: Array<{
    lat?: string;
    lon?: string;
    address?: { postcode?: string };
    class?: string;
    type?: string;
  }>,
  expectedZip: string | undefined,
): NominatimHit | null {
  const first = data[0];
  const latitude = first?.lat ? Number(first.lat) : Number.NaN;
  const longitude = first?.lon ? Number(first.lon) : Number.NaN;
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

  const want = expectedZip ? normalizeZip(expectedZip) : "";
  const postcode = first.address?.postcode;
  if (want && /^\d{5}$/.test(want) && typeof postcode === "string" && postcode.length > 0) {
    const got = postcode.replace(/\D/g, "").slice(0, 5);
    if (got !== want) return null;
  }

  return { lat: latitude, lng: longitude, postcode };
}

async function geocodeNominatimStructured(
  customer: Customer,
  streetLine: string,
): Promise<NominatimHit | null> {
  try {
    await nominatimDelay();
    const zip = normalizeZip(customer.zip);
    const city = customer.city.trim();
    const state = customer.state.trim();
    if (!streetLine || !city || !state) return null;
    const params = new URLSearchParams({
      format: "json",
      addressdetails: "1",
      limit: "1",
      street: streetLine,
      city,
      state,
      countrycodes: "us",
    });
    if (/^\d{5}$/.test(zip)) params.set("postalcode", zip);
    const endpoint = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "Makro-Route/1.0 (customer map)" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      address?: { postcode?: string };
      class?: string;
      type?: string;
    }>;
    return parseNominatimFirst(data, customer.zip);
  } catch {
    return null;
  }
}

async function geocodeNominatimQuery(q: string, expectedZip: string | undefined): Promise<NominatimHit | null> {
  try {
    await nominatimDelay();
    const endpoint = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(
      q,
    )}`;
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "Makro-Route/1.0 (customer map)" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      address?: { postcode?: string };
      class?: string;
      type?: string;
    }>;
    return parseNominatimFirst(data, expectedZip);
  } catch {
    return null;
  }
}

function zipCentroid(customer: Customer): { lat: number; lng: number } | null {
  const zip = normalizeZip(customer.zip);
  if (!/^\d{5}$/.test(zip)) return null;
  const lookup = zipcodes.lookup(zip);
  if (!lookup) return null;
  return { lat: lookup.latitude, lng: lookup.longitude };
}

const CENSUS_BATCH = 8;

/** Stop calling Nominatim once this wall time is reached (Census + Nominatim + ZIP). Keeps responses under typical serverless limits (e.g. Vercel 120s). */
const MAP_GEOCODE_WALL_BUDGET_MS = 105_000;

function cacheKey(customer: Customer): string {
  return [
    normalizeAddressLine1(customer.addressLine1),
    customer.city.trim().toLowerCase(),
    customer.state.trim().toLowerCase(),
    normalizeZip(customer.zip),
    (customer.country || "").trim().toLowerCase(),
  ].join("|");
}

function pushPin(
  pins: Array<{ customer: Customer; lat: number; lng: number; source: MapPinSource }>,
  customer: Customer,
  lat: number,
  lng: number,
  source: MapPinSource,
): void {
  const key = cacheKey(customer);
  const r: MapPinResult = { lat, lng, source };
  resultCache.set(key, r);
  pins.push({ customer, lat, lng, source });
}

/**
 * ZIP-centroid only — fast, no network (fits Vercel Hobby ~10s limits with large customer lists).
 */
function geocodeAllCustomersZipOnlyMode(customers: Customer[]): {
  pins: Array<{
    customer: Customer;
    lat: number;
    lng: number;
    source: MapPinSource;
  }>;
  skipped: number;
  zipFallbackCount: number;
  nominatimCutShort: boolean;
  zipOnlyMode: boolean;
} {
  const pins: Array<{
    customer: Customer;
    lat: number;
    lng: number;
    source: MapPinSource;
  }> = [];
  let skipped = 0;
  let zipFallbackCount = 0;

  for (const c of customers) {
    const key = cacheKey(c);
    if (resultCache.has(key)) {
      const cached = resultCache.get(key);
      if (cached) {
        pins.push({
          customer: c,
          lat: cached.lat,
          lng: cached.lng,
          source: cached.source,
        });
      }
      continue;
    }
    const z = zipCentroid(c);
    if (z) {
      const r: MapPinResult = { ...z, source: "zip" };
      resultCache.set(key, r);
      pins.push({ customer: c, lat: r.lat, lng: r.lng, source: "zip" });
      zipFallbackCount += 1;
    } else {
      resultCache.set(key, null);
      skipped += 1;
    }
  }

  return {
    pins,
    skipped,
    zipFallbackCount,
    nominatimCutShort: false,
    zipOnlyMode: true,
  };
}

export type GeocodeAllCustomersResult = {
  pins: Array<{
    customer: Customer;
    lat: number;
    lng: number;
    source: MapPinSource;
  }>;
  skipped: number;
  zipFallbackCount: number;
  nominatimCutShort: boolean;
  zipOnlyMode: boolean;
};

/**
 * Street-level pins: Census (one-line batch → structured → cleaned one-line), then Nominatim
 * (structured → free-text), then ZIP centroid. Cached in-memory per server instance.
 *
 * Pass `zipOnly: true` for hosting with strict time limits (e.g. Vercel Hobby).
 */
export async function geocodeAllCustomersForMap(
  customers: Customer[],
  options?: { zipOnly?: boolean },
): Promise<GeocodeAllCustomersResult> {
  if (options?.zipOnly) {
    return geocodeAllCustomersZipOnlyMode(customers);
  }

  const pins: Array<{
    customer: Customer;
    lat: number;
    lng: number;
    source: MapPinSource;
  }> = [];
  let skipped = 0;
  let zipFallbackCount = 0;
  let nominatimCutShort = false;

  const startedAt = Date.now();

  const phase1Misses: Customer[] = [];

  for (let i = 0; i < customers.length; i += CENSUS_BATCH) {
    const batch = customers.slice(i, i + CENSUS_BATCH);
    const results = await Promise.all(
      batch.map((c) =>
        geocodeCensusOneLine(oneLineAddress(c, normalizeAddressLine1(c.addressLine1)), c.zip),
      ),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const c = batch[j];
      const pt = results[j];
      const key = cacheKey(c);
      if (pt) {
        const r: MapPinResult = { ...pt, source: "census" };
        resultCache.set(key, r);
        pins.push({ customer: c, lat: r.lat, lng: r.lng, source: "census" });
      } else {
        phase1Misses.push(c);
      }
    }
  }

  let working = phase1Misses;

  // Phase 2: Census structured (parallel batches)
  const afterStructured: Customer[] = [];
  for (let i = 0; i < working.length; i += CENSUS_BATCH) {
    const batch = working.slice(i, i + CENSUS_BATCH);
    const results = await Promise.all(batch.map((c) => geocodeCensusStructured(c)));
    for (let j = 0; j < batch.length; j += 1) {
      const c = batch[j];
      const pt = results[j];
      if (pt) {
        pushPin(pins, c, pt.lat, pt.lng, "census");
      } else {
        afterStructured.push(c);
      }
    }
  }
  working = afterStructured;

  // Phase 3: Census one-line with cleaned street (suites stripped)
  const afterCleaned: Customer[] = [];
  for (let i = 0; i < working.length; i += CENSUS_BATCH) {
    const batch = working.slice(i, i + CENSUS_BATCH);
    const results = await Promise.all(
      batch.map((c) =>
        geocodeCensusOneLine(oneLineAddress(c, cleanStreetForGeocode(c.addressLine1)), c.zip),
      ),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const c = batch[j];
      const pt = results[j];
      if (pt) {
        pushPin(pins, c, pt.lat, pt.lng, "census");
      } else {
        afterCleaned.push(c);
      }
    }
  }
  working = afterCleaned;

  const pinZipOrSkipOnly = (c: Customer): void => {
    const key = cacheKey(c);
    if (resultCache.has(key)) {
      const cached = resultCache.get(key);
      if (cached) {
        pins.push({
          customer: c,
          lat: cached.lat,
          lng: cached.lng,
          source: cached.source,
        });
      }
      return;
    }
    const z = zipCentroid(c);
    if (z) {
      const r: MapPinResult = { ...z, source: "zip" };
      resultCache.set(key, r);
      pins.push({ customer: c, lat: r.lat, lng: r.lng, source: "zip" });
      zipFallbackCount += 1;
    } else {
      resultCache.set(key, null);
      skipped += 1;
    }
  };

  // Phase 4: Nominatim (sequential — OSM policy), then ZIP centroid
  for (let i = 0; i < working.length; i += 1) {
    const c = working[i];
    if (Date.now() - startedAt > MAP_GEOCODE_WALL_BUDGET_MS) {
      nominatimCutShort = true;
      for (let j = i; j < working.length; j += 1) {
        pinZipOrSkipOnly(working[j]);
      }
      break;
    }

    const key = cacheKey(c);
    if (resultCache.has(key)) {
      const cached = resultCache.get(key);
      if (cached) {
        pins.push({
          customer: c,
          lat: cached.lat,
          lng: cached.lng,
          source: cached.source,
        });
      }
      continue;
    }

    const streetPrimary = streetForStructured(c);
    const streetClean = cleanStreetForGeocode(c.addressLine1);

    let nom =
      (await geocodeNominatimStructured(c, streetPrimary)) ||
      (streetClean !== streetPrimary ? await geocodeNominatimStructured(c, streetClean) : null) ||
      (await geocodeNominatimQuery(
        oneLineAddress(c, normalizeAddressLine1(c.addressLine1)),
        c.zip,
      ));

    if (nom) {
      pushPin(pins, c, nom.lat, nom.lng, "nominatim");
      continue;
    }

    const z = zipCentroid(c);
    if (z) {
      const r: MapPinResult = { ...z, source: "zip" };
      resultCache.set(key, r);
      pins.push({ customer: c, lat: r.lat, lng: r.lng, source: "zip" });
      zipFallbackCount += 1;
    } else {
      resultCache.set(key, null);
      skipped += 1;
    }
  }

  return {
    pins,
    skipped,
    zipFallbackCount,
    nominatimCutShort,
    zipOnlyMode: false,
  };
}
