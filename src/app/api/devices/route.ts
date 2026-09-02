import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { devices, logs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { verifyToken, extractBearerToken } from "@/lib/auth";

function authGuard(req: NextRequest) {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;
  try { return verifyToken(token); } catch { return null; }
}

// GET /api/devices — list all devices (tech only)
export async function GET(req: NextRequest) {
  if (!authGuard(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await db.select().from(devices).orderBy(desc(devices.createdAt));
    return NextResponse.json({ devices: rows });
  } catch (err) {
    console.error("[GET /api/devices]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/devices — create new device with support code
export async function POST(req: NextRequest) {
  if (!authGuard(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Generate unique 6-digit code
    let code = "";
    let attempts = 0;
    while (attempts < 50) {
      code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
      const existing = await db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.supportCode, code))
        .limit(1);
      if (!existing.length) break;
      attempts++;
    }

    const [device] = await db
      .insert(devices)
      .values({ supportCode: code, status: "offline" })
      .returning();

    await db.insert(logs).values({
      deviceId: device.id,
      action: "device_created",
      metadata: { supportCode: code },
    });

    return NextResponse.json({ device }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/devices]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
