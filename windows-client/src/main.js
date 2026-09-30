/**
 * Connect Support — Windows Native Client Agent
 * Electron Main Process
 */

"use strict";

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  globalShortcut,
  clipboard,
  screen,
  shell,
  desktopCapturer,
} = require("electron");

const path = require("path");
const os = require("os");
const fs = require("fs");
const { io } = require("socket.io-client");

let startupStage = "electron-main-loaded";
let startupLogPath = null;
const lifecycleState = {
  supportCode: null,
  unattended: false,
  socketId: null,
  socketConnected: false,
  technicianRequest: false,
  consentWindow: false,
  webrtc: false,
};

function safeStartupLogPath() {
  try {
    return path.join(app.getPath("userData"), "logs", "agent.log");
  } catch {
    const appData = process.env.APPDATA || os.homedir();
    return path.join(appData, "Connect Support", "logs", "agent.log");
  }
}

function formatLogPart(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeAgentLog(level, ...parts) {
  const line = `[${new Date().toISOString()}] [pid=${process.pid}] [${level}] [stage=${startupStage}] ${parts.map(formatLogPart).join(" ")} [state=${formatLogPart(lifecycleState)}]`;
  const original = originalConsole[level] || originalConsole.log;
  try {
    original.call(console, line);
  } catch {}

  try {
    startupLogPath ||= safeStartupLogPath();
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, `${line}${os.EOL}`, "utf8");
  } catch (error) {
    try {
      originalConsole.error.call(console, "[Agent] Could not write startup log:", error);
    } catch {}
  }
}

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
console.log = (...args) => writeAgentLog("log", ...args);
console.info = (...args) => writeAgentLog("info", ...args);
console.warn = (...args) => writeAgentLog("warn", ...args);
console.error = (...args) => writeAgentLog("error", ...args);

function setStartupStage(stage) {
  startupStage = stage;
  writeAgentLog("info", "Initialization stage:", stage);
}

function redactProcessArguments(args) {
  let redactNext = false;
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return "[redacted]";
    }
    if (arg === "--code") {
      redactNext = true;
      return arg;
    }
    if (arg.startsWith("--code=")) return "--code=[redacted]";
    return arg;
  });
}

process.on("uncaughtException", (error, origin) => {
  writeAgentLog("error", "uncaughtException", { origin, error });
  app.exit(1);
});
process.on("unhandledRejection", (reason) => {
  writeAgentLog("error", "unhandledRejection", reason);
  app.exit(1);
});
process.on("warning", (warning) => writeAgentLog("warn", "process warning", warning));
process.on("exit", (code) => writeAgentLog("info", "process exit", { code }));

// Force Chromium onto its software-rendering path before Electron becomes ready.
// Do not disable the software rasterizer: WebRTC/media and desktop capture need it.
app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();
writeAgentLog("info", "Electron startup", {
  arguments: redactProcessArguments(process.argv),
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  pid: process.pid,
  platform: process.platform,
  username: process.env.USERNAME || os.userInfo().username,
  sessionName: process.env.SESSIONNAME || "<unset>",
  userProfile: process.env.USERPROFILE || "<unset>",
  switches: ["disable-gpu", "disableHardwareAcceleration"],
});

app.on("child-process-gone", (_event, details) => {
  writeAgentLog("error", "Electron child-process-gone", details);
});
app.on("web-contents-created", (_event, contents) => {
  writeAgentLog("info", "Renderer/web-contents created", {
    id: contents.id,
    url: contents.getURL(),
  });
  contents.on("render-process-gone", (_renderEvent, details) => {
    writeAgentLog("error", "render-process-gone", {
      webContentsId: contents.id,
      url: contents.getURL(),
      details,
    });
  });
  contents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeAgentLog("error", "renderer did-fail-load", {
      webContentsId: contents.id,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
  contents.on("did-finish-load", () => {
    writeAgentLog("info", "renderer did-finish-load", {
      webContentsId: contents.id,
      url: contents.getURL(),
    });
  });
  contents.on("console-message", (_consoleEvent, level, message, line, sourceId) => {
    writeAgentLog(level >= 2 ? "error" : level === 1 ? "warn" : "info", "renderer console", {
      webContentsId: contents.id,
      message,
      line,
      sourceId,
    });
  });
});

// Squirrel install events
if (require("electron-squirrel-startup")) process.exit(0);

const PRODUCTION_SERVER_URL =
  "https://supportas-fxdwbkfyfgfbg2g5.canadacentral-01.azurewebsites.net";

// ── Read config ───────────────────────────────────────────────────────────────
function loadConfig() {
  setStartupStage("loading-agent-configuration");
  writeAgentLog("info", "Loading agent configuration.");
  const args = process.argv.slice(2);

  const readArg = (name) => {
    const inline = args.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1).trim();
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1].trim() : "";
  };

  const argCode = readArg("--code");
  const argServer = readArg("--server");

  const configPath = path.join(app.getPath("userData"), "config.json");
  let fileConfig = {};

  try {
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err) {
    console.error("[Agent] Failed to read config:", err.message);
  }

  const installConfigPath = path.join(
    path.dirname(process.execPath),
    "config.json"
  );

  let installConfig = {};

  try {
    if (fs.existsSync(installConfigPath)) {
      installConfig = JSON.parse(
        fs.readFileSync(installConfigPath, "utf8")
      );
    }
  } catch (err) {
    console.error("[Agent] Failed to read install config:", err.message);
  }

  const configuredServerUrl =
    argServer || installConfig.serverUrl || fileConfig.serverUrl || "";
  const serverUrl = configuredServerUrl.startsWith("https://")
    ? configuredServerUrl
    : PRODUCTION_SERVER_URL;
  const supportCode =
    String(argCode || installConfig.supportCode || fileConfig.supportCode || "")
      .trim()
      .replace(/[^0-9]/g, "");

  const config = {
    serverUrl,
    supportCode: supportCode.length === 6 ? supportCode : "",

    unattendedAccess: !!(
      fileConfig.unattendedAccess ??
      installConfig.unattendedAccess ??
      false
    ),

    consentAsked: !!(
      fileConfig.consentAsked ??
      installConfig.consentAsked ??
      false
    ),
  };

  writeAgentLog("info", "Configuration loaded.", {
    argv: redactProcessArguments(process.argv.slice(2)),
    execPath: process.execPath,
    configPath,
    installConfigPath,
    cliCodeLoaded: !!argCode,
    fileCodeLoaded: !!fileConfig.supportCode,
    installCodeLoaded: !!installConfig.supportCode,
    supportCodeConfigured: config.supportCode.length === 6,
    serverUrl: config.serverUrl,
    consentAsked: config.consentAsked,
    unattendedAccess: config.unattendedAccess,
  });
  return config;
}

let CONFIG = loadConfig();
lifecycleState.supportCode = CONFIG.supportCode || null;
lifecycleState.unattended = CONFIG.unattendedAccess;
setStartupStage("configuration-loaded");

function persistConfig() {
  try {
    const configPath = path.join(app.getPath("userData"), "config.json");

    fs.mkdirSync(path.dirname(configPath), {
      recursive: true,
    });

    fs.writeFileSync(
      configPath,
      JSON.stringify(CONFIG, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("[Agent] Failed to save config:", err.message);
  }
}

if (CONFIG.supportCode && CONFIG.serverUrl.startsWith("https://")) {
  persistConfig();
}

const IS_DEV = process.argv.includes("--dev");
const IS_HIDDEN_START = process.argv.includes("--hidden");
writeAgentLog("info", "Startup mode selected.", {
  hidden: IS_HIDDEN_START,
  development: IS_DEV,
  supportCodeConfigured: CONFIG.supportCode.length === 6,
});

let setupWindow = null;
let setupWindowReadyPromise = null;
let rejectSetupWindowReady = null;
let consentWindow = null;
let tray = null;
let approvalWindow = null;
let pendingApprovalRequest = null;
let approvalDecisionHandled = false;
let privacyWindows = [];
let socket = null;

let isConnected = false;
let sessionActive = false;
let streamInterval = null;
let activeMonitor = 0;
let inputLocked = false;
let blankScreenOn = false;
let currentMediaKey = "default-blue";
let currentMediaType = "css";
let currentMediaUrl = null;
let activeSessionId = null;
let registrationHeartbeat = null;

if (CONFIG.supportCode && CONFIG.serverUrl.startsWith("https://")) {
  persistConfig();
}

// ── Single instance ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  writeAgentLog("warn", "Another Connect Support agent instance already owns the single-instance lock; exiting.");
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
  }
  if (consentWindow && !consentWindow.isDestroyed()) {
    consentWindow.show();
    consentWindow.focus();
  }
  if (approvalWindow && !approvalWindow.isDestroyed()) {
    approvalWindow.show();
    approvalWindow.focus();
  }
});

// ── Consent window ────────────────────────────────────────────────────────────
function showConsentWindow() {
  if (consentWindow && !consentWindow.isDestroyed()) {
    consentWindow.focus();
    return;
  }

  writeAgentLog("info", "Creating consent window.");
  consentWindow = new BrowserWindow({
    width: 520,
    height: 340,
    resizable: false,
    title: "Connect Support Agent Consent",
    skipTaskbar: true,
    frame: false,
    show: false,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Support</title>
<style>
* { box-sizing:border-box; }
body {
  margin:0;
  padding:28px;
  font-family:Segoe UI,system-ui,sans-serif;
  background:#0d1117;
  color:#e6edf3;
}
h1 { font-size:26px; margin:0 0 12px; }
p { color:#c9d1d9; line-height:1.6; margin:0 0 20px; }
.actions { display:flex; gap:12px; margin-top:18px; }
button {
  flex:1;
  padding:14px 18px;
  border:0;
  border-radius:10px;
  font-size:15px;
  font-weight:600;
  cursor:pointer;
}
#allow { background:#2563eb; color:#fff; }
#deny {
  background:#21262d;
  color:#8b949e;
  border:1px solid #30363d;
}
.note {
  font-size:12px;
  color:#8b949e;
  margin-top:16px;
}
</style>
</head>
<body>


<p>
This lets your technician help to fix issues on your computer.
</p>


<div class="actions">
  <button id="allow">Allow</button>
  <button id="deny">Deny</button>
</div>


<script>
document.getElementById("allow").addEventListener("click", () => {
  window.electronBridge.saveConsent(true);
});

document.getElementById("deny").addEventListener("click", () => {
  window.electronBridge.saveConsent(false);
});
</script>

</body>
</html>`;

  consentWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .then(() => writeAgentLog("info", "Consent window content loaded."))
    .catch((error) => writeAgentLog("error", "Consent window load failed.", error));

  consentWindow.show();

  consentWindow.on("closed", () => {
    writeAgentLog("info", "Consent window closed.");
    consentWindow = null;
  });
}

// ── Setup window ──────────────────────────────────────────────────────────────
function showSetupWindow({ hidden = false } = {}) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    if (!hidden) setupWindow.focus();
    return setupWindowReadyPromise || Promise.resolve(setupWindow);
  }

  writeAgentLog("info", "[WebRTC] Renderer creation requested", { hidden });
  writeAgentLog("info", "Creating setup/WebRTC renderer window.", { hidden });
  setupWindow = new BrowserWindow({
    width: 480,
    height: 430,
    resizable: false,
    title: "Connect Support Agent Setup",
    skipTaskbar: true,
    frame: false,
    show: false,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const windowRef = setupWindow;
  let settled = false;
  setupWindowReadyPromise = new Promise((resolve, reject) => {
    rejectSetupWindowReady = reject;

    windowRef.webContents.once("did-finish-load", () => {
      if (setupWindow !== windowRef || windowRef.isDestroyed() || settled) return;
      settled = true;
      rejectSetupWindowReady = null;
      writeAgentLog("info", "[WebRTC] Renderer ready", { hidden, windowId: windowRef.id });
      resolve(windowRef);
    });

    windowRef.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || settled || setupWindow !== windowRef) return;
      const error = new Error(`WebRTC renderer failed to load: ${errorCode} ${errorDescription}`);
      writeAgentLog("error", "[WebRTC] Renderer load failed", {
        errorCode,
        errorDescription,
        validatedURL,
        windowId: windowRef.id,
      });
      settled = true;
      setupWindow = null;
      setupWindowReadyPromise = null;
      rejectSetupWindowReady = null;
      reject(error);
      if (!windowRef.isDestroyed()) windowRef.destroy();
    });

    windowRef.webContents.on("render-process-gone", (_event, details) => {
      if (setupWindow !== windowRef) return;
      const error = new Error(`WebRTC renderer process gone: ${details?.reason || "unknown reason"}`);
      writeAgentLog("error", "[WebRTC] Renderer process gone", details);
      const rejectPending = rejectSetupWindowReady;
      setupWindow = null;
      setupWindowReadyPromise = null;
      rejectSetupWindowReady = null;
      if (!settled) {
        settled = true;
        rejectPending?.(error);
      }
      if (!windowRef.isDestroyed()) windowRef.destroy();
    });
  });
  // Some setup-window callers do not await rendering. Keep their failures logged
  // without turning a renderer rejection into an unhandled main-process rejection.
  setupWindowReadyPromise.catch(() => {});

  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Connect Support</title>

<style>
* { box-sizing:border-box; }

body {
  margin:0;
  padding:32px;
  font-family:Segoe UI,system-ui,sans-serif;
  background:#0d1117;
  color:#e6edf3;
}

h1 {
  font-size:24px;
  margin:0 0 8px;
}

p {
  color:#8b949e;
  line-height:1.5;
  margin:8px 0 24px;
}

label {
  display:block;
  color:#8b949e;
  font-size:13px;
  margin-bottom:8px;
}

input {
  width:100%;
  padding:13px;
  border:1px solid #30363d;
  border-radius:8px;
  background:#161b22;
  color:#fff;
  font-size:22px;
  letter-spacing:.25em;
  text-align:center;
}

button {
  width:100%;
  margin-top:20px;
  padding:13px;
  border:0;
  border-radius:8px;
  background:#2563eb;
  color:#fff;
  font-size:15px;
  font-weight:600;
  cursor:pointer;
}

#error {
  color:#f87171;
  font-size:13px;
  min-height:20px;
  margin-top:12px;
  text-align:center;
}
</style>
</head>

<body>

<h1>Connect Support</h1>

<p>
Enter the 6-digit support code generated by your technician.
</p>

<label for="code">Support code</label>

<input
  id="code"
  maxlength="6"
  inputmode="numeric"
  autofocus
>

<button id="connect">Connect Agent</button>

<div id="error"></div>

<script>
const code = document.getElementById("code");
const button = document.getElementById("connect");
const error = document.getElementById("error");
let localPeerConnection = null;
let localScreenStream = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

async function startWebRtcStream(data) {
  if (!data || !data.sourceId) {
    console.error("[WebRTC] WEBRTC_START aborted: no desktop source selected.", {
      hasData: !!data,
      hasSourceId: !!data?.sourceId,
    });
    return;
  }

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((track) => track.stop());
    localScreenStream = null;
  }

  if (localPeerConnection) {
    localPeerConnection.close();
    localPeerConnection = null;
  }

  try {
    localScreenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: data.sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          maxFrameRate: 30,
        },
        optional: [{ minFrameRate: 10 }],
      },
    });
    console.log("[WebRTC] Desktop capture started.", {
      tracks: localScreenStream.getTracks().map((track) => ({ kind: track.kind, state: track.readyState })),
    });

    const peerConnection = new RTCPeerConnection(rtcConfig);
    console.log("[WebRTC] RTCPeerConnection created.");

    localPeerConnection = peerConnection;
    peerConnection.addEventListener("connectionstatechange", () => {
      console.log("[WebRTC] connectionState changed.", peerConnection.connectionState);
    });
    peerConnection.addEventListener("iceconnectionstatechange", () => {
      console.log("[WebRTC] iceConnectionState changed.", peerConnection.iceConnectionState);
    });
    peerConnection.addEventListener("signalingstatechange", () => {
      console.log("[WebRTC] signalingState changed.", peerConnection.signalingState);
    });

    localScreenStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localScreenStream);
    });

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;
      console.log("[WebRTC] ICE_CANDIDATE_SENT", event.candidate.type);
      window.electronBridge.sendSignalOutgoing({
        type: "candidate",
        candidate: event.candidate.toJSON(),
        sessionId: data.activeSessionId,
        supportCode: data.supportCode,
      });
    };

    console.log("[WebRTC] Creating offer.");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("[WebRTC] Local offer set; sending offer.");
    window.electronBridge.sendSignalOutgoing({
      type: "offer",
      sdp: offer.sdp,
      sessionId: data.activeSessionId,
      supportCode: data.supportCode,
    });
  } catch (err) {
    console.error("[WebRTC] WEBRTC_START failed.", err);
  }
}

window.electronBridge.onStartWebRTC((data) => {
  startWebRtcStream(data).catch((err) => {
    console.error("[Agent] WebRTC bootstrapping failed:", err);
  });
});

window.electronBridge.onSignalIncoming((payload) => {
  if (!payload || !localPeerConnection) return;

  if (payload.type === "answer") {
    console.log("[WebRTC] WEBRTC_ANSWER_RECEIVED", { type: payload.type });
    localPeerConnection.setRemoteDescription(new RTCSessionDescription(payload))
      .then(() => console.log("[WebRTC] Remote answer applied."))
      .catch((error) => console.error("[WebRTC] Applying remote answer failed.", error));
  } else if (payload.type === "candidate" && payload.candidate) {
    console.log("[WebRTC] ICE_CANDIDATE_RECEIVED", { candidateType: payload.candidate.type });
    localPeerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
      .catch((error) => console.error("[WebRTC] Adding remote ICE candidate failed.", error));
  }
});

code.addEventListener("input", () => {
  code.value = code.value.replace(/\D/g, "").slice(0, 6);
});

button.addEventListener("click", async () => {
  const supportCode = code.value.trim().replace(/[^0-9]/g, "");
  console.log("[Agent] Setup code submitted", {
    rawLength: code.value.length,
    supportCodeValid: supportCode.length === 6,
  });
  if (supportCode.length !== 6) {
    error.textContent = "Enter exactly 6 digits.";
    return;
  }

  button.disabled = true;

  const result =
    await window.electronBridge.configure(supportCode);

  if (!result.ok) {
    error.textContent = result.error;
    button.disabled = false;
  }
});

code.addEventListener("keydown", (event) => {
  if (event.key === "Enter") button.click();
});
</script>

</body>
</html>`;

  const readyPromise = setupWindowReadyPromise;
  windowRef.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .then(() => writeAgentLog("info", "Setup/WebRTC renderer content loaded.", { hidden }))
    .catch((error) => {
      if (setupWindow !== windowRef) return;
      writeAgentLog("error", "[WebRTC] Renderer load failed", error);
      setupWindow = null;
      setupWindowReadyPromise = null;
      const rejectPending = rejectSetupWindowReady;
      rejectSetupWindowReady = null;
      if (!settled) {
        settled = true;
        rejectPending?.(error);
      }
      if (!windowRef.isDestroyed()) windowRef.destroy();
    });

  if (!hidden) windowRef.show();

  windowRef.on("closed", () => {
    writeAgentLog("info", "Setup/WebRTC renderer window closed.", { windowId: windowRef.id });
    if (setupWindow === windowRef) {
      setupWindow = null;
      const rejectPending = rejectSetupWindowReady;
      setupWindowReadyPromise = null;
      rejectSetupWindowReady = null;
      if (!settled) {
        settled = true;
        rejectPending?.(new Error("WebRTC renderer window closed before it was ready."));
      }
    }
  });

  return readyPromise;
}

async function ensureWebRTCRenderer() {
  writeAgentLog("info", "[WebRTC] Renderer creation requested for an approved session.");
  try {
    return await showSetupWindow({ hidden: true });
  } catch (error) {
    writeAgentLog("error", "[WebRTC] Renderer load failed", error);
    throw error;
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle("configure-agent", async (_event, supportCode) => {
  const normalizedCode = String(supportCode ?? "").trim().replace(/[^0-9]/g, "");
  if (normalizedCode.length !== 6) {
    return {
      ok: false,
      error: "Enter exactly 6 digits.",
    };
  }

  CONFIG = {
    ...CONFIG,
    supportCode: normalizedCode,
  };
  lifecycleState.supportCode = CONFIG.supportCode;

  persistConfig();

  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.hide();
  }

  updateTrayMenu();

  setTimeout(() => {
    if (!socket || !socket.connected) {
      connectSocket();
    }
  }, 250);

  return { ok: true };
});

ipcMain.handle("save-consent", async (_event, enabled) => {
  CONFIG = {
    ...CONFIG,
    unattendedAccess: !!enabled,
    consentAsked: true,
  };
  lifecycleState.unattended = CONFIG.unattendedAccess;

  persistConfig();

  if (consentWindow && !consentWindow.isDestroyed()) {
    consentWindow.close();
  }

  updateTrayMenu();

  if (CONFIG.supportCode) {
    setTimeout(() => {
      if (!socket || !socket.connected) {
        connectSocket();
      }
    }, 250);
  } else {
    showSetupWindow();
  }

  return { ok: true };
});

ipcMain.handle("approval-response", async (_event, approved) => {
  if (!approvalWindow || approvalWindow.isDestroyed() || _event.sender !== approvalWindow.webContents) {
    writeAgentLog("warn", "Rejected approval response from a non-consent renderer.");
    return { ok: false, error: "Invalid consent window." };
  }
  const request = pendingApprovalRequest;
  if (!request || approvalDecisionHandled) {
    writeAgentLog("warn", "Ignored approval response without an active pending request.", {
      approved: !!approved,
    });
    return { ok: false, error: "No pending connection request." };
  }
  if (!socket?.connected) {
    writeAgentLog("error", "Cannot respond to technician request because Socket.IO is disconnected.", {
      sessionId: request.sessionId,
      socketId: socket?.id || null,
    });
    return { ok: false, error: "Connection to the support server was lost." };
  }

  approvalDecisionHandled = true;
  lifecycleState.webrtc = false;
  if (approved) {
    setStartupStage("customer-consent-accepted");
    writeAgentLog("info", "CONSENT_ACCEPTED", { sessionId: request.sessionId });
    socket.emit("client-approved-connection", {
      supportCode: CONFIG.supportCode,
      sessionId: request.sessionId,
    });
  } else {
    setStartupStage("customer-consent-rejected");
    writeAgentLog("info", "CONSENT_REJECTED", { sessionId: request.sessionId });
    socket.emit("client-rejected-connection", {
      supportCode: CONFIG.supportCode,
      sessionId: request.sessionId,
    });
  }

  pendingApprovalRequest = null;
  lifecycleState.technicianRequest = false;
  if (approvalWindow && !approvalWindow.isDestroyed()) approvalWindow.close();
  return { ok: true };
});

ipcMain.on("send-webrtc-signaling", (_event, data) => {
  if (!socket || !socket.connected || !data) return;
  if (data.type === "offer") {
    lifecycleState.webrtc = true;
    writeAgentLog("info", "WEBRTC_OFFER_SENT", { sessionId: data.sessionId });
  } else if (data.type === "answer") {
    writeAgentLog("info", "WEBRTC_ANSWER_SENT", { sessionId: data.sessionId });
  } else if (data.type === "candidate") {
    writeAgentLog("info", "ICE_CANDIDATE_SENT", { sessionId: data.sessionId });
  }
  socket.emit("webrtc-signaling", {
    ...data,
    supportCode: data.supportCode || CONFIG.supportCode,
  });
});

writeAgentLog("info", "Effective agent configuration.", {
  serverUrl: CONFIG.serverUrl,
  supportCodeConfigured: CONFIG.supportCode.length === 6,
  unattendedAccess: CONFIG.unattendedAccess,
  consentAsked: CONFIG.consentAsked,
});

// ── Auto start ────────────────────────────────────────────────────────────────
// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(
    __dirname,
    "..",
    "assets",
    "tray-icon.png"
  );

  let icon;

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  tray.setToolTip("Connect Support Agent");

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const statusLabel = isConnected
    ? sessionActive
      ? "● Session Active"
      : "● Online — Waiting"
    : "○ Disconnected";

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Connect Support Agent",
        enabled: false,
      },
      {
        label: statusLabel,
        enabled: false,
      },
      {
        label: CONFIG.supportCode
          ? `Code: ${CONFIG.supportCode}`
          : "No code configured",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Disconnect Session",
        enabled: sessionActive,
        click: () => endSession(),
      },
      { type: "separator" },
      {
        label: "Quit Agent",
        click: () => {
          if (socket) socket.disconnect();
          app.quit();
        },
      },
    ])
  );
}

// ── Session cleanup ───────────────────────────────────────────────────────────
function endSession() {
  console.log("[Agent] Ending session");

  sessionActive = false;
  lifecycleState.webrtc = false;
  lifecycleState.technicianRequest = false;
  activeSessionId = null;

  closeAllPrivacyWindows();
  setInputLock(false);

  updateTrayMenu();
}

// ── Privacy curtain ───────────────────────────────────────────────────────────
function getPrivacyHTML(mediaKey, mediaType, mediaUrl) {
  const styles = {
    "default-blue": `
      background:radial-gradient(
        ellipse at center,
        #0a1628 0%,
        #020c1b 100%
      );
    `,

    "matrix-loop": `
      background:#000;
    `,

    "maintenance-anim": `
      background:linear-gradient(
        135deg,
        #0f172a 0%,
        #1e1b4b 50%,
        #0f172a 100%
      );
    `,

    "custom-video": `
      background:#000;
    `,
  };

  const chosen =
    styles[mediaKey] || styles["default-blue"];

  const mediaElement =
    mediaUrl && mediaType === "video"
      ? `<video autoplay loop muted playsinline
           src="${mediaUrl}"
           style="
             position:fixed;
             inset:0;
             width:100%;
             height:100%;
             object-fit:contain;
             z-index:0;
           ">
         </video>`
      : mediaUrl && mediaType === "image"
        ? `<img
             src="${mediaUrl}"
             alt=""
             style="
               position:fixed;
               inset:0;
               width:100%;
               height:100%;
               object-fit:contain;
               z-index:0;
             "
           />`
        : "";

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">

<style>
* {
  margin:0;
  padding:0;
  box-sizing:border-box;
}

body {
  width:100vw;
  height:100vh;
  overflow:hidden;
  display:flex;
  align-items:center;
  justify-content:center;
  ${chosen}
}

.overlay {
  position:relative;
  z-index:10;
  text-align:center;
  padding:40px;
  background:rgba(0,0,0,.6);
  border-radius:16px;
  color:#fff;
  font-family:system-ui,sans-serif;
}
</style>
</head>

<body>

${mediaElement}

<div class="overlay">
  <h1>Maintenance in Progress</h1>

  <p>
    Your technician is currently performing maintenance
    on your computer.
  </p>
</div>

</body>
</html>`;
}

function openPrivacyWindows(
  mediaKey,
  mediaType,
  mediaUrl
) {
  closeAllPrivacyWindows();

  const displays = screen.getAllDisplays();

  blankScreenOn = true;

  displays.forEach((display) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      fullscreen: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      movable: false,
      backgroundColor: "#000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        getPrivacyHTML(
          mediaKey || "default-blue",
          mediaType,
          mediaUrl
        )
      )}`
    );

    win.setAlwaysOnTop(true, "screen-saver");
    win.setKiosk(true);
    win.setFullScreen(true);
    win.moveTop();

    privacyWindows.push(win);
  });
}

function closeAllPrivacyWindows() {
  blankScreenOn = false;

  privacyWindows.forEach((win) => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {}
  });

  privacyWindows = [];
}

function updatePrivacyMedia(
  mediaKey,
  mediaType,
  mediaUrl
) {
  currentMediaKey = mediaKey;
  currentMediaType = mediaType || "css";
  currentMediaUrl = mediaUrl || null;

  if (!blankScreenOn) return;

  privacyWindows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          getPrivacyHTML(mediaKey || "default-blue", mediaType, mediaUrl)
        )}`
      );
    }
  });
}

function setInputLock(locked) {
  inputLocked = !!locked;
}

// ── Approval ──────────────────────────────────────────────────────────────────
function showApprovalWindow(data) {
  pendingApprovalRequest = data;
  approvalDecisionHandled = false;
  lifecycleState.technicianRequest = true;

  if (approvalWindow && !approvalWindow.isDestroyed()) {
    lifecycleState.consentWindow = true;
    writeAgentLog("info", "Reusing and focusing the existing consent window.");
    approvalWindow.focus();
    return;
  }

  setStartupStage("creating-consent-window");
  writeAgentLog("info", "CONSENT_WINDOW_CREATE", { sessionId: data?.sessionId });
  approvalWindow = new BrowserWindow({
    width: 480,
    height: 340,
    resizable: false,
    alwaysOnTop: true,
    modal: false,
    title: "Connect Support — Connection Request",
    skipTaskbar: true,
    frame: false,
    show: false,
    visibleOnAllWorkspaces: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  lifecycleState.consentWindow = true;

  const html = `
<!doctype html>
<html>
<body style="
margin:0;
background:#0d1117;
color:white;
font-family:system-ui;
display:flex;
height:100vh;
align-items:center;
justify-content:center;
">

<div style="text-align:center">
<h2>Remote Support Request</h2>

<p>
Your technician is requesting remote access.
</p>

<h1>${CONFIG.supportCode}</h1>

<button id="allow">
Allow Access
</button>

<button id="deny">
Decline
</button>
</div>
<script>
const allowButton = document.getElementById("allow");
const denyButton = document.getElementById("deny");
async function respond(approved) {
  allowButton.disabled = true;
  denyButton.disabled = true;
  try {
    const result = await window.electronBridge.respondToApproval(approved);
    if (!result?.ok) {
      allowButton.disabled = false;
      denyButton.disabled = false;
      document.getElementById("status").textContent = result?.error || "Could not send your response. Please try again.";
    }
  } catch (error) {
    allowButton.disabled = false;
    denyButton.disabled = false;
    document.getElementById("status").textContent = error?.message || "Could not send your response. Please try again.";
  }
}
allowButton.addEventListener("click", () => respond(true));
denyButton.addEventListener("click", () => respond(false));
</script>
<p id="status" role="status"></p>

</body>
</html>`;

  approvalWindow.once("ready-to-show", () => {
    if (!approvalWindow || approvalWindow.isDestroyed()) return;
    lifecycleState.consentWindow = true;
    setStartupStage("consent-window-shown");
    writeAgentLog("info", "CONSENT_WINDOW_SHOWN", { sessionId: data?.sessionId });
    approvalWindow.show();
    approvalWindow.focus();
  });

  approvalWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .then(() => writeAgentLog("info", "Consent window document loaded.", { sessionId: data?.sessionId }))
    .catch((error) => writeAgentLog("error", "Consent window document load failed.", error));

  approvalWindow.on("closed", () => {
    const hadPendingRequest = !!pendingApprovalRequest && !approvalDecisionHandled;
    writeAgentLog(hadPendingRequest ? "warn" : "info", hadPendingRequest
      ? "Consent window closed before a decision; treating the close as a rejection."
      : "Consent window closed after a recorded decision.", {
      sessionId: pendingApprovalRequest?.sessionId,
      socketConnected: !!socket?.connected,
    });
    if (hadPendingRequest && socket?.connected) {
      socket.emit("client-rejected-connection", {
        supportCode: CONFIG.supportCode,
        sessionId: pendingApprovalRequest.sessionId,
      });
    }
    pendingApprovalRequest = null;
    approvalDecisionHandled = false;
    lifecycleState.technicianRequest = false;
    lifecycleState.consentWindow = false;
    approvalWindow = null;
  });
}

function startApprovedSession() {
  console.log("[Agent] Starting approved session");

  sessionActive = true;
  lifecycleState.webrtc = true;

  updateTrayMenu();
}

// ── Remote control ────────────────────────────────────────────────────────────
async function handleMouseEvent(data) {
  if (inputLocked) return;

  try {
    const { mouse, Button, Point } =
      require("@nut-tree-fork/nut-js");

    const displays = screen.getAllDisplays();

    const display =
      displays[
        Math.min(
          activeMonitor,
          displays.length - 1
        )
      ];

    const absX =
      Math.round(data.x * display.bounds.width) +
      display.bounds.x;

    const absY =
      Math.round(data.y * display.bounds.height) +
      display.bounds.y;

    if (data.type === "move") {
      await mouse.move([
        new Point(absX, absY),
      ]);

    } else if (data.type === "click") {
      await mouse.move([
        new Point(absX, absY),
      ]);

      await mouse.click(
        data.button === 2
          ? Button.RIGHT
          : Button.LEFT
      );

    } else if (data.type === "double-click") {
      await mouse.move([
        new Point(absX, absY),
      ]);

      await mouse.doubleClick(Button.LEFT);
    }

  } catch (err) {
    console.warn(
      "[Agent] Mouse event error:",
      err.message
    );
  }
}

async function handleKeyboardEvent(data) {
  if (inputLocked) return;

  try {
    const { keyboard, Key } =
      require("@nut-tree-fork/nut-js");

    const keyMap = {
      Enter: Key.Return,
      Escape: Key.Escape,
      Backspace: Key.Backspace,
      Delete: Key.Delete,
      Tab: Key.Tab,
      Space: Key.Space,
      ArrowUp: Key.Up,
      ArrowDown: Key.Down,
      ArrowLeft: Key.Left,
      ArrowRight: Key.Right,
    };

    const nutKey = keyMap[data.key];

    if (
      !nutKey &&
      data.key &&
      data.key.length === 1 &&
      data.type === "keydown"
    ) {
      await keyboard.type(data.key);
      return;
    }

    if (!nutKey) return;

    if (data.type === "keydown") {
      await keyboard.pressKey(nutKey);

    } else if (data.type === "keyup") {
      await keyboard.releaseKey(nutKey);
    }

  } catch (err) {
    console.warn(
      "[Agent] Keyboard event error:",
      err.message
    );
  }
}

// ── Socket ────────────────────────────────────────────────────────────────────
function connectSocket() {
  if (socket && socket.connected) {
    console.log("[Agent] Socket already connected");
    return;
  }

  if (socket) {
    writeAgentLog("warn", "Disconnecting the previous Socket.IO client before creating a replacement.", {
      previousSocketId: socket.id || null,
      previousSocketConnected: socket.connected,
      callStack: new Error("connectSocket replacement").stack,
    });
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  if (
    !CONFIG.serverUrl ||
    !CONFIG.supportCode
  ) {
    console.error(
      "[Agent] Missing serverUrl or supportCode"
    );
    return;
  }

  setStartupStage("initializing-socket-io");
  writeAgentLog("info", "Initializing Socket.IO client.", {
    serverUrl: CONFIG.serverUrl,
    supportCodeConfigured: CONFIG.supportCode.length === 6,
  });

  socket = io(CONFIG.serverUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
  });
  lifecycleState.socketId = socket.id || null;
  lifecycleState.socketConnected = socket.connected;
  writeAgentLog("info", "Socket.IO client initialized.");

  socket.on("connect", () => {
    lifecycleState.socketId = socket.id;
    lifecycleState.socketConnected = true;
    setStartupStage("socket-connected");
    writeAgentLog("info", "SOCKET_CONNECTED", { socketId: socket.id });
    console.log(
      "[Agent] Socket connected:",
      socket.id
    );

    isConnected = true;

    updateTrayMenu();

    writeAgentLog("info", "SOCKET_REGISTER_START", {
      supportCode: CONFIG.supportCode,
      socketId: socket.id,
      unattended: CONFIG.unattendedAccess,
    });
    socket.emit("register-client", {
      supportCode: CONFIG.supportCode,
      computerName: os.hostname(),
      osInfo: `${os.type()} ${os.release()}`,
      unattendedAccess: CONFIG.unattendedAccess,
      sessionId: activeSessionId,
    });
      setStartupStage("customer-registration-emitted");
      writeAgentLog("info", "SOCKET_REGISTERED", {
        supportCode: CONFIG.supportCode,
        socketId: socket.id,
        unattended: CONFIG.unattendedAccess,
      });
      writeAgentLog("info", "Customer registration emitted.", {
        supportCodeConfigured: CONFIG.supportCode.length === 6,
        serverUrl: CONFIG.serverUrl,
        computerName: os.hostname(),
      });
      if (registrationHeartbeat) clearInterval(registrationHeartbeat);
      registrationHeartbeat = setInterval(() => {
        if (socket?.connected) {
          socket.emit("register-client", {
            supportCode: CONFIG.supportCode,
            computerName: os.hostname(),
            osInfo: `${os.type()} ${os.release()}`,
            unattendedAccess: CONFIG.unattendedAccess,
            sessionId: activeSessionId,
          });
          writeAgentLog("info", "Customer registration heartbeat emitted.", {
            supportCodeConfigured: CONFIG.supportCode.length === 6,
          });
        }
      }, 30000); // every 5 minutes
  });

  socket.on("disconnect", (reason, details) => {
    lifecycleState.socketConnected = false;
    writeAgentLog("warn", "SOCKET_DISCONNECT", {
      reason,
      description: details?.message || details?.description || null,
      supportCode: CONFIG.supportCode,
      socketId: socket?.id || lifecycleState.socketId,
      socketConnected: !!socket?.connected,
      unattended: CONFIG.unattendedAccess,
      technicianRequest: lifecycleState.technicianRequest,
      consentWindow: !!(approvalWindow && !approvalWindow.isDestroyed()),
      webrtc: lifecycleState.webrtc,
      pid: process.pid,
    });
    writeAgentLog("warn", "Socket.IO disconnected.", { reason, details });
    console.log(
      "[Agent] Socket disconnected:",
      reason
    );

    isConnected = false;

    if (registrationHeartbeat) {
      clearInterval(registrationHeartbeat);
      registrationHeartbeat = null;
    }

    // Keep the approved session state during a transient network reconnect.
    // The server will end it only on an explicit technician end-session event.

    updateTrayMenu();
  });

  socket.on("connect_error", (err) => {
    writeAgentLog("error", "Socket.IO connection error.", err);
    console.error(
      "[Agent] Connection error:",
      err.message
    );

    isConnected = false;

    updateTrayMenu();
  });

  socket.on("approval-request", (data) => {
    lifecycleState.technicianRequest = true;
    writeAgentLog("info", "TECH_REQUEST_RECEIVED", {
      supportCode: CONFIG.supportCode,
      sessionId: data?.sessionId,
      techSocketId: data?.techSocketId,
      unattended: CONFIG.unattendedAccess,
    });
    setStartupStage("technician-approval-request-received");
    writeAgentLog("info", "Technician approval request received.", {
      sessionId: data?.sessionId,
    });
    console.log(
      "[Agent] Approval request received:",
      data.sessionId
    );

    if (CONFIG.unattendedAccess) {
      console.log(
        "[Agent] Unattended access enabled. Auto-approving."
      );

      socket.emit("client-approved-connection", {
        supportCode: CONFIG.supportCode,
        sessionId: data.sessionId,
      });
      lifecycleState.technicianRequest = false;

      return;
    }

    showApprovalWindow(data);
  });

  socket.on("connection-approved", async ({ sessionId } = {}) => {
    setStartupStage("technician-connection-approved");
    writeAgentLog("info", "Technician connection approved; preparing screen capture.", {
      sessionId,
    });
    console.log(
      "[Agent] Connection approved. Starting WebRTC stream."
    );

    activeSessionId = sessionId || activeSessionId;

    try {
      const renderer = await ensureWebRTCRenderer();
      writeAgentLog("info", "[WebRTC] Session initialization started", {
        sessionId: activeSessionId,
        rendererWindowId: renderer.id,
      });

      lifecycleState.webrtc = true;
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const targetSource = sources[Math.min(activeMonitor, Math.max(sources.length - 1, 0))] || sources[0];
      if (!targetSource) {
        throw new Error("Electron did not return an available screen-capture source.");
      }

      renderer.webContents.send("start-webrtc-stream", {
        sourceId: targetSource.id,
        activeSessionId,
        supportCode: CONFIG.supportCode,
      });
      writeAgentLog("info", "[WebRTC] Session initialization completed", {
        sessionId: activeSessionId,
        rendererWindowId: renderer.id,
      });
      startApprovedSession();
    } catch (err) {
      lifecycleState.webrtc = false;
      writeAgentLog("error", "[WebRTC] Session initialization failed; keeping Socket.IO agent online.", err);
      console.error("[WebRTC] Session initialization failed; customer agent remains connected.", err);
    }
  });

  socket.on("webrtc-signaling", (data) => {
    writeAgentLog("info", "WEBRTC_SIGNAL_RECEIVED", {
      type: data?.type,
      sessionId: data?.sessionId,
      supportCode: CONFIG.supportCode,
    });
    if (!setupWindow || setupWindow.isDestroyed()) return;
    setupWindow.webContents.send("webrtc-signaling-incoming", data);
  });

  socket.on("tech-disconnected", ({ intentional } = {}) => {
    if (!intentional) {
      console.warn("[Agent] Ignoring unintentional/legacy tech disconnect event");
      return;
    }
    console.log("[Agent] Tech intentionally ended session");
    lifecycleState.webrtc = false;
    endSession();
  });

  socket.on("mouse-event", (data) => {
    handleMouseEvent(data).catch(console.error);
  });

  socket.on("keyboard-event", (data) => {
    handleKeyboardEvent(data).catch(console.error);
  });

  socket.on(
    "toggle-blank-screen",
    ({ enabled, mediaKey, mediaType, mediaUrl } = {}) => {
      console.log(
        "[Agent] Blank screen:",
        enabled
      );

      if (enabled) {
        openPrivacyWindows(
          mediaKey || currentMediaKey,
          mediaType,
          mediaUrl
        );
      } else {
        closeAllPrivacyWindows();
      }

      updateTrayMenu();
    }
  );

  socket.on(
    "change-privacy-media",
    ({ mediaKey, mediaType, mediaUrl }) => {
      currentMediaKey =
        mediaKey || "default-blue";

      updatePrivacyMedia(
        currentMediaKey,
        mediaType,
        mediaUrl
      );
    }
  );

  socket.on(
    "toggle-input-lock",
    ({ enabled }) => {
      console.log(
        "[Agent] Input lock:",
        enabled
      );

      setInputLock(enabled);
    }
  );

  socket.on(
    "switch-monitor",
    ({ monitorIndex }) => {
      activeMonitor = Number.isInteger(monitorIndex)
        ? monitorIndex
        : 0;

      console.log(
        "[Agent] Switched to monitor:",
        activeMonitor
      );
    }
  );

  socket.on(
    "clipboard-sync",
    ({ content, direction }) => {
      if (direction === "to-client") {
        clipboard.writeText(content || "");
      } else {
        socket.emit("clipboard-sync", {
          supportCode: CONFIG.supportCode,
          content: clipboard.readText(),
          direction: "to-tech",
        });
      }
    }
  );

  const incomingFiles = new Map();

  socket.on("file-chunk", (data) => {
    if (data.direction !== "upload") return;

    const {
      fileId,
      fileName,
      chunkIndex,
      totalChunks,
      chunk,
    } = data;

    if (!incomingFiles.has(fileId)) {
      incomingFiles.set(fileId, {
        chunks: new Array(totalChunks),
        received: 0,
        fileName,
        totalChunks,
      });
    }

    const file = incomingFiles.get(fileId);

    file.chunks[chunkIndex] = chunk;
    file.received++;

    if (file.received === totalChunks) {
      const binary = Buffer.from(
        file.chunks.join(""),
        "base64"
      );

      const savePath = path.join(
        app.getPath("downloads"),
        file.fileName
      );

      fs.writeFileSync(savePath, binary);

      shell.showItemInFolder(savePath);

      incomingFiles.delete(fileId);

      console.log(
        "[Agent] File received:",
        savePath
      );
    }
  });
}

// ── App startup ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  setStartupStage("electron-app-ready");
  writeAgentLog("info", "Electron app.whenReady resolved.");

  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  try {
    setStartupStage("creating-system-tray");
    createTray();
    console.log("[Agent] Tray created");
    setStartupStage("system-tray-created");
  } catch (err) {
    console.error(
      "[Agent] Tray creation failed:",
      err.message
    );
  }

  try {
    globalShortcut.register(
      "CommandOrControl+Alt+Escape",
      () => {
        console.log(
          "[Agent] Emergency exit shortcut triggered"
        );

        endSession();

        if (socket) socket.disconnect();

        app.quit();
      }
    );
  } catch (err) {
    console.error(
      "[Agent] Failed to register shortcut:",
      err.message
    );
  }

  if (IS_HIDDEN_START) {
    console.log("[Agent] Hidden startup via Windows login");

    if (!CONFIG.consentAsked) {
      showConsentWindow();
    } else if (CONFIG.supportCode) {
      setStartupStage("starting-background-socket-connection");
      connectSocket();
    } else {
      showSetupWindow();
    }
  } else if (!CONFIG.consentAsked) {
    console.log("[Agent] Showing consent window");
    showConsentWindow();
  } else if (CONFIG.supportCode) {
    console.log("[Agent] Starting socket connection");
    setStartupStage("starting-socket-connection");
    connectSocket();
  } else {
    console.log("[Agent] Showing setup window");
    showSetupWindow();
  }

  if (IS_DEV) {
    writeAgentLog("info", "Creating development window.");
    const devWin = new BrowserWindow({
      width: 500,
      height: 300,
      title: "Connect Support Agent — DEV MODE",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    devWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <html>
        <body style="
          font-family:system-ui;
          background:#0d1117;
          color:#e6edf3;
          padding:20px
        ">
          <h2>Connect Support Agent — Dev Mode</h2>
          <p>Server: <b>${CONFIG.serverUrl}</b></p>
          <p>
            Code:
            <b>${CONFIG.supportCode || "NOT SET"}</b>
          </p>
        </body>
        </html>
      `)}`
    );
  }
  setStartupStage("electron-startup-complete");
}).catch((error) => {
  writeAgentLog("error", "Electron app.whenReady/startup failed.", error);
  app.exit(1);
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("activate", () => {
  if (
    CONFIG.supportCode &&
    CONFIG.consentAsked &&
    (!socket || !socket.connected)
  ) {
    connectSocket();
  }
});

app.on("before-quit", () => {
  setStartupStage("before-quit");
  writeAgentLog("warn", "Electron before-quit received; intentional application shutdown.", {
    socketId: socket?.id || null,
    socketConnected: !!socket?.connected,
    technicianRequest: lifecycleState.technicianRequest,
    consentWindow: !!(approvalWindow && !approvalWindow.isDestroyed()),
    webrtc: lifecycleState.webrtc,
    callStack: new Error("before-quit").stack,
  });
  globalShortcut.unregisterAll();

  closeAllPrivacyWindows();

  if (socket) {
    writeAgentLog("warn", "Disconnecting Socket.IO as part of Electron before-quit.", {
      socketId: socket.id,
      socketConnected: socket.connected,
    });
    socket.disconnect();
  }
});

app.on("will-quit", () => {
  writeAgentLog("info", "Electron will-quit received.");
});