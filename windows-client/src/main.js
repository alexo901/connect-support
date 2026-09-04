/**
 * Connect Support — Windows Native Client Agent
 * Electron Main Process
 */

"use strict";

// Squirrel install events
if (require("electron-squirrel-startup")) process.exit(0);

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
} = require("electron");

const path = require("path");
const os = require("os");
const fs = require("fs");
const { io } = require("socket.io-client");

// ── Read config ───────────────────────────────────────────────────────────────
function loadConfig() {
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

  const config = {
    serverUrl:
      argServer ||
      fileConfig.serverUrl ||
      installConfig.serverUrl ||
      "http://localhost:3000",

    supportCode:
      argCode ||
      fileConfig.supportCode ||
      installConfig.supportCode ||
      "",

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

  console.log("[Agent] Config sources:", {
    argv: process.argv.slice(2),
    cliCodeLoaded: !!argCode,
    fileCodeLoaded: !!fileConfig.supportCode,
    installCodeLoaded: !!installConfig.supportCode,
    supportCode: config.supportCode,
  });
  return config;
}

let CONFIG = loadConfig();

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

const IS_DEV = process.argv.includes("--dev");

let setupWindow = null;
let consentWindow = null;
let tray = null;
let approvalWindow = null;
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

// ── Single instance ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Consent window ────────────────────────────────────────────────────────────
function showConsentWindow() {
  if (consentWindow && !consentWindow.isDestroyed()) {
    consentWindow.focus();
    return;
  }

  consentWindow = new BrowserWindow({
    width: 520,
    height: 340,
    resizable: false,
    title: "Connect Support Agent Consent",
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
<title>Connect Support Consent</title>
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

<h1>Allow future unattended remote access?</h1>

<p>
This lets your technician reconnect to your computer later without asking
again while the agent is running and connected to the internet.
</p>

<p>
Choosing Deny requires approval for each remote connection.
</p>

<div class="actions">
  <button id="allow">Allow</button>
  <button id="deny">Deny</button>
</div>

<div class="note">
Your choice is saved on this Windows machine.
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

  consentWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );

  consentWindow.on("closed", () => {
    consentWindow = null;
  });
}

// ── Setup window ──────────────────────────────────────────────────────────────
function showSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 480,
    height: 430,
    resizable: false,
    title: "Connect Support Agent Setup",
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
<title>Connect Support Agent Setup</title>

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

<h1>Connect Support Agent</h1>

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

code.addEventListener("input", () => {
  code.value = code.value.replace(/\D/g, "").slice(0, 6);
});

button.addEventListener("click", async () => {
  if (!/^\d{6}$/.test(code.value.trim())) {
    error.textContent = "Enter exactly 6 digits.";
    return;
  }

  button.disabled = true;

  const result =
    await window.electronBridge.configure(code.value);

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

  setupWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );

  setupWindow.on("closed", () => {
    setupWindow = null;
  });
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle("configure-agent", async (_event, supportCode) => {
  if (!/^\d{6}$/.test(String(supportCode).trim())) {
    return {
      ok: false,
      error: "Enter exactly 6 digits.",
    };
  }

  CONFIG = {
    ...CONFIG,
    supportCode: String(supportCode).trim(),
  };

  persistConfig();

  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
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

console.log("[Agent] Config:", CONFIG);

// ── Auto start ────────────────────────────────────────────────────────────────
function registerAutoStart() {
  if (process.platform !== "win32") return;

  try {
    const { exec } = require("child_process");

    const exePath = process.execPath;
    const args =
      `--hidden --code=${CONFIG.supportCode} ` +
      `--server=${CONFIG.serverUrl}`;

    const cmd =
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" ` +
      `/v "ConnectSupportAgent" ` +
      `/t REG_SZ ` +
      `/d "\\"${exePath}\\" ${args}" ` +
      `/f`;

    // IMPORTANT: async exec, so startup is NOT blocked
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        console.error(
          "[Agent] Failed to register auto-start:",
          err.message
        );
        return;
      }

      console.log("[Agent] Auto-start registered");
    });

  } catch (err) {
    console.error(
      "[Agent] Failed to register auto-start:",
      err.message
    );
  }
}

function unregisterAutoStart() {
  if (process.platform !== "win32") return;

  try {
    const { exec } = require("child_process");

    exec(
      `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" ` +
      `/v "ConnectSupportAgent" /f`,
      { windowsHide: true },
      () => {}
    );
  } catch {}
}

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
  activeSessionId = null;

  stopScreenStream();
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
  if (approvalWindow && !approvalWindow.isDestroyed()) {
    approvalWindow.focus();
    return;
  }

  approvalWindow = new BrowserWindow({
    width: 480,
    height: 340,
    resizable: false,
    alwaysOnTop: true,
    title: "Connect Support — Connection Request",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

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

<button
  onclick="document.title='APPROVED'"
>
Allow Access
</button>

<button
  onclick="document.title='REJECTED'"
>
Decline
</button>
</div>

</body>
</html>`;

  approvalWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );

  approvalWindow.webContents.on(
    "page-title-updated",
    (_event, title) => {
      if (!socket) return;

      if (title === "APPROVED") {
        socket.emit("client-approved-connection", {
          supportCode: CONFIG.supportCode,
          sessionId: data.sessionId,
        });

        if (!approvalWindow.isDestroyed()) {
          approvalWindow.close();
        }

      } else if (title === "REJECTED") {
        socket.emit("client-rejected-connection", {
          supportCode: CONFIG.supportCode,
          sessionId: data.sessionId,
        });

        if (!approvalWindow.isDestroyed()) {
          approvalWindow.close();
        }
      }
    }
  );

  approvalWindow.on("closed", () => {
    approvalWindow = null;
  });
}

// ── Screen streaming ──────────────────────────────────────────────────────────
async function startScreenStream() {
  stopScreenStream();

  console.log("[Client] Starting screen capture loop", {
    supportCode: CONFIG.supportCode,
    sessionId: activeSessionId,
    activeMonitor,
  });

  let screenshot;

  try {
    screenshot = require("screenshot-desktop");
  } catch (err) {
    console.error(
      "[Agent] screenshot-desktop not available:",
      err.message
    );
    return;
  }

  const displays = screen.getAllDisplays();
  const numMonitors = displays.length;
  let emittedFrames = 0;

  streamInterval = setInterval(async () => {
    if (
      !socket ||
      !socket.connected ||
      !sessionActive
    ) {
      return;
    }

    try {
      let imgBuffer;

      if (screenshot.listDisplays) {
        const screenList =
          await screenshot.listDisplays();

        if (!screenList.length) throw new Error("No displays returned by screenshot-desktop");

        const targetIdx = Math.min(
          activeMonitor,
          screenList.length - 1
        );

        imgBuffer = await screenshot({
          screen: screenList[targetIdx]?.id,
          format: "jpg",
        });

      } else {
        imgBuffer = await screenshot({
          format: "jpg",
        });
      }

      const frame = imgBuffer.toString("base64");
      if (!frame) throw new Error("Screenshot returned an empty frame");

      socket.emit("stream-frame", {
        supportCode: CONFIG.supportCode,
        sessionId: activeSessionId,
        frame,
        monitors: numMonitors,
        activeMonitor,
      });

      emittedFrames++;
      if (emittedFrames === 1 || emittedFrames % 50 === 0) {
        console.log("[Client] Frame captured/emitted", {
          count: emittedFrames,
          bytes: imgBuffer.length,
          sessionId: activeSessionId,
        });
      }

    } catch (err) {
      console.error("[Client] Screen capture failed:", err.message);
    }
  }, 100);
}

function stopScreenStream() {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
}

function startApprovedSession() {
  if (sessionActive) return;

  console.log("[Agent] Starting approved session");

  sessionActive = true;

  updateTrayMenu();

  startScreenStream();
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

  console.log(
    "[Agent] Connecting to:",
    CONFIG.serverUrl
  );

  socket = io(CONFIG.serverUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
  });

  socket.on("connect", () => {
    console.log(
      "[Agent] Socket connected:",
      socket.id
    );

    isConnected = true;

    updateTrayMenu();

    socket.emit("register-client", {
      supportCode: CONFIG.supportCode,
      computerName: os.hostname(),
      osInfo: `${os.type()} ${os.release()}`,
      unattendedAccess: CONFIG.unattendedAccess,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(
      "[Agent] Socket disconnected:",
      reason
    );

    isConnected = false;

    endSession();

    updateTrayMenu();
  });

  socket.on("connect_error", (err) => {
    console.error(
      "[Agent] Connection error:",
      err.message
    );

    isConnected = false;

    updateTrayMenu();
  });

  socket.on("approval-request", (data) => {
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

      return;
    }

    showApprovalWindow(data);
  });

  socket.on("connection-approved", ({ sessionId } = {}) => {
    console.log(
      "[Agent] Connection approved. Starting screen stream."
    );

    activeSessionId = sessionId || activeSessionId;
    startApprovedSession();
  });

  socket.on("tech-disconnected", ({ intentional } = {}) => {
    if (!intentional) {
      console.warn("[Agent] Ignoring unintentional/legacy tech disconnect event");
      return;
    }
    console.log("[Agent] Tech intentionally ended session");
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
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  // FIRST create tray
  // If tray fails, log the error instead of silently stopping startup.
  try {
    createTray();
    console.log("[Agent] Tray created");
  } catch (err) {
    console.error(
      "[Agent] Tray creation failed:",
      err.message
    );
  }

  // Register shortcut
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

  // START CONNECTION IMMEDIATELY
  if (!CONFIG.consentAsked) {
    console.log("[Agent] Showing consent window");
    showConsentWindow();

  } else if (CONFIG.supportCode) {
    console.log("[Agent] Starting socket connection");
    connectSocket();

  } else {
    console.log("[Agent] Showing setup window");
    showSetupWindow();
  }

  // Auto-start is deliberately delayed and async.
  // It must never block socket startup.
  setTimeout(() => {
    registerAutoStart();
  }, 1000);

  // Dev window
  if (IS_DEV) {
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
  globalShortcut.unregisterAll();

  stopScreenStream();

  closeAllPrivacyWindows();

  if (socket) {
    socket.disconnect();
  }
});