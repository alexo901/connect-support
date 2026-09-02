import { NextResponse } from "next/server";

// Socket.io is initialized on the custom HTTP server (server.ts).
// This route just confirms the socket endpoint is active.
export async function GET() {
  return NextResponse.json({ status: "Socket.io is managed by the custom server" });
}
