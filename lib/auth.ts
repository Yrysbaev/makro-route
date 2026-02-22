import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "makro_route_session";

type DriverAccount = {
  username: string;
  password: string;
  fullName: string;
};

export type SessionUser = {
  username: string;
  fullName: string;
};

type SessionPayload = {
  username: string;
  fullName: string;
  exp: number;
};

const DRIVER_ACCOUNTS: DriverAccount[] = [
  {
    username: "driver_houston_1",
    password: "Makro#D1-2026",
    fullName: "Houston Driver 1",
  },
  {
    username: "driver_houston_2",
    password: "Makro#D2-2026",
    fullName: "Houston Driver 2",
  },
  {
    username: "driver_houston_3",
    password: "Makro#D3-2026",
    fullName: "Houston Driver 3",
  },
];

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const SESSION_SECRET = process.env.SESSION_SECRET ?? "change-me-in-production";

export function validateDriverCredentials(
  username: string,
  password: string,
): SessionUser | null {
  const normalized = username.trim().toLowerCase();
  const account = DRIVER_ACCOUNTS.find(
    (item) =>
      item.username.toLowerCase() === normalized && item.password === password,
  );
  if (!account) {
    return null;
  }
  return { username: account.username, fullName: account.fullName };
}

function sign(value: string): string {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const payload: SessionPayload = {
    username: user.username,
    fullName: user.fullName,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }

  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!payload.username || !payload.fullName || !payload.exp) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { username: payload.username, fullName: payload.fullName };
  } catch {
    return null;
  }
}

export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return verifySessionToken(token);
}

export function getSessionUserFromCookieHeader(
  cookieHeader: string | null,
): SessionUser | null {
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const sessionPair = parts.find((part) =>
    part.startsWith(`${SESSION_COOKIE_NAME}=`),
  );
  if (!sessionPair) {
    return null;
  }
  const token = sessionPair.slice(SESSION_COOKIE_NAME.length + 1);
  return verifySessionToken(token);
}
