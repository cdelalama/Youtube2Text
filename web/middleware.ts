import { NextRequest, NextResponse } from "next/server";
import {
  getWebAuthState,
  isSameOriginRequest,
} from "./lib/webAuth";

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/status/media-pipeline"
  );
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const state = await getWebAuthState(request);
  if (state === "authenticated") {
    if (pathname.startsWith("/api/") && isUnsafeMethod(request.method) && !isSameOriginRequest(request)) {
      return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: state === "misconfigured" ? "web_auth_not_configured" : "unauthorized" },
      { status: state === "misconfigured" ? 503 : 401 }
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  if (state === "misconfigured") loginUrl.searchParams.set("error", "not_configured");
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
