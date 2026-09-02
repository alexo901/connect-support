import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code } = body as { code: string };

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid support code format" }, { status: 400 });
    }

    const rows = await db
      .select({
        id: devices.id,
        computerName: devices.computerName,
        supportCode: devices.supportCode,
        status: devices.status,
      })
      .from(devices)
      .where(eq(devices.supportCode, code))
      .limit(1);

    if (!rows.length) {
      return NextResponse.json({ error: "Support code not found" }, { status: 404 });
    }

    return NextResponse.json({ valid: true, device: rows[0] });
  } catch (err) {
    console.error("[/api/support/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
