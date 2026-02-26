import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { createDraftTrip, listTrips } from "@/lib/trips";

type CreateTripBody = {
  customerIds?: string[];
  warehouseAddress?: string;
};

export async function GET(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const trips = await listTrips();
    return NextResponse.json({ trips });
  } catch {
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CreateTripBody;
    const customerIds = Array.isArray(body.customerIds) ? body.customerIds : [];
    const warehouseAddress = String(body.warehouseAddress ?? "").trim();

    const trip = await createDraftTrip({
      customerIds,
      createdBy: user.username,
      warehouseAddress,
    });

    return NextResponse.json({ trip });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
