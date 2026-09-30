import { NextRequest, NextResponse } from "next/server";

// Redirect to the signed-off NSIS Web installer; its HTTP filename carries the verified code.

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "000000";
  const serverUrl = process.env.SOCKET_SERVER_URL ||
    "https://supportas-fxdwbkfyfgfbg2g5.canadacentral-01.azurewebsites.net";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid support code" }, { status: 400 });
  }

  const installerUrl = new URL("/api/download/installer", serverUrl);
  installerUrl.searchParams.set("code", code);
  return NextResponse.redirect(installerUrl);
}
