"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { io, Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Device {
  id: string;
  computerName: string;
  supportCode: string;
  status: "offline" | "waiting" | "connected";
  lastSeen?: string;
  osInfo?: string;
  socketId?: string;
}

interface Session {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt?: string;
  notes: string;
}

interface ChatMsg {
  sender: "technician" | "client";
  message: string;
  timestamp: string;
}

interface FileTransfer {
  fileId: string;
  fileName: string;
  progress: number;
  direction: "upload" | "download";
  chunks: string[];
  totalChunks: number;
}

const PRIVACY_MEDIA = [
  { key: "default-blue",     label: "Default Deep Blue",         type: "css" },
  { key: "matrix-loop",      label: "Matrix Loop",               type: "css" },
  { key: "maintenance-anim", label: "Maintenance Animation",     type: "css" },
  { key: "custom-video",     label: "Maintenance Video",         type: "video" },
];

// ─── Dashboard Component ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const token = typeof window !== "undefined" ? localStorage.getItem("cs_token") : null;
  const username = typeof window !== "undefined" ? localStorage.getItem("cs_username") : "Technician";

  // Core state
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Remote session state
  const [sessionActive, setSessionActive] = useState(false);
  const [blankScreen, setBlankScreen] = useState(false);
  const [inputLocked, setInputLocked] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState("default-blue");
  const [monitors, setMonitors] = useState(1);
  const [activeMonitor, setActiveMonitor] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [hasReceivedFrame, setHasReceivedFrame] = useState(false);
  const [streamStatus, setStreamStatus] = useState("Waiting for screen stream…");

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Notes
  const [notes, setNotes] = useState("");

  // File transfer
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clipboard
  const [clipboardStatus, setClipboardStatus] = useState("");

  // UI state
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [notification, setNotification] = useState<{ msg: string; type: "info"|"success"|"error" } | null>(null);

  // Popup: new client connected
  const [newClientPopup, setNewClientPopup] = useState<Device | null>(null);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCountRef = useRef(0);

  // Auth guard
  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    fetchDevices();
    fetchSessions();
    const refreshTimer = window.setInterval(fetchDevices, 10000);
    return () => window.clearInterval(refreshTimer);
  }, [token]);

  // Socket.io setup
  useEffect(() => {
    if (!token) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ||
      "https://supportas-fxdwbkfyfgfbg2g5.canadacentral-01.azurewebsites.net";
    const socket = io(socketUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      notify("Connected to signaling server", "success");
    });
    socket.on("disconnect", () => {
      setIsConnected(false);
    });
    socket.on("connect_error", (error) => {
      console.error("[Dashboard] Socket connection error:", error.message);
    });

    // A client just came online
    socket.on("client-status-update", (data: Partial<Device> & { supportCode: string; status: string }) => {
      console.log("[Dashboard] Client status update:", data);
      setDevices((prev) => {
        const idx = prev.findIndex((d) => d.supportCode === data.supportCode);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...data } as Device;
          return updated;
        }
        fetchDevices();
        return prev;
      });
    });

    // Connection approved by client
    socket.on("connection-approved", async (data: { supportCode: string; sessionId: string }) => {
      notify(`Client approved connection (${data.supportCode})`, "success");
      setSessionActive(true);
    });

    socket.on("connection-rejected", (data: { supportCode: string }) => {
      notify(`Client rejected connection (${data.supportCode})`, "error");
    });

    // Screen frames
    socket.on("stream-frame", (data: { frame: string; monitors?: number; activeMonitor?: number }) => {
      console.log("[Dashboard] Frame received", {
        bytes: data?.frame?.length || 0,
        hasCanvas: !!canvasRef.current,
      });
      if (!data?.frame) {
        setStreamStatus("Backend sent an empty frame");
        return;
      }
      if (!canvasRef.current) {
        setStreamStatus("Frame received before canvas was ready");
        return;
      }
      setHasReceivedFrame(true);
      setStreamStatus("Streaming");
      frameCountRef.current++;
      if (data.monitors) setMonitors(data.monitors);

      const img = new globalThis.Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx || !canvasRef.current) return;
        if (
          canvasRef.current.width !== img.width ||
          canvasRef.current.height !== img.height
        ) {
          canvasRef.current.width = img.width;
          canvasRef.current.height = img.height;
        }
        ctx.drawImage(img, 0, 0);
      };
      img.onerror = () => {
        console.error("[Dashboard] Frame decode failed");
        setStreamStatus("Frame received but JPEG decode failed");
      };
      img.src = `data:image/jpeg;base64,${data.frame}`;
    });

    // Chat
    socket.on("chat-message", (data: ChatMsg) => {
      setChatMessages((prev) => [...prev, data]);
    });

    // File chunk (download direction: from client to tech)
    socket.on("file-chunk", (data: { fileId: string; fileName: string; chunkIndex: number; totalChunks: number; chunk: string; direction: string }) => {
      if (data.direction !== "download") return;
      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.fileId === data.fileId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx].chunks[data.chunkIndex] = data.chunk;
          updated[idx].progress = Math.round(((data.chunkIndex + 1) / data.totalChunks) * 100);
          if (data.chunkIndex === data.totalChunks - 1) {
            // Reconstruct and download
            const allChunks = updated[idx].chunks;
            const binary = atob(allChunks.join(""));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = data.fileName; a.click();
            URL.revokeObjectURL(url);
          }
          return updated;
        }
        return [...prev, {
          fileId: data.fileId, fileName: data.fileName,
          progress: Math.round((1 / data.totalChunks) * 100),
          direction: "download", chunks: [data.chunk], totalChunks: data.totalChunks,
        }];
      });
    });

    // Clipboard
    socket.on("clipboard-sync", (data: { content: string; direction: string }) => {
      if (data.direction === "to-tech") {
        navigator.clipboard.writeText(data.content).catch(() => {});
        setClipboardStatus("Clipboard received from client");
        setTimeout(() => setClipboardStatus(""), 3000);
      }
    });

    // Notes sync
    socket.on("notes-updated", (data: { notes: string }) => setNotes(data.notes));

    // Tech disconnected (self echo)
    socket.on("tech-disconnected", () => {
      setSessionActive(false);
      setHasReceivedFrame(false);
    });

    // FPS counter
    fpsTimerRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      setFrameCount(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      socket.disconnect();
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
    };
  }, [token]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── API helpers ─────────────────────────────────────────────────────────────
  async function fetchDevices() {
    try {
      const res = await fetch("/api/devices", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch {}
  }

  async function fetchSessions() {
    try {
      const res = await fetch("/api/sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {}
  }

  async function generateCode() {
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setDevices((prev) => [data.device, ...prev]);
        notify(`New support code: ${data.device.supportCode}`, "success");
      }
    } catch {
      notify("Failed to generate code", "error");
    }
  }

  async function deleteDevice(id: string) {
    try {
      await fetch(`/api/devices/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setDevices((prev) => prev.filter((d) => d.id !== id));
      if (selectedDevice?.id === id) {
        setSelectedDevice(null);
        setSessionActive(false);
      }
    } catch {}
  }

  // ── Session controls ────────────────────────────────────────────────────────
  async function connectToDevice(device: Device) {
    setSelectedDevice(device);
    setHasReceivedFrame(false);
    setChatMessages([]);
    setNotes("");
    setBlankScreen(false);
    setInputLocked(false);

    // Create session in DB
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data.session);

        const sendRequest = () => {
          const activeSocket = socketRef.current;
          if (!activeSocket?.connected) {
            notify("Signaling connection is unavailable. Please try again.", "error");
            return;
          }
          activeSocket.emit("tech-connect-request", {
            supportCode: device.supportCode,
            sessionId: data.session.id,
          });
          notify(`Connecting to ${device.computerName}…`, "info");
        };

        if (socketRef.current?.connected) {
          sendRequest();
        } else if (socketRef.current) {
          notify("Reconnecting to signaling server…", "info");
          socketRef.current.once("connect", sendRequest);
        } else {
          notify("Signaling connection is unavailable. Please try again.", "error");
        }
      }
    } catch {
      notify("Failed to start session", "error");
    }
  }

  async function disconnectSession() {
    if (!activeSession) return;

    // End session in DB
    try {
      await fetch(`/api/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ended: true, notes }),
      });
    } catch {}

    // Turn off curtain and lock if active
    if (blankScreen) toggleBlankScreen(false);
    if (inputLocked) toggleInputLock(false);

    setSessionActive(false);
    setActiveSession(null);
    setSelectedDevice(null);
    setBlankScreen(false);
    setInputLocked(false);
    notify("Session ended", "info");
    fetchSessions();
  }

  // ── Remote control events ───────────────────────────────────────────────────
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!sessionActive || !selectedDevice || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      socketRef.current?.emit("mouse-event", {
        supportCode: selectedDevice.supportCode,
        type: "move",
        x, y,
      });
    },
    [sessionActive, selectedDevice]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!sessionActive || !selectedDevice || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      socketRef.current?.emit("mouse-event", {
        supportCode: selectedDevice.supportCode,
        type: e.type === "contextmenu" ? "right-click" : "click",
        x, y, button: e.button,
      });
    },
    [sessionActive, selectedDevice]
  );

  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!sessionActive || !selectedDevice) return;
      e.preventDefault();
      socketRef.current?.emit("keyboard-event", {
        supportCode: selectedDevice.supportCode,
        type: "keydown",
        key: e.key,
        modifiers: [
          e.ctrlKey && "ctrl",
          e.shiftKey && "shift",
          e.altKey && "alt",
          e.metaKey && "meta",
        ].filter(Boolean),
      });
    },
    [sessionActive, selectedDevice]
  );

  // ── Privacy controls ────────────────────────────────────────────────────────
  function toggleBlankScreen(value?: boolean) {
    if (!selectedDevice) return;
    const next = value !== undefined ? value : !blankScreen;
    setBlankScreen(next);
    socketRef.current?.emit("toggle-blank-screen", {
      supportCode: selectedDevice.supportCode,
      enabled: next,
    });
    notify(next ? "Privacy curtain ON" : "Privacy curtain OFF", next ? "info" : "success");
  }

  function toggleInputLock(value?: boolean) {
    if (!selectedDevice) return;
    const next = value !== undefined ? value : !inputLocked;
    setInputLocked(next);
    socketRef.current?.emit("toggle-input-lock", {
      supportCode: selectedDevice.supportCode,
      enabled: next,
    });
    notify(next ? "Input lock ON — client cannot use keyboard/mouse" : "Input lock OFF", next ? "info" : "success");
  }

  function changeMedia(key: string) {
    if (!selectedDevice) return;
    const media = PRIVACY_MEDIA.find((m) => m.key === key);
    setSelectedMedia(key);
    socketRef.current?.emit("change-privacy-media", {
      supportCode: selectedDevice.supportCode,
      mediaType: media?.type || "css",
      mediaKey: key,
    });
    setShowMediaMenu(false);
  }

  function switchMonitor(idx: number) {
    if (!selectedDevice) return;
    setActiveMonitor(idx);
    socketRef.current?.emit("switch-monitor", {
      supportCode: selectedDevice.supportCode,
      monitorIndex: idx,
    });
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  function sendChat() {
    if (!chatInput.trim() || !selectedDevice) return;
    const msg: ChatMsg = {
      sender: "technician",
      message: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };
    socketRef.current?.emit("chat-message", {
      supportCode: selectedDevice.supportCode,
      ...msg,
    });
    setChatMessages((prev) => [...prev, msg]);
    setChatInput("");
  }

  // ── Clipboard ───────────────────────────────────────────────────────────────
  async function pushClipboard() {
    if (!selectedDevice) return;
    try {
      const content = await navigator.clipboard.readText();
      socketRef.current?.emit("clipboard-sync", {
        supportCode: selectedDevice.supportCode,
        content,
        direction: "to-client",
      });
      setClipboardStatus("Clipboard sent to client");
      setTimeout(() => setClipboardStatus(""), 3000);
    } catch {
      setClipboardStatus("Failed to read clipboard");
    }
  }

  // ── File upload (tech → client) ─────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length || !selectedDevice) return;
    const file = e.target.files[0];
    const CHUNK = 64 * 1024; // 64 KB chunks
    const fileId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / CHUNK);

    setTransfers((prev) => [
      ...prev,
      { fileId, fileName: file.name, progress: 0, direction: "upload", chunks: [], totalChunks },
    ]);

    const reader = new FileReader();
    for (let i = 0; i < totalChunks; i++) {
      const blob = file.slice(i * CHUNK, (i + 1) * CHUNK);
      const chunk = await new Promise<string>((resolve) => {
        reader.onload = (ev) => {
          const result = ev.target?.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(blob);
      });

      socketRef.current?.emit("file-chunk", {
        supportCode: selectedDevice.supportCode,
        direction: "upload",
        fileName: file.name,
        chunkIndex: i,
        totalChunks,
        chunk,
        fileId,
      });

      setTransfers((prev) =>
        prev.map((t) =>
          t.fileId === fileId
            ? { ...t, progress: Math.round(((i + 1) / totalChunks) * 100) }
            : t
        )
      );
    }
    e.target.value = "";
  }

  // ── Notes save ──────────────────────────────────────────────────────────────
  async function saveNotes() {
    if (!activeSession) return;
    try {
      await fetch(`/api/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      notify("Notes saved", "success");
    } catch {}
  }

  // ── Notifications ───────────────────────────────────────────────────────────
  function notify(msg: string, type: "info" | "success" | "error") {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  }

  function logout() {
    localStorage.removeItem("cs_token");
    localStorage.removeItem("cs_username");
    router.push("/login");
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-[#e6edf3] overflow-hidden">

      {/* ── NEW CLIENT POPUP ── */}
      {newClientPopup && (
        <div className="modal-overlay" onClick={() => setNewClientPopup(null)}>
          <div
            className="bg-[#161b22] border border-[#2563eb] rounded-2xl p-8 max-w-sm w-full mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-3xl mx-auto mb-4">
                🖥️
              </div>
              <h2 className="text-xl font-bold text-white">New Client Connected!</h2>
              <p className="text-[#8b949e] text-sm mt-2">
                A client is waiting for your support session.
              </p>
            </div>
            <div className="bg-[#0d1117] rounded-xl p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#8b949e]">Computer</span>
                <span className="text-white font-medium">{newClientPopup.computerName || "Unknown PC"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#8b949e]">Support Code</span>
                <span className="font-mono text-[#3b82f6] font-bold">{newClientPopup.supportCode}</span>
              </div>
              {newClientPopup.osInfo && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#8b949e]">OS</span>
                  <span className="text-white">{newClientPopup.osInfo}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  connectToDevice(newClientPopup);
                  setNewClientPopup(null);
                }}
                className="flex-1 py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold transition-colors"
              >
                Connect Now →
              </button>
              <button
                onClick={() => setNewClientPopup(null)}
                className="px-4 py-3 rounded-xl border border-[#30363d] text-[#8b949e] hover:text-white transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATION TOAST ── */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium animate-slide-in shadow-lg ${
            notification.type === "success"
              ? "bg-green-500/20 border border-green-500/30 text-green-400"
              : notification.type === "error"
              ? "bg-red-500/20 border border-red-500/30 text-red-400"
              : "bg-blue-500/20 border border-blue-500/30 text-blue-400"
          }`}
        >
          {notification.msg}
        </div>
      )}

      {/* ── TOP NAV ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#161b22] flex-shrink-0">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Connect Support" width={28} height={28} />
          <span className="font-bold text-white text-sm">Connect Support</span>
          <span className="text-xs text-[#8b949e] hidden sm:inline">Dashboard</span>
        </div>

        {/* Session control bar */}
        {sessionActive && selectedDevice && (
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {/* Blank Screen */}
            <button
              onClick={() => toggleBlankScreen()}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                blankScreen
                  ? "bg-purple-500/20 border border-purple-500/40 text-purple-400"
                  : "bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white"
              }`}
            >
              {blankScreen ? "🙈" : "👁️"} {blankScreen ? "Curtain ON" : "Blank Screen"}
            </button>

            {/* Media picker */}
            <div className="relative">
              <button
                onClick={() => setShowMediaMenu((v) => !v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white transition-all flex items-center gap-1"
              >
                🎨 {PRIVACY_MEDIA.find((m) => m.key === selectedMedia)?.label || "Media"} ▾
              </button>
              {showMediaMenu && (
                <div className="absolute top-full mt-1 right-0 bg-[#161b22] border border-[#30363d] rounded-xl shadow-xl z-50 min-w-48 animate-fade-in">
                  {PRIVACY_MEDIA.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => changeMedia(m.key)}
                      className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#21262d] transition-colors first:rounded-t-xl last:rounded-b-xl flex items-center gap-2 ${
                        selectedMedia === m.key ? "text-[#3b82f6]" : "text-[#8b949e]"
                      }`}
                    >
                      {selectedMedia === m.key ? "✓" : "·"} {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input Lock */}
            <button
              onClick={() => toggleInputLock()}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                inputLocked
                  ? "bg-red-500/20 border border-red-500/40 text-red-400"
                  : "bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white"
              }`}
            >
              {inputLocked ? "🔒" : "🔓"} {inputLocked ? "Inputs LOCKED" : "Lock Inputs"}
            </button>

            {/* Monitor switch */}
            {monitors > 1 && (
              <div className="flex items-center gap-1">
                {Array.from({ length: monitors }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => switchMonitor(i)}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                      activeMonitor === i
                        ? "bg-[#2563eb] text-white"
                        : "bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white"
                    }`}
                  >
                    M{i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* FPS */}
            <span className="text-xs text-[#8b949e] px-2 font-mono">{fps} FPS</span>

            {/* Disconnect */}
            <button
              onClick={disconnectSession}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all"
            >
              ✕ End Session
            </button>
          </div>
        )}

        {/* Right: user info */}
        <div className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse-dot" : "bg-red-500"}`}
          ></span>
          <span className="text-xs text-[#8b949e] hidden sm:inline">{username}</span>
          <button
            onClick={logout}
            className="text-xs text-[#8b949e] hover:text-white px-3 py-1.5 rounded-lg border border-[#30363d] hover:border-[#484f58] transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL ── */}
        <aside className="w-64 flex-shrink-0 border-r border-[#30363d] bg-[#161b22] flex flex-col overflow-hidden">
          {/* Generate Code */}
          <div className="p-4 border-b border-[#30363d]">
            <button
              onClick={generateCode}
              className="w-full py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold text-sm transition-all flex items-center justify-center gap-2"
            >
              + Generate Support Code
            </button>
          </div>

          {/* Active Devices */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 text-xs font-semibold text-[#8b949e] uppercase tracking-wider flex items-center justify-between">
              <span>Devices</span>
              <span className="bg-[#21262d] px-2 py-0.5 rounded-full text-[10px]">
                {devices.length}
              </span>
            </div>

            {devices.length === 0 && (
              <div className="px-4 py-6 text-center">
                <div className="text-3xl mb-2">📋</div>
                <p className="text-xs text-[#8b949e]">No devices yet. Generate a code above.</p>
              </div>
            )}

            {devices.map((device) => (
              <div
                key={device.id}
                className={`px-4 py-3 border-b border-[#30363d]/50 hover:bg-[#21262d] transition-colors cursor-pointer ${
                  selectedDevice?.id === device.id ? "bg-[#21262d] border-l-2 border-l-[#2563eb]" : ""
                }`}
                onClick={() => !sessionActive && setSelectedDevice(device)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white truncate pr-2">
                    {device.computerName || "New Device"}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      device.status === "connected"
                        ? "bg-green-500"
                        : device.status === "waiting"
                        ? "bg-yellow-500 animate-pulse-dot"
                        : "bg-[#484f58]"
                    }`}
                  ></span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#3b82f6]">{device.supportCode}</span>
                  <span className={`text-[10px] ${
                    device.status === "connected" ? "text-green-400" :
                    device.status === "waiting" ? "text-yellow-400" : "text-[#8b949e]"
                  }`}>
                    {device.status}
                  </span>
                </div>
                {(device.status === "waiting" || device.status === "connected") && !sessionActive && (
                  <button
                    onClick={(e) => { e.stopPropagation(); connectToDevice(device); }}
                    className="mt-2 w-full py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium transition-colors"
                  >
                    Connect →
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteDevice(device.id); }}
                  className="mt-1 w-full py-1 rounded text-[10px] text-[#8b949e] hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}

            {/* Session History */}
            {sessions.length > 0 && (
              <>
                <div className="px-4 py-3 text-xs font-semibold text-[#8b949e] uppercase tracking-wider mt-2">
                  Recent Sessions
                </div>
                {sessions.slice(0, 5).map((s) => (
                  <div key={s.id} className="px-4 py-2 border-b border-[#30363d]/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#8b949e]">
                        {new Date(s.startedAt).toLocaleDateString()}
                      </span>
                      <span className={`text-[10px] ${s.endedAt ? "text-green-400" : "text-yellow-400"}`}>
                        {s.endedAt ? "Ended" : "Active"}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* ── CENTER CANVAS ── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#0d1117]">
          {!sessionActive ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md px-6">
                {selectedDevice ? (
                  <>
                    <div className="text-5xl mb-4">⏳</div>
                    <h2 className="text-xl font-bold text-white mb-2">
                      Waiting for {selectedDevice.computerName || selectedDevice.supportCode}
                    </h2>
                    <p className="text-[#8b949e] text-sm mb-4">
                      A connection request was sent. Waiting for the client to approve…
                    </p>
                    <button
                      onClick={() => { setSelectedDevice(null); setActiveSession(null); }}
                      className="px-4 py-2 rounded-lg border border-[#30363d] text-[#8b949e] hover:text-white text-sm"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-6">🖥️</div>
                    <h2 className="text-xl font-bold text-white mb-2">No Active Session</h2>
                    <p className="text-[#8b949e] text-sm mb-6">
                      Generate a support code and share it with your friend or family member.
                      Once they install the agent, click Connect to start a session.
                    </p>
                    <button
                      onClick={generateCode}
                      className="px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold transition-colors"
                    >
                      + Generate Support Code
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
              <canvas
                ref={canvasRef}
                id="remote-canvas"
                className="max-w-full max-h-full object-contain"
                tabIndex={0}
                onMouseMove={handleCanvasMouseMove}
                onClick={handleCanvasClick}
                onContextMenu={(e) => { e.preventDefault(); handleCanvasClick(e); }}
                onKeyDown={handleCanvasKeyDown}
              />
              {/* Overlay indicators */}
              {blankScreen && (
                <div className="absolute inset-0 flex items-center justify-center bg-purple-900/20 pointer-events-none">
                  <div className="px-4 py-2 rounded-lg bg-purple-500/30 border border-purple-500/50 text-purple-300 text-sm font-medium">
                    🙈 Privacy Curtain Active on Client
                  </div>
                </div>
              )}
              {inputLocked && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-medium">
                  🔒 Client Inputs LOCKED
                </div>
              )}
              {!hasReceivedFrame && fps === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-[#8b949e] text-sm">{streamStatus}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── RIGHT PANEL ── */}
        <aside className="w-72 flex-shrink-0 border-l border-[#30363d] bg-[#161b22] flex flex-col overflow-hidden">

          {/* Chat */}
          <div className="flex flex-col flex-1 overflow-hidden border-b border-[#30363d]">
            <div className="px-4 py-3 border-b border-[#30363d] text-xs font-semibold text-[#8b949e] uppercase tracking-wider flex items-center gap-2">
              💬 Live Chat
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {chatMessages.length === 0 && (
                <p className="text-xs text-[#8b949e] text-center py-4">No messages yet</p>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.sender === "technician" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-xl text-xs ${
                      msg.sender === "technician"
                        ? "bg-[#2563eb] text-white rounded-br-sm"
                        : "bg-[#21262d] text-[#e6edf3] rounded-bl-sm"
                    }`}
                  >
                    <p className="leading-relaxed">{msg.message}</p>
                    <span className="text-[10px] opacity-60 mt-0.5 block">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Type a message…"
                disabled={!sessionActive}
                className="flex-1 px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white text-xs placeholder-[#484f58] focus:border-[#2563eb] focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={sendChat}
                disabled={!sessionActive}
                className="px-3 py-2 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white text-xs font-medium transition-colors"
              >
                →
              </button>
            </div>
          </div>

          {/* Clipboard & File Transfer */}
          <div className="border-b border-[#30363d]">
            <div className="px-4 py-3 text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
              🔧 Tools
            </div>
            <div className="px-3 pb-3 space-y-2">
              <button
                onClick={pushClipboard}
                disabled={!sessionActive}
                className="w-full py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white text-xs transition-colors disabled:opacity-50"
              >
                📋 Push Clipboard to Client
              </button>
              {clipboardStatus && (
                <p className="text-xs text-green-400 text-center">{clipboardStatus}</p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!sessionActive}
                className="w-full py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white text-xs transition-colors disabled:opacity-50"
              >
                📁 Send File to Client
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileUpload}
              />
              {transfers.map((t) => (
                <div key={t.fileId} className="p-2 rounded-lg bg-[#0d1117] border border-[#30363d]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-white truncate">{t.fileName}</span>
                    <span className="text-[10px] text-[#8b949e]">{t.progress}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-[#30363d]">
                    <div
                      className="h-full rounded-full bg-[#2563eb] transition-all"
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Session Notes */}
          <div className="flex flex-col flex-shrink-0" style={{ minHeight: 200 }}>
            <div className="px-4 py-3 border-b border-[#30363d] text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
              📝 Session Notes
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write notes about this session…"
              className="flex-1 p-3 bg-transparent text-xs text-[#e6edf3] placeholder-[#484f58] resize-none focus:outline-none"
              style={{ minHeight: 120 }}
            />
            <div className="px-3 pb-3">
              <button
                onClick={saveNotes}
                disabled={!activeSession}
                className="w-full py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white text-xs transition-colors disabled:opacity-50"
              >
                💾 Save Notes
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
