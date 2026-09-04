import { NextRequest, NextResponse } from "next/server";

// Compatibility endpoint used by older client links.
// The generated installer is served by /api/download/stub.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid support code" }, { status: 400 });
  }

  const stubUrl = new URL("/api/download/stub", req.url);
  stubUrl.searchParams.set("code", code);
  return NextResponse.redirect(stubUrl);
}
