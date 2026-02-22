import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  validateDriverCredentials,
} from "@/lib/auth";

type LoginBody = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginBody;
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    const user = validateDriverCredentials(username, password);

    if (!user) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 },
      );
    }

    const token = createSessionToken(user);
    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      new URL(request.url).protocol === "https:";
    const response = NextResponse.json({ user });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
