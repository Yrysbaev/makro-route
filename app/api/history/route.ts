import { NextResponse } from "next/server";
import { getSessionUserFromCookieHeader } from "@/lib/auth";
import { listDeliveryHistory } from "@/lib/trips";

export async function GET(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? undefined;
    const customer = url.searchParams.get("customer") ?? undefined;
    const driver = url.searchParams.get("driver") ?? undefined;
    const rows = await listDeliveryHistory({ date, customer, driver });
    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json(
      { error: "Failed to load delivery history" },
      { status: 500 },
    );
  }
}
