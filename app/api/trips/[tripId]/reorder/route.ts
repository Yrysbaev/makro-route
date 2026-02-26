import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { reorderTripStop } from "@/lib/trips";

type Params = {
  params: Promise<{ tripId: string }>;
};

type ReorderBody = {
  stopId?: string;
  direction?: "up" | "down";
};

export async function PATCH(request: Request, { params }: Params) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { tripId } = await params;
    const body = (await request.json()) as ReorderBody;
    const stopId = String(body.stopId ?? "");
    const direction = body.direction === "up" ? "up" : "down";

    const trip = await reorderTripStop({
      tripId,
      stopId,
      direction,
      actor: user.username,
    });

    return NextResponse.json({ trip });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reorder stop";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
