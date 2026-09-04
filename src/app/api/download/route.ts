import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq } from "drizzle-orm";

// GET /api/download?code=123456
// Returns download metadata linking the installer to the support code
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid support code" }, { status: 400 });
  }

  try {
    const rows = await db
      .select({ id: devices.id, computerName: devices.computerName, status: devices.status })
      .from(devices)
      .where(eq(devices.supportCode, code))
      .limit(1);

    if (!rows.length) {
      return NextResponse.json({ error: "Support code not found" }, { status: 404 });
    }

    // Return the stub installer info — the actual .exe embeds the code
    // The installer is a lightweight stub that downloads the full agent at runtime
    const serverUrl = process.env.SOCKET_SERVER_URL ||
      "https://supportas-fxdwbkfyfgfbg2g5.canadacentral-01.azurewebsites.net";

    return NextResponse.json({
      valid: true,
      code,
      deviceId: rows[0].id,
      fileName: `ConnectSupport-Setup-${code}.exe`,
      // In production this would be a real signed .exe URL from Azure Blob / GitHub Releases
      downloadUrl: `/api/download/stub?code=${code}`,
      serverUrl,
      instructions: [
        "1. Download the installer below.",
        "2. Run the setup — it will install silently in the background.",
        "3. The agent will connect automatically using your support code.",
        "4. Wait for your technician to initiate the session.",
      ],
    });
  } catch (err) {
    console.error("[GET /api/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
