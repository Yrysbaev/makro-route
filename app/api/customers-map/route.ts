import { NextResponse } from "next/server";
import { loadCustomers } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { geocodeAllCustomersForMap } from "@/lib/map-geocode";

export const maxDuration = 120;

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
    const { pins, skipped, zipFallbackCount } =
      await geocodeAllCustomersForMap(customers);

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
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to build customer map" },
      { status: 500 },
    );
  }
}
