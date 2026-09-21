/**
 * Connect Support — Backend Signaling Engine
 * Node.js + Express + Socket.io
 * Deploy to Azure App Service on Linux
 */

"use strict";

require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server: IOServer } = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

// ── Environment ───────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 4000;

const JWT_SECRET =
  process.env.JWT_SECRET || "connect-support-secret";

const ADMIN_USER =
  process.env.ADMIN_USER || "admin";

const ADMIN_PASS =
  process.env.ADMIN_PASS || "admin123";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

// Azure Blob Storage
const AZURE_STORAGE_CONNECTION_STRING =
  process.env.AZURE_STORAGE_CONNECTION_STRING || "";

const AZURE_STORAGE_CONTAINER =
  process.env.AZURE_STORAGE_CONTAINER || "installers";

const INSTALLER_BLOB_NAME =
  process.env.INSTALLER_BLOB_NAME || "Connect Support Web Setup 1.0.3.exe";

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

// ── Azure Blob Storage ────────────────────────────────────────────────────────

let blobServiceClient = null;

try {
  if (AZURE_STORAGE_CONNECTION_STRING) {
    const { BlobServiceClient } =
      require("@azure/storage-blob");

    blobServiceClient =
      BlobServiceClient.fromConnectionString(
        AZURE_STORAGE_CONNECTION_STRING
      );

    console.log("[Azure Storage] Blob Storage configured");
  } else {
    console.warn(
      "[Azure Storage] AZURE_STORAGE_CONNECTION_STRING is not configured"
    );
  }
} catch (err) {
  console.error(
    "[Azure Storage] Could not initialize:",
    err.message
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function validateSupportCode(code) {
  if (!code || !/^\d{6}$/.test(String(code))) {
    return false;
  }

  // Development mode without Supabase
  if (!supabase) {
    return true;
  }

  const { data, error } = await supabase
    .from("devices")
    .select("id")
    .eq("support_code", String(code))
    .single();

  return !error && !!data;
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();

app.use(
  cors({
    origin: "*",
    credentials: false,
  })
);

app.use(
  express.json({
    limit: "100mb",
  })
);

// ── Privacy Media ─────────────────────────────────────────────────────────────

const mediaDirectory = path.join(
  __dirname,
  "..",
  "privacy-media"
);

fs.mkdirSync(mediaDirectory, {
  recursive: true,
});

function readMediaMetadata() {
  return fs
    .readdirSync(mediaDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(
          fs.readFileSync(
            path.join(mediaDirectory, name),
            "utf8"
          )
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.createdAt) -
        new Date(a.createdAt)
    );
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const httpServer = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────

const io = new IOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 50 * 1024 * 1024,
});

// ── Auth Middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid token",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REST ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "connect-support-backend",
    azureStorageConfigured: !!blobServiceClient,
  });
});

// ── Privacy Media ─────────────────────────────────────────────────────────────

app.get(
  "/api/privacy-media",
  requireAuth,
  (req, res) => {
    return res.json({
      media: readMediaMetadata(),
    });
  }
);

app.post(
  "/api/privacy-media",
  requireAuth,
  (req, res) => {
    try {
      const { name, mimeType, data } = req.body;

      const allowedTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
        "video/webm",
      ]);

      if (
        !name ||
        !allowedTypes.has(mimeType) ||
        typeof data !== "string"
      ) {
        return res.status(400).json({
          error:
            "Supported media: JPG, JPEG, PNG, WEBP, MP4, and WEBM.",
        });
      }

      const id = uuidv4();

      const extension =
        path.extname(name).toLowerCase() ||
        (mimeType.startsWith("video/")
          ? ".mp4"
          : ".jpg");

      const fileName = `${id}${extension}`;

      const content = Buffer.from(
        data.replace(
          /^data:[^;]+;base64,/,
          ""
        ),
        "base64"
      );

      fs.writeFileSync(
        path.join(
          mediaDirectory,
          fileName
        ),
        content
      );

      const media = {
        id,
        name,
        mimeType,
        fileName,
        createdAt: new Date().toISOString(),
        url: `/api/privacy-media/${id}/content`,
      };

      fs.writeFileSync(
        path.join(
          mediaDirectory,
          `${id}.json`
        ),
        JSON.stringify(media)
      );

      return res.status(201).json({
        media,
      });
    } catch (err) {
      console.error(
        "[POST /api/privacy-media]",
        err
      );

      return res.status(500).json({
        error: "Could not save media",
      });
    }
  }
);

app.get(
  "/api/privacy-media/:id/content",
  (req, res) => {
    const media = readMediaMetadata().find(
      (item) => item.id === req.params.id
    );

    if (!media) {
      return res.status(404).end();
    }

    const filePath = path.join(
      mediaDirectory,
      media.fileName
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).end();
    }

    return res
      .type(media.mimeType)
      .sendFile(filePath);
  }
);

// ── Login ─────────────────────────────────────────────────────────────────────

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          error: "Missing credentials",
        });
      }

      let valid = false;
      let techId = "env-admin";

      if (supabase) {
        const { data } = await supabase
          .from("technicians")
          .select("id, password_hash")
          .eq("username", username)
          .single();

        if (data) {
          valid = await bcrypt.compare(
            password,
            data.password_hash
          );

          techId = data.id;
        }
      }

      if (!valid) {
        valid =
          username === ADMIN_USER &&
          password === ADMIN_PASS;
      }

      if (!valid) {
        return res.status(401).json({
          error: "Invalid credentials",
        });
      }

      const token = jwt.sign(
        {
          sub: techId,
          username,
          role: "technician",
        },
        JWT_SECRET,
        {
          expiresIn: "12h",
        }
      );

      return res.json({
        token,
        username,
      });
    } catch (err) {
      console.error(
        "[/api/auth/login]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ── Verify Support Code ───────────────────────────────────────────────────────

app.post(
  "/api/support/verify",
  async (req, res) => {
    try {
      const { code } = req.body;

      if (
        !code ||
        !/^\d{6}$/.test(String(code))
      ) {
        return res.status(400).json({
          error: "Invalid support code",
        });
      }

      if (!supabase) {
        return res.json({
          valid: true,
          device: {
            supportCode: String(code),
            status: "offline",
          },
        });
      }

      const { data, error } = await supabase
        .from("devices")
        .select(
          "id, computer_name, support_code, status"
        )
        .eq(
          "support_code",
          String(code)
        )
        .single();

      if (error || !data) {
        return res.status(404).json({
          error: "Support code not found",
        });
      }

      return res.json({
        valid: true,
        device: formatDevice(data),
      });
    } catch (err) {
      console.error(
        "[/api/support/verify]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ── Get Devices ───────────────────────────────────────────────────────────────

app.get(
  "/api/devices",
  requireAuth,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json({
          devices: [],
        });
      }

      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      return res.json({
        devices: (data || []).map(
          formatDevice
        ),
      });
    } catch (err) {
      console.error(
        "[GET /api/devices]",
        err.message || err
      );

      return res.status(500).json({
        error: "Could not load devices",
        details:
          err.message ||
          "Database request failed",
      });
    }
  }
);

// ── Create Device ─────────────────────────────────────────────────────────────

app.post(
  "/api/devices",
  requireAuth,
  async (req, res) => {
    try {
      let code = "";
      let attempts = 0;

      while (attempts < 50) {
        code = String(
          Math.floor(
            Math.random() * 1000000
          )
        ).padStart(6, "0");

        if (!supabase) {
          break;
        }

        const { data } = await supabase
          .from("devices")
          .select("id")
          .eq(
            "support_code",
            code
          )
          .single();

        if (!data) {
          break;
        }

        attempts++;
      }

      if (!supabase) {
        return res.status(201).json({
          device: {
            id: uuidv4(),
            supportCode: code,
            status: "offline",
            computerName: "Pending",
          },
        });
      }

      const { data, error } = await supabase
        .from("devices")
        .insert({
          support_code: code,
          computer_name: "New Device",
          status: "offline",
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return res.status(201).json({
        device: formatDevice(data),
      });
    } catch (err) {
      console.error(
        "[POST /api/devices]",
        err.message || err
      );

      return res.status(500).json({
        error:
          "Could not create support token",
        details:
          err.message ||
          "Database request failed",
      });
    }
  }
);

// ── Delete Device ─────────────────────────────────────────────────────────────

app.delete(
  "/api/devices/:id",
  requireAuth,
  async (req, res) => {
    try {
      if (supabase) {
        const { error } = await supabase
          .from("devices")
          .delete()
          .eq(
            "id",
            req.params.id
          );

        if (error) {
          throw error;
        }
      }

      return res.json({
        success: true,
      });
    } catch (err) {
      console.error(
        "[DELETE /api/devices/:id]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ── Update Device ─────────────────────────────────────────────────────────────

app.patch(
  "/api/devices/:id",
  requireAuth,
  async (req, res) => {
    try {
      const computerName = String(
        req.body.computerName ||
          req.body.computer_name ||
          ""
      ).trim();

      if (!computerName) {
        return res.status(400).json({
          error: "Missing computerName",
        });
      }

      if (computerName.length > 100) {
        return res.status(400).json({
          error:
            "Device name is too long",
        });
      }

      if (!supabase) {
        return res.json({
          device: {
            id: req.params.id,
            computerName,
          },
        });
      }

      const { data, error } = await supabase
        .from("devices")
        .update({
          computer_name: computerName,
        })
        .eq(
          "id",
          req.params.id
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      return res.json({
        device: formatDevice(data),
      });
    } catch (err) {
      console.error(
        "[PATCH /api/devices/:id]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ── Get Sessions ──────────────────────────────────────────────────────────────

app.get(
  "/api/sessions",
  requireAuth,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json({
          sessions: [],
        });
      }

      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .order("started_at", {
          ascending: false,
        })
        .limit(50);

      if (error) {
        throw error;
      }

      return res.json({
        sessions: data || [],
      });
    } catch (err) {
      console.error(
        "[GET /api/sessions]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ── Create Session ────────────────────────────────────────────────────────────

app.post(
  "/api/sessions",
  requireAuth,
  async (req, res) => {
    try {
      const deviceId =
        req.body.deviceId ||
        req.body.device_id;

      if (!deviceId) {
        return res.status(400).json({
          error: "Missing deviceId",
        });
      }

      if (!supabase) {
        return res.status(201).json({
          session: {
            id: uuidv4(),
            deviceId,
            startedAt:
              new Date().toISOString(),
            notes: "",
          },
        });
      }

      const { data, error } = await supabase
        .from("sessions")
        .insert({
          device_id: deviceId,
          notes: "",
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      await supabase
        .from("devices")
        .update({
          status: "connected",
          last_seen:
            new Date().toISOString(),
        })
        .eq(
          "id",
          deviceId
        );

      return res.status(201).json({
        session: data,
      });
    } catch (err) {
      console.error(
        "[POST /api/sessions]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ── Update Session ────────────────────────────────────────────────────────────

app.patch(
  "/api/sessions/:id",
  requireAuth,
  async (req, res) => {
    try {
      const updates = {};

      if (req.body.notes !== undefined) {
        updates.notes = req.body.notes;
      }

      if (req.body.ended) {
        updates.ended_at =
          new Date().toISOString();
      }

      if (!supabase) {
        return res.json({
          session: {
            id: req.params.id,
            ...updates,
          },
        });
      }

      const { data, error } = await supabase
        .from("sessions")
        .update(updates)
        .eq(
          "id",
          req.params.id
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (
        req.body.ended &&
        data.device_id
      ) {
        await supabase
          .from("devices")
          .update({
            status: "offline",
          })
          .eq(
            "id",
            data.device_id
          );
      }

      return res.json({
        session: data,
      });
    } catch (err) {
      console.error(
        "[PATCH /api/sessions/:id]",
        err
      );

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Exact installer files available in Azure Blob Storage
const DOWNLOADABLE_INSTALLER_FILES = new Set([
  "Connect Support Web Setup 1.0.3.exe",
  "connect-support-agent-1.0.3-x64.nsis.7z",
  "latest.yml",
]);

function getInstallerContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".exe":
      return "application/octet-stream";

    case ".7z":
      return "application/x-7z-compressed";

    case ".yml":
    case ".yaml":
      return "text/yaml; charset=utf-8";

    default:
      return "application/octet-stream";
  }
}

async function streamInstallerFile(
  blobName,
  req,
  res,
  options = {}
) {
  try {
    if (!blobServiceClient) {
      return res.status(503).json({
        error: "Installer storage is not configured.",
      });
    }

    const containerClient =
      blobServiceClient.getContainerClient(
        AZURE_STORAGE_CONTAINER
      );

    const blockBlobClient =
      containerClient.getBlockBlobClient(
        blobName
      );

    const exists =
      await blockBlobClient.exists();

    if (!exists) {
      console.error(
        "[Installer] Blob not found:",
        AZURE_STORAGE_CONTAINER,
        blobName
      );

      return res.status(404).json({
        error: "Installer file not found",
        file: blobName,
      });
    }

    const downloadResponse =
      await blockBlobClient.download(0);

    if (!downloadResponse.readableStreamBody) {
      return res.status(500).json({
        error: "Could not read installer file",
      });
    }

    res.setHeader(
      "Content-Type",
      getInstallerContentType(blobName)
    );

    res.setHeader(
      "Cache-Control",
      options.noStore
        ? "no-store"
        : "public, max-age=3600"
    );

    if (options.attachment) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${options.downloadName || blobName}"`
      );
    }

    if (downloadResponse.contentLength) {
      res.setHeader(
        "Content-Length",
        downloadResponse.contentLength
      );
    }

    downloadResponse.readableStreamBody.on(
      "error",
      (err) => {
        console.error(
          "[Installer Stream Error]",
          blobName,
          err
        );

        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      }
    );

    downloadResponse.readableStreamBody.pipe(res);
  } catch (err) {
    console.error(
      "[streamInstallerFile]",
      blobName,
      err
    );

    if (!res.headersSent) {
      return res.status(500).json({
        error: "Could not download installer file",
        details: err.message,
      });
    }

    res.end();
  }
}

// ── Step 1: Verify support code ───────────────────────────────────────────────

app.get(
  "/api/download",
  async (req, res) => {
    try {
      const code = String(
        req.query.code || ""
      );

      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({
          error: "Invalid support code",
        });
      }

      const valid =
        await validateSupportCode(code);

      if (!valid) {
        return res.status(404).json({
          error: "Support code not found",
        });
      }

      return res.json({
        valid: true,
        code,
        fileName:
          "Connect Support Web Setup 1.0.3.exe",
        downloadUrl:
          `/api/download/installer?code=${encodeURIComponent(
            code
          )}`,
        instructions: [
          "Download the Connect Support Setup installer.",
          "Run the installer.",
          "The remaining application files will download automatically.",
          "The Connect Support Agent will start after installation.",
        ],
      });
    } catch (err) {
      console.error(
        "[GET /api/download]",
        err
      );

      return res.status(500).json({
        error: "Could not prepare download",
      });
    }
  }
);

// ── Step 2: Download the small web installer ─────────────────────────────────

app.get(
  "/api/download/installer",
  async (req, res) => {
    try {
      const code = String(
        req.query.code || ""
      );

      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({
          error: "Invalid support code",
        });
      }

      const valid =
        await validateSupportCode(code);

      if (!valid) {
        return res.status(404).json({
          error: "Support code not found",
        });
      }

      return streamInstallerFile(
        "Connect Support Web Setup 1.0.3.exe",
        req,
        res,
        {
          attachment: true,
          downloadName: "Connect Support Web Setup 1.0.3.exe",
          noStore: true,
        }
      );
    } catch (err) {
      console.error(
        "[GET /api/download/installer]",
        err
      );

      if (!res.headersSent) {
        return res.status(500).json({
          error: "Could not download installer",
          details: err.message,
        });
      }

      res.end();
    }
  }
);

app.get("/api/download/installer-file", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Invalid support code" });
    if (!(await validateSupportCode(code))) return res.status(404).json({ error: "Support code not found" });
    return streamInstallerFile("Connect Support Web Setup 1.0.3.exe", req, res, {
      attachment: true,
      downloadName: "Connect Support Web Setup 1.0.3.exe",
      noStore: true,
    });
  } catch (err) {
    console.error("[GET /api/download/installer-file]", err);
    return res.status(500).json({ error: "Could not download installer", details: err.message });
  }
});

// ── Step 3: NSIS Web installer package files ─────────────────────────────────
//
// Electron/NSIS installer automatically requests files like:
// /downloads/connect-support-agent-1.0.0-x64.nsis.7z
//
// These routes proxy those files from Azure Blob Storage.

app.get(
  "/downloads/:fileName",
  async (req, res) => {
    const fileName =
      decodeURIComponent(
        req.params.fileName || ""
      );

    if (
      !DOWNLOADABLE_INSTALLER_FILES.has(
        fileName
      )
    ) {
      console.warn(
        "[Installer] Invalid download request:",
        fileName
      );

      return res.status(404).json({
        error: "Installer file not found",
      });
    }

    await streamInstallerFile(
      fileName,
      req,
      res,
      {
        attachment: false,
        noStore: false,
      }
    );
  }
);

app.get(
  "/api/downloads/:fileName",
  async (req, res) => {
    const fileName = decodeURIComponent(req.params.fileName || "");
    if (!DOWNLOADABLE_INSTALLER_FILES.has(fileName)) {
      return res.status(404).json({ error: "Installer file not found" });
    }

    await streamInstallerFile(fileName, req, res, {
      attachment: false,
      noStore: false,
    });
  }
);

app.get(
  "/api/app-downloads/:fileName",
  async (req, res) => {
    const fileName = decodeURIComponent(req.params.fileName || "");
    if (!DOWNLOADABLE_INSTALLER_FILES.has(fileName)) {
      return res.status(404).json({ error: "Installer file not found" });
    }

    await streamInstallerFile(fileName, req, res, {
      attachment: false,
      noStore: false,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO SIGNALING
// ─────────────────────────────────────────────────────────────────────────────

// socketId → metadata
const socketMeta = new Map();

// supportCode → unattended state
const deviceAccessState = new Map();
// supportCode → currently registered client socket
const activeClientSockets = new Map();
const clientOfflineTimers = new Map();
const CLIENT_OFFLINE_GRACE_MS = 30000;

io.on("connection", (socket) => {
  console.log(
    "[Socket] connected:",
    socket.id
  );

  // ── Client Register ────────────────────────────────────────────────────────

  socket.on(
    "register-client",
    (data = {}) => {
      try {
        const {
          supportCode,
          computerName,
          osInfo,
          unattendedAccess,
          sessionId,
        } = data;

        if (!supportCode) {
          return;
        }

        const room =
          `device-${supportCode}`;

        socket.join(room);

        socketMeta.set(
          socket.id,
          {
            role: "client",
            deviceCode: supportCode,
            deviceId: supportCode,
            unattendedAccess:
              !!unattendedAccess,
          }
        );
        activeClientSockets.set(supportCode, socket.id);
        const pendingOffline = clientOfflineTimers.get(supportCode);
        if (pendingOffline) {
          clearTimeout(pendingOffline);
          clientOfflineTimers.delete(supportCode);
        }

        deviceAccessState.set(
          supportCode,
          {
            unattendedAccess:
              !!unattendedAccess,
          }
        );

        if (supabase) {
          supabase
            .from("devices")
            .update({
              status: sessionId ? "connected" : "waiting",
              computer_name:
                computerName ||
                "Unknown Device",
              os_info:
                osInfo || "",
              last_seen:
                new Date().toISOString(),
            })
            .eq(
              "support_code",
              supportCode
            )
            .then(({ error }) => {
              if (error) {
                console.error(
                  "[register-client database]",
                  error
                );
              }
            });
        }

        io.emit(
          "client-status-update",
          {
            supportCode,
            computerName:
              computerName ||
              "Unknown Device",
            osInfo: osInfo || "",
            status: sessionId ? "connected" : "waiting",
            sessionId,
            unattendedAccess:
              !!unattendedAccess,
            socketId: socket.id,
          }
        );

        console.log("[Backend] client-status-update waiting emitted", {
          supportCode,
          socketId: socket.id,
        });

        console.log(
          "[Socket] client registered:",
          supportCode,
          computerName,
          "unattended:",
          !!unattendedAccess
        );
      } catch (err) {
        console.error(
          "[register-client]",
          err
        );
      }
    }
  );

  // ── Technician Connect Request ─────────────────────────────────────────────

  socket.on(
    "tech-connect-request",
    (data = {}) => {
      try {
        const {
          supportCode,
          sessionId,
        } = data;

        if (!supportCode) {
          return;
        }

        const room =
          `device-${supportCode}`;

        const unattendedAccess =
          deviceAccessState.get(
            supportCode
          )?.unattendedAccess === true;

        socketMeta.set(
          socket.id,
          {
            role: "tech",
            deviceCode: supportCode,
            sessionId,
          }
        );

        socket.join(room);

        if (unattendedAccess) {
          io.to(room).emit(
            "connection-approved",
            {
              supportCode,
              sessionId,
            }
          );

          io.emit(
            "client-status-update",
            {
              supportCode,
              status: "connected",
              sessionId,
              unattendedAccess: true,
            }
          );

          console.log(
            "[Socket] unattended connect approved:",
            supportCode
          );

          return;
        }

        io.to(room).emit(
          "approval-request",
          {
            sessionId,
            techSocketId:
              socket.id,
          }
        );

        console.log(
          "[Socket] tech connect request:",
          supportCode
        );
      } catch (err) {
        console.error(
          "[tech-connect-request]",
          err
        );
      }
    }
  );

  // ── Client Approve ─────────────────────────────────────────────────────────

  socket.on(
    "client-approved-connection",
    (data = {}) => {
      try {
        const {
          supportCode,
          sessionId,
        } = data;

        if (!supportCode) {
          return;
        }

        const room =
          `device-${supportCode}`;

        io.to(room).emit(
          "connection-approved",
          {
            supportCode,
            sessionId,
          }
        );

        io.emit(
          "client-status-update",
          {
            supportCode,
            status: "connected",
            sessionId,
          }
        );
      } catch (err) {
        console.error(
          "[client-approved-connection]",
          err
        );
      }
    }
  );

  // ── Client Reject ──────────────────────────────────────────────────────────

  socket.on(
    "client-rejected-connection",
    (data = {}) => {
      try {
        const { supportCode } = data;

        if (!supportCode) {
          return;
        }

        io.to(
          `device-${supportCode}`
        ).emit(
          "connection-rejected",
          {
            supportCode,
          }
        );
      } catch (err) {
        console.error(
          "[client-rejected-connection]",
          err
        );
      }
    }
  );

  // ── WebRTC Signaling ───────────────────────────────────────────────────────

  socket.on(
    "webrtc-signaling",
    (data = {}) => {
      try {
        const { sessionId, supportCode } = data;

        if (!sessionId && !supportCode) {
          console.warn("[Backend] Dropping invalid WebRTC signaling payload", {
            socketId: socket.id,
            data,
          });
          return;
        }

        const targetRoom = sessionId
          ? `session:${sessionId}`
          : `room:${supportCode}`;

        socket.to(targetRoom).emit("webrtc-signaling", data);
        console.log("[Backend] WebRTC signaling forwarded", {
          socketId: socket.id,
          targetRoom,
          type: data.type,
          sessionId,
          supportCode,
        });
      } catch (err) {
        console.error("[webrtc-signaling]", err);
      }
    }
  );

  // ── Mouse ──────────────────────────────────────────────────────────────────

  socket.on(
    "mouse-event",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "mouse-event",
          data
        );
      } catch (err) {
        console.error(
          "[mouse-event]",
          err
        );
      }
    }
  );

  // ── Keyboard ───────────────────────────────────────────────────────────────

  socket.on(
    "keyboard-event",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "keyboard-event",
          data
        );
      } catch (err) {
        console.error(
          "[keyboard-event]",
          err
        );
      }
    }
  );

  // ── Chat ───────────────────────────────────────────────────────────────────

  socket.on(
    "chat-message",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "chat-message",
          data
        );
      } catch (err) {
        console.error(
          "[chat-message]",
          err
        );
      }
    }
  );

  // ── File Transfer ──────────────────────────────────────────────────────────

  socket.on(
    "file-chunk",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "file-chunk",
          data
        );
      } catch (err) {
        console.error(
          "[file-chunk]",
          err
        );
      }
    }
  );

  // ── Clipboard ──────────────────────────────────────────────────────────────

  socket.on(
    "clipboard-sync",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "clipboard-sync",
          data
        );
      } catch (err) {
        console.error(
          "[clipboard-sync]",
          err
        );
      }
    }
  );

  // ── Blank Screen ───────────────────────────────────────────────────────────

  socket.on(
    "toggle-blank-screen",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "toggle-blank-screen",
          {
            enabled: !!data.enabled,
          }
        );

        if (!data.enabled) {
          socket.to(
            `device-${data.supportCode}`
          ).emit(
            "change-privacy-media",
            {
              mediaType: "css",
              mediaKey:
                "default-blue",
            }
          );
        }
      } catch (err) {
        console.error(
          "[toggle-blank-screen]",
          err
        );
      }
    }
  );

  // ── Privacy Media Change ───────────────────────────────────────────────────

  socket.on(
    "change-privacy-media",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "change-privacy-media",
          {
            mediaType:
              data.mediaType,
            mediaKey:
              data.mediaKey,
            mediaUrl:
              data.mediaUrl,
          }
        );
      } catch (err) {
        console.error(
          "[change-privacy-media]",
          err
        );
      }
    }
  );

  // ── Input Lock ─────────────────────────────────────────────────────────────

  socket.on(
    "toggle-input-lock",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "toggle-input-lock",
          {
            enabled: !!data.enabled,
          }
        );
      } catch (err) {
        console.error(
          "[toggle-input-lock]",
          err
        );
      }
    }
  );

  // ── Monitor Switch ─────────────────────────────────────────────────────────

  socket.on(
    "switch-monitor",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "switch-monitor",
          {
            monitorIndex:
              data.monitorIndex,
          }
        );
      } catch (err) {
        console.error(
          "[switch-monitor]",
          err
        );
      }
    }
  );

  // ── Notes ──────────────────────────────────────────────────────────────────

  socket.on(
    "update-notes",
    (data = {}) => {
      try {
        if (!data.supportCode) return;

        socket.to(
          `device-${data.supportCode}`
        ).emit(
          "notes-updated",
          data
        );
      } catch (err) {
        console.error(
          "[update-notes]",
          err
        );
      }
    }
  );

  // ── End Session ────────────────────────────────────────────────────────────

  socket.on(
    "end-session",
    (data = {}) => {
      try {
        const supportCode =
          data.supportCode;

        if (!supportCode) {
          return;
        }

        const meta =
          socketMeta.get(socket.id);

        if (
          meta?.role !== "tech" ||
          meta.deviceCode !==
            supportCode
        ) {
          return;
        }

        io.to(
          `device-${supportCode}`
        ).emit(
          "tech-disconnected",
          {
            supportCode,
            intentional: true,
          }
        );

        io.emit(
          "client-status-update",
          {
            supportCode,
            status: "waiting",
            unattendedAccess:
              deviceAccessState.get(
                supportCode
              )?.unattendedAccess === true,
          }
        );

        if (supabase) {
          supabase
            .from("devices")
            .update({
              status: "waiting",
              last_seen:
                new Date().toISOString(),
            })
            .eq(
              "support_code",
              supportCode
            )
            .then(({ error }) => {
              if (error) {
                console.error(
                  "[end-session database]",
                  error
                );
              }
            });
        }

        console.log(
          "[Socket] tech ended session:",
          supportCode
        );
      } catch (err) {
        console.error(
          "[end-session]",
          err
        );
      }
    }
  );

  // ── Disconnect ─────────────────────────────────────────────────────────────

  socket.on(
    "disconnect",
    () => {
      try {
        const meta =
          socketMeta.get(socket.id);

        if (
          meta?.role === "client" &&
          meta.deviceCode
        ) {
          if (activeClientSockets.get(meta.deviceCode) !== socket.id) {
            socketMeta.delete(socket.id);
            console.log(
              "[Socket] stale client disconnected:",
              socket.id,
              meta.deviceCode
            );
            return;
          }
          activeClientSockets.delete(meta.deviceCode);
          const supportCode = meta.deviceCode;
          const offlineTimer = setTimeout(() => {
            clientOfflineTimers.delete(supportCode);
            if (activeClientSockets.has(supportCode)) return;
            io.emit("client-status-update", { supportCode, status: "offline" });
            if (supabase) {
              supabase
                .from("devices")
                .update({ status: "offline" })
                .eq("support_code", supportCode)
                .then(({ error }) => {
                  if (error) console.error("[disconnect database]", error);
                });
            }
            console.log("[Socket] client offline after reconnect grace:", supportCode);
          }, CLIENT_OFFLINE_GRACE_MS);
          clientOfflineTimers.set(supportCode, offlineTimer);
          console.log("[Socket] client disconnected; waiting for reconnect:", supportCode);
        }

        socketMeta.delete(
          socket.id
        );

        console.log(
          "[Socket] disconnected:",
          socket.id
        );
      } catch (err) {
        console.error(
          "[disconnect]",
          err
        );
      }
    }
  );
});

// ── Start Server ──────────────────────────────────────────────────────────────

function listenOnPort(port) {
  const server = httpServer.listen(
    port,
    "0.0.0.0",
    () => {
      console.log(
        `[Connect Support Backend] Listening on port ${port}`
      );
    }
  );

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const nextPort = port + 1;

      console.warn(
        `[Connect Support Backend] Port ${port} is busy. Retrying on ${nextPort}.`
      );

      listenOnPort(nextPort);
      return;
    }

    throw err;
  });
}

listenOnPort(PORT);

module.exports = {
  app,
  io,
};