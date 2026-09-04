import React from "react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const API    = import.meta.env.VITE_API_URL    || "";
const SOCKET = import.meta.env.VITE_SOCKET_URL || API;

function normalizeDevice(device) {
  if (!device) return device;
  return {
    ...device,
    id: device.id,
    computerName: device.computerName || device.computer_name,
    supportCode: device.supportCode || device.support_code,
    lastSeen: device.lastSeen || device.last_seen,
    osInfo: device.osInfo || device.os_info,
  };
}

const BUILTIN_PRIVACY_MEDIA = [
  { key: "default-blue",     label: "Default Deep Blue",     type: "css" },
  { key: "matrix-loop",      label: "Matrix Loop",           type: "css" },
  { key: "maintenance-anim", label: "Maintenance Animation", type: "css" },
  { key: "custom-video",     label: "Maintenance Video",     type: "video" },
];

export default function Dashboard() {
  const navigate  = useNavigate();
  const token     = localStorage.getItem("cs_token");
  const username  = localStorage.getItem("cs_username") || "Technician";

  const [devices, setDevices]             = useState([]);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [editingDeviceName, setEditingDeviceName] = useState("");
  const [sessions, setSessions]           = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [activeSession, setActiveSession]   = useState(null);
  const [sessionActive, setSessionActive]   = useState(false);
  const [isConnected, setIsConnected]       = useState(false);

  const [blankScreen, setBlankScreen]     = useState(false);
  const [inputLocked, setInputLocked]     = useState(false);
  const [selectedMedia, setSelectedMedia] = useState("default-blue");
  const [savedMedia, setSavedMedia] = useState([]);
  const [playingMedia, setPlayingMedia] = useState(null);
  const [monitors, setMonitors]           = useState(1);
  const [activeMonitor, setActiveMonitor] = useState(0);
  const [fps, setFps]                     = useState(0);
  const [showMediaMenu, setShowMediaMenu] = useState(false);

  const [chatMessages, setChatMessages]   = useState([]);
  const [chatInput, setChatInput]         = useState("");
  const chatEndRef                        = useRef(null);

  const [notes, setNotes]                 = useState("");
  const [transfers, setTransfers]         = useState([]);
  const [clipStatus, setClipStatus]       = useState("");
  const [notification, setNotification]   = useState(null);
  const [newClientPopup, setNewClientPopup] = useState(null);

  const canvasRef     = useRef(null);
  const socketRef     = useRef(null);
  const frameCountRef = useRef(0);
  const fileInputRef  = useRef(null);
  const mediaInputRef = useRef(null);

  // Auth guard
  useEffect(() => { if (!token) navigate("/login"); }, [token]);

  // Fetch data
  useEffect(() => { fetchDevices(); fetchSessions(); fetchSavedMedia(); }, []);
  useEffect(() => {
    const refreshTimer = window.setInterval(fetchDevices, 10000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  // Socket
  useEffect(() => {
    if (!token) return;
    const socket = io(SOCKET, { auth: { token }, transports: ["websocket","polling"] });
    socketRef.current = socket;

    socket.on("connect",    () => { setIsConnected(true);  notify("Connected to server","success"); });
    socket.on("disconnect", () => { setIsConnected(false); });

    socket.on("client-status-update", (data) => {
      setDevices(prev => {
        const idx = prev.findIndex(d => d.supportCode === data.supportCode);
        if (idx >= 0) {
          const updated = [...prev];
          const old = updated[idx];
          updated[idx] = { ...old, ...data };
          if (data.status === "waiting") setNewClientPopup(updated[idx]);
          return updated;
        }
        fetchDevices();
        return prev;
      });
    });

    socket.on("connection-approved", () => { notify("Client approved!","success"); setSessionActive(true); });
    socket.on("connection-rejected", () => { notify("Client declined the request","error"); });

    socket.on("stream-frame", (data) => {
      console.log("[Dashboard] Frame received", {
        supportCode: data?.supportCode,
        sessionId: data?.sessionId,
        bytes: data?.frame?.length || 0,
      });
      if (!data?.frame || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.frame)) {
        console.warn("[Dashboard] Invalid frame payload");
        return;
      }
      if (!canvasRef.current) {
        console.warn("[Dashboard] Frame received before canvas mounted");
        return;
      }
      frameCountRef.current++;
      if (data.monitors) setMonitors(data.monitors);
      const img = new window.Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        if (canvasRef.current.width !== img.width || canvasRef.current.height !== img.height) {
          canvasRef.current.width = img.width;
          canvasRef.current.height = img.height;
        }
        ctx.drawImage(img, 0, 0);
      };
      img.onerror = () => console.error("[Dashboard] JPEG frame could not be decoded");
      img.src = `data:image/jpeg;base64,${data.frame}`;
    });

    socket.on("chat-message", (msg) => setChatMessages(prev => [...prev, msg]));

    socket.on("file-chunk", (data) => {
      if (data.direction !== "download") return;
      setTransfers(prev => {
        const idx = prev.findIndex(t => t.fileId === data.fileId);
        const pct = Math.round(((data.chunkIndex + 1) / data.totalChunks) * 100);
        if (idx >= 0) {
          const u = [...prev];
          u[idx] = { ...u[idx], progress: pct };
          if (data.chunkIndex === data.totalChunks - 1) {
            // reconstruct & save
            const allChunks = u[idx].chunks || [];
            allChunks[data.chunkIndex] = data.chunk;
            const binary = atob(allChunks.join(""));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = data.fileName; a.click();
            URL.revokeObjectURL(url);
          }
          return u;
        }
        return [...prev, { fileId: data.fileId, fileName: data.fileName, progress: pct, direction: "download", chunks: [data.chunk], totalChunks: data.totalChunks }];
      });
    });

    socket.on("clipboard-sync", ({ content, direction }) => {
      if (direction === "to-tech") {
        navigator.clipboard.writeText(content).catch(() => {});
        setClipStatus("Clipboard received from client");
        setTimeout(() => setClipStatus(""), 3000);
      }
    });

    socket.on("tech-disconnected", () => { setSessionActive(false); });

    const fpsTimer = setInterval(() => { setFps(frameCountRef.current); frameCountRef.current = 0; }, 1000);
    return () => { socket.disconnect(); clearInterval(fpsTimer); };
  }, [token]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // ── API helpers ──────────────────────────────────────────────────────────────
  async function fetchDevices() {
    try {
      const r = await fetch(`${API}/api/devices`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) { localStorage.removeItem("cs_token"); navigate("/login"); return; }
      if (r.ok) setDevices((data.devices || []).map(normalizeDevice));
      else notify(data.error || `Could not load devices (${r.status})`, "error");
    } catch { notify("Could not reach the support server", "error"); }
  }
  async function fetchSessions() {
    try {
      const r = await fetch(`${API}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setSessions((await r.json()).sessions || []);
    } catch {}
  }
  async function fetchSavedMedia() {
    try {
      const r = await fetch(`${API}/api/privacy-media`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setSavedMedia((await r.json()).media || []);
    } catch {}
  }
  async function generateCode() {
    try {
      const r = await fetch(`${API}/api/devices`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ computerName: "New Device", computer_name: "New Device" }) });
      if (r.ok) { const d = await r.json(); const device = normalizeDevice(d.device); setDevices(p => [device, ...p]); notify(`Code: ${device.supportCode}`, "success"); }
      else if (r.status === 401) { localStorage.removeItem("cs_token"); navigate("/login"); }
      else { const d = await r.json().catch(() => ({})); notify(d.details ? `${d.error}: ${d.details}` : (d.error || `Failed to generate code (${r.status})`), "error"); }
    } catch { notify("Could not reach the support server", "error"); }
  }
  function startRename(device) {
    setEditingDeviceId(device.id);
    setEditingDeviceName(device.computerName || "New Device");
  }
  async function renameDevice(device) {
    const computerName = editingDeviceName.trim();
    setEditingDeviceId(null);
    if (!computerName || computerName === device.computerName) return;
    try {
      const r = await fetch(`${API}/api/devices/${device.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ computerName, computer_name: computerName }) });
      const data = await r.json();
      if (!r.ok) { notify(data.error || "Failed to rename device", "error"); return; }
      const updatedDevice = normalizeDevice(data.device);
      setDevices(prev => prev.map(item => item.id === device.id ? { ...item, ...updatedDevice } : item));
      if (selectedDevice?.id === device.id) setSelectedDevice(prev => ({ ...prev, ...updatedDevice }));
      notify("Device renamed", "success");
    } catch { notify("Failed to rename device", "error"); }
  }
  async function deleteDevice(id) {
    try {
      const r = await fetch(`${API}/api/devices/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { const data = await r.json().catch(() => ({})); notify(data.error || `Remove failed (${r.status})`, "error"); return; }
      setDevices(p => p.filter(d => d.id !== id));
      if (selectedDevice?.id === id) { setSelectedDevice(null); setSessionActive(false); }
      notify("Device removed", "success");
    } catch { notify("Failed to remove device", "error"); }
  }

  // ── Session ──────────────────────────────────────────────────────────────────
  async function connectToDevice(device) {
    setSelectedDevice(device); setChatMessages([]); setNotes(""); setBlankScreen(false); setInputLocked(false);
    try {
      const r = await fetch(`${API}/api/sessions`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device.id, device_id: device.id }) });
      if (r.ok) {
        const d = await r.json(); setActiveSession(d.session);
        socketRef.current?.emit("tech-connect-request", { supportCode: device.supportCode, sessionId: d.session.id });
        notify(`Connecting to ${device.computerName || device.supportCode}…`, "info");
      } else { const d = await r.json().catch(() => ({})); notify(d.error || `Connect failed (${r.status})`, "error"); }
    } catch { notify("Failed to start session","error"); }
  }
  async function disconnectSession() {
    if (!activeSession || !selectedDevice) return;
    socketRef.current?.emit("end-session", {
      supportCode: selectedDevice.supportCode,
      sessionId: activeSession.id,
    });
    if (blankScreen) toggleBlankScreen(false);
    if (inputLocked) toggleInputLock(false);
    try { await fetch(`${API}/api/sessions/${activeSession.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ended: true, notes }) }); } catch {}
    setSessionActive(false); setActiveSession(null); setSelectedDevice(null); setBlankScreen(false); setInputLocked(false);
    notify("Session ended","info"); fetchSessions();
  }

  // ── Canvas mouse/keyboard ────────────────────────────────────────────────────
  const onMouseMove = useCallback((e) => {
    if (!sessionActive || !selectedDevice || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    socketRef.current?.emit("mouse-event", { supportCode: selectedDevice.supportCode, type: "move", x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  }, [sessionActive, selectedDevice]);

  const onCanvasClick = useCallback((e) => {
    if (!sessionActive || !selectedDevice || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    socketRef.current?.emit("mouse-event", { supportCode: selectedDevice.supportCode, type: e.type === "contextmenu" ? "right-click" : "click", x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, button: e.button });
  }, [sessionActive, selectedDevice]);

  const onKeyDown = useCallback((e) => {
    if (!sessionActive || !selectedDevice) return;
    e.preventDefault();
    socketRef.current?.emit("keyboard-event", { supportCode: selectedDevice.supportCode, type: "keydown", key: e.key, modifiers: [e.ctrlKey && "ctrl", e.shiftKey && "shift", e.altKey && "alt", e.metaKey && "meta"].filter(Boolean) });
  }, [sessionActive, selectedDevice]);

  // ── Privacy ──────────────────────────────────────────────────────────────────
  function toggleBlankScreen(val) {
    if (!selectedDevice) return;
    const next = val !== undefined ? val : !blankScreen;
    setBlankScreen(next);
    const media = [...BUILTIN_PRIVACY_MEDIA, ...savedMedia.map(m => ({ ...m, key: `uploaded-${m.id}`, label: m.name, type: m.mimeType.startsWith("video/") ? "video" : "image", url: `${API}${m.url}` }))].find(m => m.key === selectedMedia);
    socketRef.current?.emit("toggle-blank-screen", {
      supportCode: selectedDevice.supportCode,
      enabled: next,
      mediaKey: media?.key || "default-blue",
      mediaType: media?.type,
      mediaUrl: media?.url,
    });
    if (!next) {
      setPlayingMedia(null);
      setSelectedMedia("default-blue");
    }
    notify(next ? "Privacy curtain ON" : "Privacy curtain OFF", next ? "info" : "success");
  }
  function toggleInputLock(val) {
    if (!selectedDevice) return;
    const next = val !== undefined ? val : !inputLocked;
    setInputLocked(next);
    socketRef.current?.emit("toggle-input-lock", { supportCode: selectedDevice.supportCode, enabled: next });
    notify(next ? "Input LOCKED" : "Input unlocked", next ? "info" : "success");
  }
  function changeMedia(media) {
    if (!selectedDevice) return;
    setSelectedMedia(media.key);
    setPlayingMedia(media);
    setShowMediaMenu(false);
  }
  function playMedia() {
    if (!selectedDevice || !playingMedia) return;
    socketRef.current?.emit("change-privacy-media", { supportCode: selectedDevice.supportCode, mediaType: playingMedia.type, mediaKey: playingMedia.key, mediaUrl: playingMedia.url });
  }
  function stopMedia() {
    if (!selectedDevice) return;
    setPlayingMedia(null);
    setSelectedMedia("default-blue");
    socketRef.current?.emit("change-privacy-media", { supportCode: selectedDevice.supportCode, mediaType: "css", mediaKey: "default-blue" });
  }
  function switchMonitor(i) { setActiveMonitor(i); socketRef.current?.emit("switch-monitor", { supportCode: selectedDevice?.supportCode, monitorIndex: i }); }

  // ── Chat ─────────────────────────────────────────────────────────────────────
  function sendChat() {
    if (!chatInput.trim() || !selectedDevice) return;
    const msg = { sender: "technician", message: chatInput.trim(), timestamp: new Date().toISOString() };
    socketRef.current?.emit("chat-message", { supportCode: selectedDevice.supportCode, ...msg });
    setChatMessages(p => [...p, msg]);
    setChatInput("");
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────────
  async function pushClipboard() {
    if (!selectedDevice) return;
    try {
      const content = await navigator.clipboard.readText();
      socketRef.current?.emit("clipboard-sync", { supportCode: selectedDevice.supportCode, content, direction: "to-client" });
      setClipStatus("Sent to client"); setTimeout(() => setClipStatus(""), 3000);
    } catch { setClipStatus("Failed"); }
  }

  // ── File upload ───────────────────────────────────────────────────────────────
  async function handleFileUpload(e) {
    if (!e.target.files?.length || !selectedDevice) return;
    const file = e.target.files[0]; const CHUNK = 64 * 1024;
    const fileId = crypto.randomUUID(); const totalChunks = Math.ceil(file.size / CHUNK);
    setTransfers(p => [...p, { fileId, fileName: file.name, progress: 0, direction: "upload", chunks: [], totalChunks }]);
    for (let i = 0; i < totalChunks; i++) {
      const blob = file.slice(i * CHUNK, (i + 1) * CHUNK);
      const chunk = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result.split(",")[1]); r.readAsDataURL(blob); });
      socketRef.current?.emit("file-chunk", { supportCode: selectedDevice.supportCode, direction: "upload", fileName: file.name, chunkIndex: i, totalChunks, chunk, fileId });
      setTransfers(p => p.map(t => t.fileId === fileId ? { ...t, progress: Math.round(((i+1)/totalChunks)*100) } : t));
    }
    e.target.value = "";
  }

  async function handleMediaUpload(e) {
    const file = e.target.files?.[0];
    const allowed = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"];
    if (!file || !selectedDevice || !allowed.includes(file.type)) { e.target.value = ""; return; }
    try {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const r = await fetch(`${API}/api/privacy-media`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mimeType: file.type, data }) });
      if (!r.ok) {
        const details = await r.json().catch(() => ({}));
        throw new Error(details.error || `Media upload failed (${r.status})`);
      }
      const media = (await r.json()).media;
      const playable = { ...media, key: `uploaded-${media.id}`, type: media.mimeType.startsWith("video/") ? "video" : "image", url: `${API}${media.url}` };
      setSavedMedia(prev => [media, ...prev]);
      changeMedia(playable);
      notify("Media uploaded. Click Play to display it.", "success");
    } catch (err) { notify(err.message || "Media upload failed", "error"); }
    e.target.value = "";
  }

  async function saveNotes() {
    if (!activeSession) return;
    try { await fetch(`${API}/api/sessions/${activeSession.id}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ notes }) }); notify("Notes saved","success"); } catch {}
  }

  function notify(msg, type) { setNotification({ msg, type }); setTimeout(() => setNotification(null), 4000); }
  function logout() { localStorage.clear(); navigate("/login"); }

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-[#e6edf3] overflow-hidden">

      {/* NEW CLIENT POPUP */}
      {newClientPopup && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setNewClientPopup(null)}>
          <div className="bg-[#161b22] border border-[#2563eb] rounded-2xl p-8 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-5xl mb-4 animate-bounce">🖥️</div>
              <h2 className="text-xl font-bold text-white">New Client Connected!</h2>
              <p className="text-[#8b949e] text-sm mt-2">A device is waiting for your support session.</p>
            </div>
            <div className="bg-[#0d1117] rounded-xl p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-[#8b949e]">Computer</span><span className="text-white font-medium">{newClientPopup.computerName || "Unknown PC"}</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#8b949e]">Code</span><span className="font-mono text-[#3b82f6] font-bold">{newClientPopup.supportCode}</span></div>
              {newClientPopup.osInfo && <div className="flex justify-between text-sm"><span className="text-[#8b949e]">OS</span><span className="text-white text-xs">{newClientPopup.osInfo}</span></div>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { connectToDevice(newClientPopup); setNewClientPopup(null); }} className="flex-1 py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold transition-colors">Connect Now →</button>
              <button onClick={() => setNewClientPopup(null)} className="px-4 py-3 rounded-xl border border-[#30363d] text-[#8b949e] hover:text-white transition-colors">Later</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg ${notification.type === "success" ? "bg-green-500/20 border border-green-500/30 text-green-400" : notification.type === "error" ? "bg-red-500/20 border border-red-500/30 text-red-400" : "bg-blue-500/20 border border-blue-500/30 text-blue-400"}`}>
          {notification.msg}
        </div>
      )}

      {/* TOP BAR */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#161b22] flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg">🛡️</span>
          <span className="font-bold text-white text-sm">Connect Support</span>
        </div>

        {sessionActive && selectedDevice && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => toggleBlankScreen()} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${blankScreen ? "bg-purple-500/20 border border-purple-500/40 text-purple-400" : "bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white"}`}>
              {blankScreen ? "🙈 Curtain ON" : "👁️ Blank Screen"}
            </button>
            <div className="relative">
              <button onClick={() => setShowMediaMenu(v => !v)} className="px-3 py-1.5 rounded-lg text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white flex items-center gap-1">
                🎨 {[...BUILTIN_PRIVACY_MEDIA, ...savedMedia.map(m => ({ ...m, key: `uploaded-${m.id}`, label: m.name, type: m.mimeType.startsWith("video/") ? "video" : "image", url: `${API}${m.url}` }))].find(m => m.key === selectedMedia)?.label || "Media"} ▾
              </button>
              {showMediaMenu && (
                <div className="absolute top-full mt-1 right-0 bg-[#161b22] border border-[#30363d] rounded-xl shadow-xl z-50 min-w-48">
                  {[...BUILTIN_PRIVACY_MEDIA, ...savedMedia.map(m => ({ ...m, key: `uploaded-${m.id}`, label: m.name, type: m.mimeType.startsWith("video/") ? "video" : "image", url: `${API}${m.url}` }))].map(m => (
                    <button key={m.key} onClick={() => changeMedia(m)} className={`w-full text-left px-4 py-2.5 text-xs hover:bg-[#21262d] transition-colors first:rounded-t-xl last:rounded-b-xl flex items-center gap-2 ${selectedMedia === m.key ? "text-[#3b82f6]" : "text-[#8b949e]"}`}>
                      {selectedMedia === m.key ? "✓" : "·"} {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => mediaInputRef.current?.click()} disabled={!sessionActive} className="px-3 py-1.5 rounded-lg text-xs bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white disabled:opacity-50">Upload</button>
            <input ref={mediaInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,image/jpeg,image/png,image/webp,video/mp4,video/webm" className="hidden" onChange={handleMediaUpload} />
            <button onClick={playMedia} disabled={!sessionActive || !playingMedia} className="px-3 py-1.5 rounded-lg text-xs bg-green-500/20 border border-green-500/40 text-green-400 disabled:opacity-50">Play</button>
            <button onClick={stopMedia} disabled={!sessionActive || !playingMedia} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 border border-red-500/40 text-red-400 disabled:opacity-50">Stop</button>
            <button onClick={() => toggleInputLock()} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${inputLocked ? "bg-red-500/20 border border-red-500/40 text-red-400" : "bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white"}`}>
              {inputLocked ? "🔒 LOCKED" : "🔓 Lock Inputs"}
            </button>
            {monitors > 1 && Array.from({ length: monitors }).map((_, i) => (
              <button key={i} onClick={() => switchMonitor(i)} className={`px-2 py-1.5 rounded text-xs font-medium ${activeMonitor === i ? "bg-[#2563eb] text-white" : "bg-[#21262d] border border-[#30363d] text-[#8b949e]"}`}>
                M{i+1}
              </button>
            ))}
            <span className="text-xs text-[#8b949e] font-mono">{fps} FPS</span>
            <button onClick={disconnectSession} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30">✕ End Session</button>
          </div>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}></span>
          <span className="text-xs text-[#8b949e] hidden sm:inline">{username}</span>
          <button onClick={logout} className="text-xs text-[#8b949e] hover:text-white px-2 py-1.5 rounded border border-[#30363d]">Logout</button>
        </div>
      </header>

      {/* WORKSPACE */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL */}
        <aside className="w-60 flex-shrink-0 border-r border-[#30363d] bg-[#161b22] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#30363d]">
            <button onClick={generateCode} className="w-full py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold text-sm flex items-center justify-center gap-1">
              + Generate Code
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 text-xs font-semibold text-[#8b949e] uppercase tracking-wider flex items-center justify-between">
              <span>Devices</span><span className="bg-[#21262d] px-2 py-0.5 rounded-full text-[10px]">{devices.length}</span>
            </div>
            {devices.length === 0 && <p className="text-xs text-[#8b949e] text-center py-6">No devices yet.</p>}
            {devices.map(device => (
              <div key={device.id} className={`px-4 py-3 border-b border-[#30363d]/50 hover:bg-[#21262d] cursor-pointer ${selectedDevice?.id === device.id ? "bg-[#21262d] border-l-2 border-l-[#2563eb]" : ""}`}
                onClick={() => !sessionActive && setSelectedDevice(device)}>
                <div className="flex items-center justify-between mb-1">
                  {editingDeviceId === device.id ? (
                    <input autoFocus value={editingDeviceName} onChange={e => setEditingDeviceName(e.target.value)}
                      onBlur={() => renameDevice(device)} onKeyDown={e => { if (e.key === "Enter") renameDevice(device); if (e.key === "Escape") setEditingDeviceId(null); }}
                      onClick={e => e.stopPropagation()} className="w-full min-w-0 px-1 py-0.5 rounded bg-[#0d1117] border border-[#2563eb] text-sm text-white focus:outline-none" />
                  ) : (
                    <span onDoubleClick={e => { e.stopPropagation(); startRename(device); }} title="Double-click to rename" className="text-sm font-medium text-white truncate pr-2">{device.computerName || "New Device"}</span>
                  )}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${device.status === "connected" ? "bg-green-500" : device.status === "waiting" ? "bg-yellow-500 animate-pulse" : "bg-[#484f58]"}`}></span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#3b82f6]">{device.supportCode}</span>
                  <span className={`text-[10px] ${device.status === "connected" ? "text-green-400" : device.status === "waiting" ? "text-yellow-400" : "text-[#8b949e]"}`}>{device.status}</span>
                </div>
                {device.status === "waiting" && !sessionActive && (
                  <button onClick={e => { e.stopPropagation(); connectToDevice(device); }} className="mt-2 w-full py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium">Connect →</button>
                )}
                <button onClick={e => { e.stopPropagation(); deleteDevice(device.id); }} className="mt-1 w-full py-0.5 text-[10px] text-[#8b949e] hover:text-red-400">Remove</button>
              </div>
            ))}
            {sessions.length > 0 && (
              <>
                <div className="px-4 py-3 text-xs font-semibold text-[#8b949e] uppercase tracking-wider mt-2">Recent Sessions</div>
                {sessions.slice(0,5).map(s => (
                  <div key={s.id} className="px-4 py-2 border-b border-[#30363d]/50">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8b949e]">{new Date(s.startedAt).toLocaleDateString()}</span>
                      <span className={s.endedAt ? "text-green-400" : "text-yellow-400"}>{s.endedAt ? "Ended" : "Active"}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* CENTER CANVAS */}
        <main className="flex-1 flex flex-col overflow-hidden bg-black">
          {!sessionActive ? (
            <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
              <div className="text-center max-w-md px-6">
                {selectedDevice ? (
                  <>
                    <div className="text-5xl mb-4">⏳</div>
                    <h2 className="text-xl font-bold text-white mb-2">Waiting for approval…</h2>
                    <p className="text-[#8b949e] text-sm mb-4">Request sent to {selectedDevice.computerName || selectedDevice.supportCode}</p>
                    <button onClick={() => { setSelectedDevice(null); setActiveSession(null); }} className="px-4 py-2 rounded-lg border border-[#30363d] text-[#8b949e] hover:text-white text-sm">Cancel</button>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-6">🖥️</div>
                    <h2 className="text-xl font-bold text-white mb-2">No Active Session</h2>
                    <p className="text-[#8b949e] text-sm mb-6">Generate a code and share it with your friend or family member.</p>
                    <button onClick={generateCode} className="px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold">+ Generate Code</button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 relative flex items-center justify-center">
              <canvas ref={canvasRef} id="remote-canvas" className="max-w-full max-h-full object-contain" tabIndex={0}
                onMouseMove={onMouseMove} onClick={onCanvasClick} onContextMenu={e => { e.preventDefault(); onCanvasClick(e); }} onKeyDown={onKeyDown} />
              {blankScreen && <div className="absolute inset-0 flex items-center justify-center bg-purple-900/20 pointer-events-none"><div className="px-4 py-2 rounded-lg bg-purple-500/30 border border-purple-500/50 text-purple-300 text-sm">🙈 Privacy Curtain Active on Client</div></div>}
              {inputLocked && <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-medium">🔒 Client Inputs LOCKED</div>}
              {fps === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
                  <div className="text-center"><div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3"></div><p className="text-[#8b949e] text-sm">Waiting for stream…</p></div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* RIGHT PANEL */}
        <aside className="w-68 flex-shrink-0 border-l border-[#30363d] bg-[#161b22] flex flex-col overflow-hidden" style={{ width: 272 }}>
          {/* Chat */}
          <div className="flex flex-col flex-1 overflow-hidden border-b border-[#30363d]" style={{ maxHeight: "55%" }}>
            <div className="px-4 py-3 border-b border-[#30363d] text-xs font-semibold text-[#8b949e] uppercase tracking-wider">💬 Chat</div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {chatMessages.length === 0 && <p className="text-xs text-[#8b949e] text-center py-4">No messages</p>}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.sender === "technician" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs ${msg.sender === "technician" ? "bg-[#2563eb] text-white rounded-br-sm" : "bg-[#21262d] text-[#e6edf3] rounded-bl-sm"}`}>
                    <p className="leading-relaxed">{msg.message}</p>
                    <span className="text-[10px] opacity-60">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} placeholder="Type…" disabled={!sessionActive}
                className="flex-1 px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-white text-xs placeholder-[#484f58] focus:border-[#2563eb] focus:outline-none disabled:opacity-50" />
              <button onClick={sendChat} disabled={!sessionActive} className="px-3 py-2 rounded-lg bg-[#2563eb] disabled:opacity-50 text-white text-xs">→</button>
            </div>
          </div>

          {/* Tools */}
          <div className="border-b border-[#30363d] p-3 space-y-2">
            <div className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">🔧 Tools</div>
            <button onClick={pushClipboard} disabled={!sessionActive} className="w-full py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white text-xs disabled:opacity-50">📋 Push Clipboard</button>
            {clipStatus && <p className="text-xs text-green-400 text-center">{clipStatus}</p>}
            <button onClick={() => fileInputRef.current?.click()} disabled={!sessionActive} className="w-full py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white text-xs disabled:opacity-50">📁 Send File</button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
            {transfers.map(t => (
              <div key={t.fileId} className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                <div className="flex justify-between mb-1"><span className="text-[10px] text-white truncate">{t.fileName}</span><span className="text-[10px] text-[#8b949e]">{t.progress}%</span></div>
                <div className="h-1 rounded bg-[#30363d]"><div className="h-full rounded bg-[#2563eb]" style={{ width: `${t.progress}%` }} /></div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#30363d] text-xs font-semibold text-[#8b949e] uppercase tracking-wider">📝 Notes</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Session notes…" className="flex-1 p-3 bg-transparent text-xs text-[#e6edf3] placeholder-[#484f58] resize-none focus:outline-none" />
            <div className="px-3 pb-3">
              <button onClick={saveNotes} disabled={!activeSession} className="w-full py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-white text-xs disabled:opacity-50">💾 Save Notes</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
