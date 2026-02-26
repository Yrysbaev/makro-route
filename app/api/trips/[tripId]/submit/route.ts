import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { submitTrip } from "@/lib/trips";

type Params = {
  params: Promise<{ tripId: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { tripId } = await params;
    const trip = await submitTrip({ tripId, actor: user.username });
    return NextResponse.json({ trip });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
