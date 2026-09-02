import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, devices, logs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { verifyToken, extractBearerToken } from "@/lib/auth";

function authGuard(req: NextRequest) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}

// GET /api/sessions
export async function GET(req: NextRequest) {
  if (!authGuard(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(50);
    return NextResponse.json({ sessions: rows });
  } catch (err) {
    console.error("[GET /api/sessions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/sessions — start a new session
export async function POST(req: NextRequest) {
  if (!authGuard(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { deviceId } = await req.json() as { deviceId: string };
    if (!deviceId) return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });

    const [session] = await db
      .insert(sessions)
      .values({ deviceId, notes: "" })
      .returning();

    await db.update(devices).set({ status: "connected", lastSeen: new Date() }).where(eq(devices.id, deviceId));
    await db.insert(logs).values({ deviceId, action: "session_started", metadata: { sessionId: session.id } });

    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/sessions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
