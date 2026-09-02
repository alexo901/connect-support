import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", service: "connect-support", db: "connected" });
  } catch {
    return NextResponse.json({ status: "ok", service: "connect-support", db: "unavailable" });
  }
}
