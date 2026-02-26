import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { removeTripStop } from "@/lib/trips";

type Params = {
  params: Promise<{ tripId: string; stopId: string }>;
};

export async function DELETE(request: Request, { params }: Params) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { tripId, stopId } = await params;
    const trip = await removeTripStop({
      tripId,
      stopId,
      actor: user.username,
    });
    return NextResponse.json({ trip });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove stop";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
