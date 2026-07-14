import { NextRequest, NextResponse } from "next/server";
import {
  isSameOriginRequest,
  WEB_SESSION_COOKIE,
  webSessionCookieOptions,
} from "../../../../lib/webAuth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(WEB_SESSION_COOKIE, "", {
    ...webSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
