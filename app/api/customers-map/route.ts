import { NextResponse } from "next/server";
import zipcodes from "zipcodes";
import { loadCustomers } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";

function normalizeZip(zip: string): string {
  return zip.trim().slice(0, 5);
}

export type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  zip: string;
};

export async function GET(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const customers = await loadCustomers();
    const markers: MapMarker[] = [];
    let skippedNoZip = 0;

    for (const c of customers) {
      const zip = normalizeZip(c.zip);
      if (!/^\d{5}$/.test(zip)) {
        skippedNoZip += 1;
        continue;
      }
      const lookup = zipcodes.lookup(zip);
      if (!lookup) {
        skippedNoZip += 1;
        continue;
      }
      markers.push({
        id: c.id,
        name: c.name,
        lat: lookup.latitude,
        lng: lookup.longitude,
        city: c.city,
        state: c.state,
        zip: c.zip,
      });
    }

    return NextResponse.json({
      markers,
      totalCustomers: customers.length,
      skippedNoZip,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to build customer map" },
      { status: 500 },
    );
  }
}
