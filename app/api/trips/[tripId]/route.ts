import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { getTripById } from "@/lib/trips";

type Params = {
  params: Promise<{ tripId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { tripId } = await params;
    const trip = await getTripById(tripId);
    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    return NextResponse.json({ trip });
  } catch {
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
}
