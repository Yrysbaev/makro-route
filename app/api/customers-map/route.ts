import { NextResponse } from "next/server";
import { loadCustomers } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { geocodeAllCustomersForMap } from "@/lib/map-geocode";

/** Pro / long-running: Census + Nominatim. Vercel Hobby (~10s) cannot finish that for many rows — use ZIP-only unless this is set. */
export const maxDuration = 120;

function useZipOnlyMapGeocode(): boolean {
  if (process.env.MAP_STREET_GEOCODE === "1") {
    return false;
  }
  if (process.env.MAP_ZIP_ONLY === "1") {
    return true;
  }
  return process.env.VERCEL === "1";
}

export type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  zip: string;
  source: "census" | "nominatim" | "zip";
};

export async function GET(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const customers = await loadCustomers();
    const zipOnly = useZipOnlyMapGeocode();
    const { pins, skipped, zipFallbackCount, nominatimCutShort, zipOnlyMode } =
      await geocodeAllCustomersForMap(customers, { zipOnly });

    const markers: MapMarker[] = pins.map((p) => ({
      id: p.customer.id,
      name: p.customer.name,
      lat: p.lat,
      lng: p.lng,
      city: p.customer.city,
      state: p.customer.state,
      zip: p.customer.zip,
      source: p.source,
    }));

    return NextResponse.json({
      markers,
      totalCustomers: customers.length,
      skippedNoZip: skipped,
      zipFallbackCount,
      nominatimCutShort,
      zipOnlyMode,
    });
  } catch (err) {
    console.error("[customers-map]", err);
    return NextResponse.json(
      { error: "Failed to build customer map" },
      { status: 500 },
    );
  }
}
