import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { updateTripStopStatus } from "@/lib/trips";

type Params = {
  params: Promise<{ tripId: string; stopId: string }>;
};

type StatusBody = {
  status?: "pending" | "delivered" | "skipped";
  skippedReason?: string;
};

export async function PATCH(request: Request, { params }: Params) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { tripId, stopId } = await params;
    const body = (await request.json()) as StatusBody;
    const status =
      body.status === "delivered" || body.status === "skipped"
        ? body.status
        : "pending";
    const trip = await updateTripStopStatus({
      tripId,
      stopId,
      status,
      skippedReason: body.skippedReason,
      actor: user.username,
    });
    return NextResponse.json({ trip });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update stop";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
