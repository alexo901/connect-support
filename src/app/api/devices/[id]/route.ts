import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { devices, logs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, extractBearerToken } from "@/lib/auth";

function authGuard(req: NextRequest) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}

// PATCH /api/devices/[id] — update status / computerName
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
    const updates: Partial<typeof devices.$inferInsert> = {};
    if (body.status) updates.status = body.status;
    if (body.computerName) updates.computerName = body.computerName;
    if (body.lastSeen) updates.lastSeen = body.lastSeen;

    const [updated] = await db
      .update(devices)
      .set(updates)
      .where(eq(devices.id, id))
      .returning();

    return NextResponse.json({ device: updated });
  } catch (err) {
    console.error("[PATCH /api/devices/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/devices/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authGuard(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await db.insert(logs).values({ deviceId: id, action: "device_deleted" });
    await db.delete(devices).where(eq(devices.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/devices/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
