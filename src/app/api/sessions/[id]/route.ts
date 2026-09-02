import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, devices, logs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, extractBearerToken } from "@/lib/auth";

function authGuard(req: NextRequest) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}

// PATCH /api/sessions/[id] — update notes or end session
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authGuard(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.ended) {
      updates.endedAt = new Date();
    }

    const [updated] = await db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.id, id))
      .returning();

    if (body.ended && updated.deviceId) {
      await db
        .update(devices)
        .set({ status: "offline" })
        .where(eq(devices.id, updated.deviceId));
      await db.insert(logs).values({
        deviceId: updated.deviceId,
        action: "session_ended",
        metadata: { sessionId: id },
      });
    }

    return NextResponse.json({ session: updated });
  } catch (err) {
    console.error("[PATCH /api/sessions/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
