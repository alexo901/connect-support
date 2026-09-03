/**
 * Connect Support — Backend Signaling Engine
 * Node.js + Express + Socket.io
 * Deploy to Azure App Service on Linux
 */

"use strict";

require("dotenv").config();

const express   = require("express");
const http      = require("http");
const { Server: IOServer } = require("socket.io");
const cors      = require("cors");
const jwt       = require("jsonwebtoken");
const bcrypt    = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const fs        = require("fs");
const path      = require("path");

// ── Environment ───────────────────────────────────────────────────────────────
const PORT        = Number(process.env.PORT) || 4000;
const JWT_SECRET  = process.env.JWT_SECRET  || "connect-support-secret";
const ADMIN_USER  = process.env.ADMIN_USER  || "admin";
const ADMIN_PASS  = process.env.ADMIN_PASS  || "admin123";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Supabase client ───────────────────────────────────────────────────────────
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

function formatDevice(device) {
  if (!device) return device;
  return {
    ...device,
    computerName: device.computer_name,
    supportCode: device.support_code,
    lastSeen: device.last_seen,
    osInfo: device.os_info,
    ipAddress: device.ip_address,
  };
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "100mb" }));

const mediaDirectory = path.join(__dirname, "..", "privacy-media");
fs.mkdirSync(mediaDirectory, { recursive: true });

function readMediaMetadata() {
  return fs.readdirSync(mediaDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(mediaDirectory, name), "utf8")); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

const httpServer = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new IOServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 50 * 1024 * 1024,
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REST ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "connect-support-backend" });
});

app.get("/api/privacy-media", requireAuth, (req, res) => {
  return res.json({ media: readMediaMetadata() });
});

app.post("/api/privacy-media", requireAuth, (req, res) => {
  try {
    const { name, mimeType, data } = req.body;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]);
    if (!name || !allowedTypes.has(mimeType) || typeof data !== "string") {
      return res.status(400).json({ error: "Supported media: JPG, JPEG, PNG, WEBP, MP4, and WEBM." });
    }
    const id = uuidv4();
    const extension = path.extname(name).toLowerCase() || (mimeType.startsWith("video/") ? ".mp4" : ".jpg");
    const fileName = `${id}${extension}`;
    const content = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    fs.writeFileSync(path.join(mediaDirectory, fileName), content);
    const media = { id, name, mimeType, fileName, createdAt: new Date().toISOString(), url: `/api/privacy-media/${id}/content` };
    fs.writeFileSync(path.join(mediaDirectory, `${id}.json`), JSON.stringify(media));
    return res.status(201).json({ media });
  } catch (err) {
    console.error("[POST /api/privacy-media]", err);
    return res.status(500).json({ error: "Could not save media" });
  }
});

app.get("/api/privacy-media/:id/content", (req, res) => {
  const media = readMediaMetadata().find((item) => item.id === req.params.id);
  if (!media) return res.status(404).end();
  const filePath = path.join(mediaDirectory, media.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.type(media.mimeType).sendFile(filePath);
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    let valid = false;
    let techId = "env-admin";

    // Try Supabase first
    if (supabase) {
      const { data } = await supabase
        .from("technicians")
        .select("id, password_hash")
        .eq("username", username)
        .single();

      if (data) {
        valid = await bcrypt.compare(password, data.password_hash);
        techId = data.id;
      }
    }

    // Fallback to env vars
    if (!valid) {
      valid = username === ADMIN_USER && password === ADMIN_PASS;
    }

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: techId, username, role: "technician" },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    return res.json({ token, username });
  } catch (err) {
    console.error("[/api/auth/login]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/support/verify ──────────────────────────────────────────────────
app.post("/api/support/verify", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Invalid support code" });
    }

    if (!supabase) {
      // Dev mode: accept any 6-digit code
      return res.json({ valid: true, device: { supportCode: code, status: "offline" } });
    }

    const { data, error } = await supabase
      .from("devices")
      .select("id, computer_name, support_code, status")
      .eq("support_code", code)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Support code not found" });
    }

    return res.json({ valid: true, device: data });
  } catch (err) {
    console.error("[/api/support/verify]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/devices ──────────────────────────────────────────────────────────
app.get("/api/devices", requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ devices: [] });
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({ devices: (data || []).map(formatDevice) });
  } catch (err) {
    console.error("[GET /api/devices]", err.message || err);
    return res.status(500).json({ error: "Could not load devices", details: err.message || "Database request failed" });
  }
});

// ── POST /api/devices ─────────────────────────────────────────────────────────
app.post("/api/devices", requireAuth, async (req, res) => {
  try {
    // Generate unique 6-digit code
    let code = "";
    let attempts = 0;
    while (attempts < 50) {
      code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
      if (!supabase) break;
      const { data } = await supabase
        .from("devices")
        .select("id")
        .eq("support_code", code)
        .single();
      if (!data) break;
      attempts++;
    }

    if (!supabase) {
      return res.status(201).json({
        device: { id: uuidv4(), supportCode: code, status: "offline", computerName: "Pending" }
      });
    }

    const { data, error } = await supabase
      .from("devices")
      .insert({ support_code: code, computer_name: "New Device", status: "offline" })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ device: formatDevice(data) });
  } catch (err) {
    console.error("[POST /api/devices]", err.message || err);
    return res.status(500).json({ error: "Could not create support token", details: err.message || "Database request failed" });
  }
});

// ── DELETE /api/devices/:id ───────────────────────────────────────────────────
app.delete("/api/devices/:id", requireAuth, async (req, res) => {
  try {
    if (supabase) {
      await supabase.from("devices").delete().eq("id", req.params.id);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/devices/:id]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/devices/:id ───────────────────────────────────────────────────
app.patch("/api/devices/:id", requireAuth, async (req, res) => {
  try {
    const computerName = String(req.body.computerName || req.body.computer_name || "").trim();
    if (!computerName) return res.status(400).json({ error: "Missing computerName" });
    if (computerName.length > 100) return res.status(400).json({ error: "Device name is too long" });

    if (!supabase) {
      return res.json({ device: { id: req.params.id, computerName } });
    }

    const { data, error } = await supabase
      .from("devices")
      .update({ computer_name: computerName })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ device: formatDevice(data) });
  } catch (err) {
    console.error("[PATCH /api/devices/:id]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/sessions ─────────────────────────────────────────────────────────
app.get("/api/sessions", requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json({ sessions: [] });
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    return res.json({ sessions: data || [] });
  } catch (err) {
    console.error("[GET /api/sessions]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/sessions ────────────────────────────────────────────────────────
app.post("/api/sessions", requireAuth, async (req, res) => {
  try {
    const deviceId = req.body.deviceId || req.body.device_id;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    if (!supabase) {
      return res.status(201).json({
        session: { id: uuidv4(), deviceId, startedAt: new Date().toISOString(), notes: "" }
      });
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({ device_id: deviceId, notes: "" })
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from("devices")
      .update({ status: "connected", last_seen: new Date().toISOString() })
      .eq("id", deviceId);

    return res.status(201).json({ session: data });
  } catch (err) {
    console.error("[POST /api/sessions]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/sessions/:id ───────────────────────────────────────────────────
app.patch("/api/sessions/:id", requireAuth, async (req, res) => {
  try {
    const updates = {};
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.ended) updates.ended_at = new Date().toISOString();

    if (!supabase) {
      return res.json({ session: { id: req.params.id, ...updates } });
    }

    const { data, error } = await supabase
      .from("sessions")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    if (req.body.ended && data.device_id) {
      await supabase
        .from("devices")
        .update({ status: "offline" })
        .eq("id", data.device_id);
    }

    return res.json({ session: data });
  } catch (err) {
    console.error("[PATCH /api/sessions/:id]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/download ─────────────────────────────────────────────────────────
app.get("/api/download", async (req, res) => {
  const code = req.query.code;
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Invalid support code" });
  }

  const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

  if (supabase) {
    const { data } = await supabase
      .from("devices")
      .select("id")
      .eq("support_code", code)
      .single();
    if (!data) return res.status(404).json({ error: "Support code not found" });
  }

  return res.json({
    valid: true,
    code,
    fileName: `ConnectSupport-Setup-${code}.ps1`,
    downloadUrl: `/api/download/stub?code=${code}`,
    serverUrl,
    instructions: [
      "Download and run the installer.",
      "The agent installs silently with no visible window.",
      "It automatically connects using your support code.",
      "Wait for your technician to start the session.",
    ],
  });
});

// ── GET /api/download/stub ────────────────────────────────────────────────────
app.get("/api/download/stub", (req, res) => {
  const code = req.query.code || "000000";
  const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

  const lines = [
    "# Connect Support Agent Installer",
    `# Support Code: ${code}`,
    "# Auto-generated installer stub",
    "",
    "$ErrorActionPreference = 'Stop'",
    `$serverUrl = '${serverUrl}'`,
    `$supportCode = '${code}'`,
    "$agentDir = Join-Path $env:LOCALAPPDATA 'ConnectSupport'",
    "$agentExe = Join-Path $agentDir 'ConnectSupportAgent.exe'",
    "$agentZip = Join-Path $env:TEMP 'cs-agent.zip'",
    "",
    "Write-Host 'Connect Support - Installing agent...'",
    "New-Item -ItemType Directory -Force -Path $agentDir | Out-Null",
    "$releaseUrl = 'https://github.com/YOUR_ORG/connect-support/releases/latest/download/ConnectSupportAgent-win32-x64.zip'",
    "Invoke-WebRequest -Uri $releaseUrl -OutFile $agentZip -UseBasicParsing",
    "Expand-Archive -Path $agentZip -DestinationPath $agentDir -Force",
    "Remove-Item $agentZip",
    "$config = @{ serverUrl = $serverUrl; supportCode = $supportCode } | ConvertTo-Json",
    "Set-Content -Path (Join-Path $agentDir 'config.json') -Value $config",
    "$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
    "Set-ItemProperty -Path $regPath -Name 'ConnectSupportAgent' -Value \"$agentExe --hidden\"",
    "Start-Process -FilePath $agentExe -ArgumentList '--hidden','--code',$supportCode,'--server',$serverUrl -WindowStyle Hidden",
    "Write-Host 'Connect Support agent installed and running silently.'",
  ];

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="ConnectSupport-Setup-${code}.ps1"`);
  res.send(lines.join("\n"));
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO SIGNALING
// ─────────────────────────────────────────────────────────────────────────────

// Maps: socketId → { role, deviceCode, sessionId }
const socketMeta = new Map();
const deviceAccessState = new Map();

io.on("connection", (socket) => {
  console.log("[Socket] connected:", socket.id);

  // ── CLIENT: register with support code ────────────────────────────────────
  socket.on("register-client", (data) => {
    try {
      const { supportCode, computerName, osInfo, unattendedAccess } = data;
      const room = `device-${supportCode}`;
      socket.join(room);
      socketMeta.set(socket.id, { role: "client", deviceCode: supportCode, unattendedAccess: !!unattendedAccess });
      deviceAccessState.set(supportCode, { unattendedAccess: !!unattendedAccess });

      // Update DB
      if (supabase) {
        supabase
          .from("devices")
          .update({
            status: "waiting",
            computer_name: computerName,
            os_info: osInfo || "",
            last_seen: new Date().toISOString(),
          })
          .eq("support_code", supportCode)
          .then(() => {})
          .catch(console.error);
      }

      io.emit("client-status-update", {
        supportCode,
        computerName,
        osInfo: osInfo || "",
        status: "waiting",
        unattendedAccess: !!unattendedAccess,
        socketId: socket.id,
      });

      console.log("[Socket] client registered:", supportCode, computerName, "unattended:", !!unattendedAccess);
    } catch (err) {
      console.error("[register-client]", err);
    }
  });

  // ── TECH: request connection ───────────────────────────────────────────────
  socket.on("tech-connect-request", (data) => {
    try {
      const { supportCode, sessionId } = data;
      const room = `device-${supportCode}`;
      const unattendedAccess = deviceAccessState.get(supportCode)?.unattendedAccess === true;
      socketMeta.set(socket.id, { role: "tech", deviceCode: supportCode, sessionId });
      socket.join(room);

      if (unattendedAccess) {
        io.to(room).emit("connection-approved", { supportCode, sessionId });
        io.emit("client-status-update", { supportCode, status: "connected", sessionId, unattendedAccess: true });
        console.log("[Socket] unattended connect approved:", supportCode);
        return;
      }

      io.to(room).emit("approval-request", { sessionId, techSocketId: socket.id });
      console.log("[Socket] tech connect request:", supportCode);
    } catch (err) {
      console.error("[tech-connect-request]", err);
    }
  });

  // ── CLIENT: approve ────────────────────────────────────────────────────────
  socket.on("client-approved-connection", (data) => {
    try {
      const { supportCode, sessionId } = data;
      const room = `device-${supportCode}`;
      io.to(room).emit("connection-approved", { supportCode, sessionId });
      io.emit("client-status-update", { supportCode, status: "connected", sessionId });
    } catch (err) {
      console.error("[client-approved-connection]", err);
    }
  });

  // ── CLIENT: reject ─────────────────────────────────────────────────────────
  socket.on("client-rejected-connection", (data) => {
    try {
      const { supportCode } = data;
      io.to(`device-${supportCode}`).emit("connection-rejected", { supportCode });
    } catch (err) {
      console.error("[client-rejected-connection]", err);
    }
  });

  // ── STREAM FRAME ───────────────────────────────────────────────────────────
  socket.on("stream-frame", (data) => {
    try {
      const meta = socketMeta.get(socket.id);
      const supportCode = data?.supportCode;
      if (meta?.role !== "client" || !supportCode || meta.deviceCode !== supportCode || typeof data.frame !== "string" || !data.frame) {
        console.warn("[Backend] Invalid stream frame", { socketId: socket.id, supportCode, role: meta?.role, deviceCode: meta?.deviceCode });
        return;
      }
      const room = `device-${supportCode}`;
      console.log("[Backend] Frame received", { supportCode, sessionId: data.sessionId, bytes: data.frame.length });
      const technicianSockets = [...(io.sockets.adapter.rooms.get(room) || [])].filter((socketId) => {
        const targetMeta = socketMeta.get(socketId);
        return targetMeta?.role === "tech" && (!data.sessionId || targetMeta.sessionId === data.sessionId);
      });
      if (!technicianSockets.length) {
        console.warn("[Backend] No matching technician socket for frame", { room, sessionId: data.sessionId });
        return;
      }
      io.to(technicianSockets).emit("stream-frame", data);
      console.log("[Backend] Frame forwarded", { room, sessionId: data.sessionId, targets: technicianSockets.length });
    } catch (err) { console.error("[stream-frame]", err); }
  });

  // ── MOUSE EVENT ────────────────────────────────────────────────────────────
  socket.on("mouse-event", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("mouse-event", data);
    } catch (err) { console.error("[mouse-event]", err); }
  });

  // ── KEYBOARD EVENT ─────────────────────────────────────────────────────────
  socket.on("keyboard-event", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("keyboard-event", data);
    } catch (err) { console.error("[keyboard-event]", err); }
  });

  // ── CHAT MESSAGE ───────────────────────────────────────────────────────────
  socket.on("chat-message", (data) => {
    try {
      io.to(`device-${data.supportCode}`).emit("chat-message", data);
    } catch (err) { console.error("[chat-message]", err); }
  });

  // ── FILE CHUNK ─────────────────────────────────────────────────────────────
  socket.on("file-chunk", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("file-chunk", data);
    } catch (err) { console.error("[file-chunk]", err); }
  });

  // ── CLIPBOARD ──────────────────────────────────────────────────────────────
  socket.on("clipboard-sync", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("clipboard-sync", data);
    } catch (err) { console.error("[clipboard-sync]", err); }
  });

  // ── BLANK SCREEN ───────────────────────────────────────────────────────────
  socket.on("toggle-blank-screen", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("toggle-blank-screen", { enabled: data.enabled });
      if (!data.enabled) {
        socket.to(`device-${data.supportCode}`).emit("change-privacy-media", { mediaType: "css", mediaKey: "default-blue" });
      }
    } catch (err) { console.error("[toggle-blank-screen]", err); }
  });

  // ── CHANGE PRIVACY MEDIA ───────────────────────────────────────────────────
  socket.on("change-privacy-media", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("change-privacy-media", {
        mediaType: data.mediaType,
        mediaKey: data.mediaKey,
        mediaUrl: data.mediaUrl,
      });
    } catch (err) { console.error("[change-privacy-media]", err); }
  });

  // ── INPUT LOCK ─────────────────────────────────────────────────────────────
  socket.on("toggle-input-lock", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("toggle-input-lock", { enabled: data.enabled });
    } catch (err) { console.error("[toggle-input-lock]", err); }
  });

  // ── MONITOR SWITCH ─────────────────────────────────────────────────────────
  socket.on("switch-monitor", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("switch-monitor", { monitorIndex: data.monitorIndex });
    } catch (err) { console.error("[switch-monitor]", err); }
  });

  // ── NOTES UPDATE ───────────────────────────────────────────────────────────
  socket.on("update-notes", (data) => {
    try {
      socket.to(`device-${data.supportCode}`).emit("notes-updated", data);
    } catch (err) { console.error("[update-notes]", err); }
  });

  // ── TECH: explicitly end session ───────────────────────────────────────────
  socket.on("end-session", (data) => {
    try {
      const supportCode = data?.supportCode;
      if (!supportCode) return;
      const meta = socketMeta.get(socket.id);
      if (meta?.role !== "tech" || meta.deviceCode !== supportCode) return;
      io.to(`device-${supportCode}`).emit("tech-disconnected", { supportCode, intentional: true });
      io.emit("client-status-update", {
        supportCode,
        status: "waiting",
        unattendedAccess: deviceAccessState.get(supportCode)?.unattendedAccess === true,
      });
      if (supabase) {
        supabase
          .from("devices")
          .update({ status: "waiting", last_seen: new Date().toISOString() })
          .eq("support_code", supportCode)
          .then(() => {})
          .catch(console.error);
      }
      console.log("[Socket] tech ended session:", supportCode);
    } catch (err) {
      console.error("[end-session]", err);
    }
  });

  // ── DISCONNECT ─────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    try {
      const meta = socketMeta.get(socket.id);
      if (meta?.role === "client" && meta.deviceCode) {
        io.emit("client-status-update", { supportCode: meta.deviceCode, status: "offline" });
        if (supabase) {
          supabase
            .from("devices")
            .update({ status: "offline" })
            .eq("support_code", meta.deviceCode)
            .then(() => {})
            .catch(console.error);
        }
      }
      socketMeta.delete(socket.id);
      console.log("[Socket] disconnected:", socket.id);
    } catch (err) {
      console.error("[disconnect]", err);
    }
  });
});

// ── Start server ───────────────────────────────────────────────────────────────
function listenOnPort(port) {
  const server = httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[Connect Support Backend] Listening on port ${port}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const nextPort = port + 1;
      console.warn(`[Connect Support Backend] Port ${port} is busy. Retrying on ${nextPort}.`);
      listenOnPort(nextPort);
      return;
    }

    throw err;
  });
}

listenOnPort(PORT);

module.exports = { app, io };
