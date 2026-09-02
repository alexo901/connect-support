import { NextRequest, NextResponse } from "next/server";
import { comparePassword, signToken } from "@/lib/auth";
import { db } from "@/db";
import { technicians } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body as { username: string; password: string };

    if (!username || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Check DB first
    let tech = null;
    try {
      const rows = await db
        .select()
        .from(technicians)
        .where(eq(technicians.username, username))
        .limit(1);
      tech = rows[0] || null;
    } catch {
      // DB might not be seeded yet — fall back to env vars
    }

    let valid = false;
    let techId = "env-admin";

    if (tech) {
      valid = await comparePassword(password, tech.passwordHash);
      techId = tech.id;
    } else {
      // Fallback: env-variable admin
      const envUser = process.env.ADMIN_USER || "admin";
      const envPass = process.env.ADMIN_PASS || "admin123";
      valid = username === envUser && password === envPass;
    }

    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = signToken({ sub: techId, username, role: "technician" });
    return NextResponse.json({ token, username });
  } catch (err) {
    console.error("[/api/auth/login]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
