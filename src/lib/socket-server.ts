import { Server as IOServer } from "socket.io";
import type { Server as HTTPServer } from "http";

declare global {
  // eslint-disable-next-line no-var
  var _io: IOServer | undefined;
}

export function getIO(): IOServer | undefined {
  return global._io;
}

export function initIO(httpServer: HTTPServer): IOServer {
  if (global._io) return global._io;

  const io = new IOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 50 * 1024 * 1024, // 50 MB for file chunks
  });

  // ── Room / connection tracking maps ──────────────────────────
  // socketId → { role: 'client'|'tech', deviceId, sessionId? }
  const socketMeta = new Map<
    string,
    { role: "client" | "tech"; deviceId?: string; sessionId?: string }
  >();

  io.on("connection", (socket) => {
    console.log("[Socket] connected:", socket.id);

    // ── CLIENT AGENT: registers itself with a support code ────
    socket.on(
      "register-client",
      (data: { supportCode: string; computerName: string; osInfo?: string }) => {
        const room = `device-${data.supportCode}`;
        socket.join(room);
        socketMeta.set(socket.id, { role: "client", deviceId: data.supportCode });

        // Notify dashboard that this code is now waiting
        io.emit("client-status-update", {
          supportCode: data.supportCode,
          computerName: data.computerName,
          osInfo: data.osInfo || "",
          status: "waiting",
          socketId: socket.id,
        });

        console.log("[Socket] client registered:", data.supportCode, data.computerName);
      }
    );

    // ── TECH: request connection to a device ──────────────────
    socket.on(
      "tech-connect-request",
      (data: { supportCode: string; sessionId: string }) => {
        const room = `device-${data.supportCode}`;
        socketMeta.set(socket.id, {
          role: "tech",
          deviceId: data.supportCode,
          sessionId: data.sessionId,
        });
        socket.join(room);

        // Ask client for approval
        io.to(room).emit("approval-request", {
          sessionId: data.sessionId,
          techSocketId: socket.id,
        });

        console.log("[Socket] tech connect request:", data.supportCode);
      }
    );

    // ── CLIENT: user approved the connection ──────────────────
    socket.on(
      "client-approved-connection",
      (data: { supportCode: string; sessionId: string }) => {
        const room = `device-${data.supportCode}`;
        io.to(room).emit("connection-approved", {
          supportCode: data.supportCode,
          sessionId: data.sessionId,
        });

        io.emit("client-status-update", {
          supportCode: data.supportCode,
          status: "connected",
          sessionId: data.sessionId,
        });
      }
    );

    // ── CLIENT: user rejected the connection ──────────────────
    socket.on(
      "client-rejected-connection",
      (data: { supportCode: string }) => {
        const room = `device-${data.supportCode}`;
        io.to(room).emit("connection-rejected", { supportCode: data.supportCode });
      }
    );

    // ── STREAMING: client → tech screen frames ────────────────
    socket.on(
      "stream-frame",
      (data: { supportCode: string; frame: string; monitors?: number; activeMonitor?: number }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("stream-frame", data);
      }
    );

    // ── CONTROL: tech → client mouse events ──────────────────
    socket.on(
      "mouse-event",
      (data: { supportCode: string; type: string; x: number; y: number; button?: number }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("mouse-event", data);
      }
    );

    // ── CONTROL: tech → client keyboard events ───────────────
    socket.on(
      "keyboard-event",
      (data: { supportCode: string; type: string; key: string; modifiers?: string[] }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("keyboard-event", data);
      }
    );

    // ── CHAT: bidirectional messages ─────────────────────────
    socket.on(
      "chat-message",
      (data: { supportCode: string; sender: string; message: string; timestamp: string }) => {
        const room = `device-${data.supportCode}`;
        io.to(room).emit("chat-message", data);
      }
    );

    // ── FILE TRANSFER: chunked relay ──────────────────────────
    socket.on(
      "file-chunk",
      (data: {
        supportCode: string;
        direction: "upload" | "download";
        fileName: string;
        chunkIndex: number;
        totalChunks: number;
        chunk: string;
        fileId: string;
      }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("file-chunk", data);
      }
    );

    // ── CLIPBOARD: relay ──────────────────────────────────────
    socket.on(
      "clipboard-sync",
      (data: { supportCode: string; content: string; direction: "to-client" | "to-tech" }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("clipboard-sync", data);
      }
    );

    // ── PRIVACY: blank screen curtain ─────────────────────────
    socket.on(
      "toggle-blank-screen",
      (data: { supportCode: string; enabled: boolean }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("toggle-blank-screen", { enabled: data.enabled });
      }
    );

    // ── PRIVACY: switch curtain media asset ───────────────────
    socket.on(
      "change-privacy-media",
      (data: { supportCode: string; mediaType: string; mediaKey: string }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("change-privacy-media", {
          mediaType: data.mediaType,
          mediaKey: data.mediaKey,
        });
      }
    );

    // ── INPUT LOCK: keyboard/mouse/touch block ────────────────
    socket.on(
      "toggle-input-lock",
      (data: { supportCode: string; enabled: boolean }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("toggle-input-lock", { enabled: data.enabled });
      }
    );

    // ── MONITOR SWITCH ────────────────────────────────────────
    socket.on(
      "switch-monitor",
      (data: { supportCode: string; monitorIndex: number }) => {
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("switch-monitor", { monitorIndex: data.monitorIndex });
      }
    );

    // ── SESSION NOTES: sync from tech to server ───────────────
    socket.on(
      "update-notes",
      (data: { supportCode: string; sessionId: string; notes: string }) => {
        // Broadcast back to room so all tabs stay in sync
        const room = `device-${data.supportCode}`;
        socket.to(room).emit("notes-updated", data);
      }
    );

    // ── DISCONNECT ────────────────────────────────────────────
    socket.on("disconnect", () => {
      const meta = socketMeta.get(socket.id);
      if (meta?.role === "client" && meta.deviceId) {
        io.emit("client-status-update", {
          supportCode: meta.deviceId,
          status: "offline",
        });
      }
      if (meta?.role === "tech" && meta.deviceId) {
        const room = `device-${meta.deviceId}`;
        io.to(room).emit("tech-disconnected", { supportCode: meta.deviceId });
      }
      socketMeta.delete(socket.id);
      console.log("[Socket] disconnected:", socket.id);
    });
  });

  global._io = io;
  return io;
}
