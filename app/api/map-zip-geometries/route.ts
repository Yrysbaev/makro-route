import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { fetchZctaGeoJsonForZips } from "@/lib/zip-zcta-geojson";

export const maxDuration = 60;

type Body = {
  zips?: string[];
};

export async function POST(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const zips = Array.isArray(body.zips) ? body.zips : [];
    if (zips.length === 0) {
      return NextResponse.json({ type: "FeatureCollection", features: [] });
    }
    const geojson = await fetchZctaGeoJsonForZips(zips);
    return NextResponse.json(geojson);
  } catch (err) {
    console.error("[map-zip-geometries]", err);
    return NextResponse.json(
      { error: "Failed to load ZIP boundaries" },
      { status: 500 },
    );
  }
}
