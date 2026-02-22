import { NextResponse } from "next/server";
import { loadCustomers } from "@/lib/customers";
import { getSessionUserFromCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = getSessionUserFromCookieHeader(request.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const customers = await loadCustomers();
    return NextResponse.json({ customers });
  } catch {
    return NextResponse.json(
      { error: "Failed to read Customers.xlsx" },
      { status: 500 },
    );
  }
}
