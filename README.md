# 🛡️ Connect Support

**Personal remote support application for friends and family.**

No billing, no multi-tenancy, no corporate SaaS complexity — just you helping the people you care about.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CONNECT SUPPORT                         │
├──────────────────┬──────────────────┬───────────────────────────┤
│  Next.js App     │  Windows Client  │  Standalone Frontend       │
│  (This repo)     │  (Electron)      │  (React + Vite)           │
│  Netlify / Azure │  GitHub Releases │  Netlify                  │
└──────────────────┴──────────────────┴───────────────────────────┘
         │                  │                      │
         └──────────────────┴──────────────────────┘
                            │
                   Socket.io Signaling
                   PostgreSQL / Supabase
```

## 📁 Repository Structure

```
connect-support/
├── database/
│   └── schema.sql              ← Supabase migration SQL
│
├── backend/                    ← Standalone Express+Socket.io backend
│   ├── package.json            ← Deploy to Azure App Service
│   └── src/server.js
│
├── windows-client/             ← Electron Windows Agent
│   ├── package.json            ← Electron Forge + Squirrel
│   └── src/
│       ├── main.js             ← Full agent implementation
│       └── preload.js          ← Secure renderer bridge
│
├── frontend/                   ← Standalone React+Vite frontend
│   ├── package.json
│   ├── tailwind.config.js
│   └── src/
│       ├── App.jsx
│       ├── index.css
│       └── pages/
│           ├── Home.jsx
│           ├── GetSupport.jsx
│           ├── DownloadClient.jsx
│           ├── Login.jsx
│           └── Dashboard.jsx
│
├── src/                        ← Next.js app (this platform)
│   ├── app/
│   │   ├── page.tsx            ← Home
│   │   ├── login/page.tsx      ← Technician login
│   │   ├── get-support/page.tsx ← Client code entry + download
│   │   ├── dashboard/page.tsx  ← Full technician dashboard
│   │   └── api/
│   │       ├── auth/login/     ← JWT authentication
│   │       ├── devices/        ← Device CRUD
│   │       ├── sessions/       ← Session management
│   │       ├── support/verify/ ← Code verification
│   │       └── download/       ← Installer stub generation
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts
│   └── lib/
│       ├── auth.ts             ← JWT + bcrypt utilities
│       └── socket-server.ts    ← Socket.io singleton
│
├── server.ts                   ← Custom Next.js + Socket.io server
└── database/schema.sql         ← Complete Supabase SQL
```

---

## 🚀 Quick Start

### 1. Environment Variables

```bash
# .env
DATABASE_URL=postgresql://...
JWT_SECRET=your-super-secret-key-change-this
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
NEXT_PUBLIC_SOCKET_URL=https://your-app.azurewebsites.net
```

### 2. Database Setup

**Option A: Supabase**
1. Create a Supabase project
2. Open SQL Editor
3. Paste contents of `database/schema.sql`
4. Execute

**Option B: Local PostgreSQL**
```bash
npx drizzle-kit push
```

### 3. Run the Next.js App

```bash
npm install
npm run dev    # Development
npm run build  # Production build
npm run start  # Production server
```

---

## 🔐 Authentication

**Default credentials** (change immediately):
- Username: `admin`
- Password: `admin123`

The system uses JWT tokens (12-hour expiry) with bcrypt password hashing.

---

## 👥 User Workflow

### Technician Side
1. Log in at `/login`
2. Click **"+ Generate Code"** → Gets a unique 6-digit code (e.g., `413421`)
3. Share the code with your friend/family member verbally or via text
4. When the client comes online, a **popup notification** appears immediately
5. Click **"Connect Now"** → Send connection request
6. When client approves → Full remote session opens

### Client Side
1. Go to `/get-support`
2. Enter the 6-digit code given by technician
3. Click **"Verify Code & Get Support"** → Download button appears
4. Download and run the installer
5. Agent starts silently → System tray icon appears
6. A popup asks: **"Allow Access"** or **"Decline"**
7. Click Allow → Session begins

---

## 🖥️ Dashboard Features

### Session Controls (Top Bar)
| Control | Description |
|---------|-------------|
| 👁️ Blank Screen | Covers client monitors with privacy curtain |
| 🎨 Media Picker | Switch curtain: Deep Blue / Matrix / Maintenance Anim / Video |
| 🔒 Lock Inputs | Disables client keyboard/mouse/touch |
| M1, M2, M3... | Switch between client monitors |
| FPS Counter | Real-time stream performance |
| ✕ End Session | Gracefully terminates the remote session |

### Left Panel
- Generate support codes
- Device list with online/waiting/offline status
- One-click Connect for waiting devices
- Session history

### Center Panel (Canvas)
- Real-time screen rendering at 10 FPS
- Mouse move/click/right-click relay
- Keyboard input relay
- Status overlays (curtain active, inputs locked)

### Right Panel
- **Live Chat** — bidirectional text messaging
- **Push Clipboard** — send technician clipboard to client
- **Send File** — chunked file transfer with progress bar
- **Session Notes** — persistent notes saved to database

---

## 🔒 Privacy & Safety Features

### Privacy Curtain (Blank Screen Mode)
- Spawns full-screen, always-on-top windows on **all client monitors**
- Three built-in themes:
  - **Default Deep Blue** — Radial gradient with pulsing overlay
  - **Matrix Loop** — Live canvas-rendered matrix rain effect
  - **Maintenance Animation** — Gradient shift animation
  - **Custom Video** — Loops `maintenance.mp4` if present
- Shows: *"Your technician is currently performing maintenance. Your screen is temporarily hidden for privacy."*

### Input Lock
- Prevents client from using keyboard, mouse, or touch
- Shows a red banner: *"🔒 Local Inputs Temporarily Paused"*
- Tech can toggle on/off from dashboard

### Emergency Exit
**The client can ALWAYS press `Ctrl+Alt+Escape`** to:
1. Immediately terminate the agent
2. Close all privacy curtain windows
3. Restore full keyboard and mouse control
4. Prevent auto-restart (removes from registry)

---

## 💻 Windows Client Agent

### Features
- **Invisible** — No taskbar entry, no Start Menu shortcut, no Desktop icon
- **System Tray** — Small icon with connectivity status
- **Auto-start** — Added to Windows Registry Run key automatically
- **Auto-reconnect** — Reconnects after network drops or system reboots
- **Single instance** — Prevents duplicate agents

### Installation (Production)
The stub installer pattern works as follows:
1. User gets `ConnectSupport-Setup-XXXXXX.ps1` (tiny ~2KB)
2. Script downloads the full Electron agent from GitHub Releases
3. Extracts to `%LOCALAPPDATA%\ConnectSupport\`
4. Writes `config.json` with support code + server URL
5. Adds Registry Run key for auto-start
6. Launches agent silently (`--hidden` flag)

### Building the Windows Client
```bash
cd windows-client
npm install
npm run package    # Package for current platform
npm run make       # Create installer (Squirrel.Windows)
npm run publish    # Publish to GitHub Releases
```

**Important:** Set your GitHub repo in `package.json` forge config before publishing.

### Electron Forge Squirrel Config (no visible install prompts)
```json
{
  "createDesktopShortcut": false,
  "createStartMenuShortcut": false,
  "noMsi": true
}
```

---

## 🌐 Deployment Guide

### Option A: This Next.js App (Recommended for simplicity)

**Deploy to Netlify:**
```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "18"
```

**Deploy to Azure App Service:**
```yaml
# .github/workflows/azure.yml
- name: Deploy to Azure
  uses: azure/webapps-deploy@v2
  with:
    app-name: connect-support
    publish-profile: ${{ secrets.AZURE_PUBLISH_PROFILE }}
```

### Option B: Separate Backend + Frontend

**Backend → Azure App Service:**
```bash
cd backend
npm install --production
# Set env vars: JWT_SECRET, ADMIN_USER, ADMIN_PASS, SUPABASE_URL, SUPABASE_SERVICE_KEY
npm start
```

**Frontend → Netlify:**
```bash
cd frontend
echo "VITE_API_URL=https://your-backend.azurewebsites.net" > .env
echo "VITE_SOCKET_URL=https://your-backend.azurewebsites.net" >> .env
npm install
npm run build
# Deploy 'dist' folder to Netlify
```

---

## 🔌 Socket.io Event Reference

| Event | Direction | Description |
|-------|-----------|-------------|
| `register-client` | Client → Server | Agent registers with support code |
| `tech-connect-request` | Tech → Server | Technician initiates connection |
| `approval-request` | Server → Client | Server asks client to approve |
| `client-approved-connection` | Client → Server | Client approves |
| `client-rejected-connection` | Client → Server | Client declines |
| `connection-approved` | Server → Tech | Tech notified of approval |
| `stream-frame` | Client → Server → Tech | Base64 JPEG screen frame (10 FPS) |
| `mouse-event` | Tech → Server → Client | Mouse move/click/scroll |
| `keyboard-event` | Tech → Server → Client | Keydown/keyup events |
| `chat-message` | Both → Server → Both | Live chat messages |
| `file-chunk` | Both → Server → Both | Chunked file transfer (64KB chunks) |
| `clipboard-sync` | Both → Server → Both | Clipboard content sharing |
| `toggle-blank-screen` | Tech → Server → Client | Enable/disable privacy curtain |
| `change-privacy-media` | Tech → Server → Client | Switch curtain style |
| `toggle-input-lock` | Tech → Server → Client | Enable/disable input lock |
| `switch-monitor` | Tech → Server → Client | Switch active monitor |
| `client-status-update` | Server → All | Device online/waiting/offline status |
| `tech-disconnected` | Server → Client | Tech left the session |

---

## 🗄️ Database Schema

```sql
technicians   -- id, username, password_hash, created_at
devices       -- id, computer_name, support_code (6-digit), status, last_seen, os_info
sessions      -- id, device_id, started_at, ended_at, notes
logs          -- id, device_id, action, metadata, created_at
chat_messages -- id, session_id, sender, message, created_at
```

---

## 🛡️ Security Notes

1. **Change default credentials** immediately after deployment
2. **JWT_SECRET** must be a long random string (32+ chars)
3. **Supabase RLS** — service role key is server-only, never expose to client
4. The agent **only connects to your server** — no third-party relay servers
5. All signaling is end-to-end through your controlled infrastructure
6. Client can **always disconnect** using the emergency shortcut

---

## 📋 Tech Stack

| Layer | Technology |
|-------|-----------|
| Web App | Next.js 16 (App Router) |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL / Supabase via Drizzle ORM |
| Real-time | Socket.io 4 |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Windows Client | Electron 29 + Electron Forge |
| Screen Capture | screenshot-desktop |
| Input Control | @nut-tree/nut-js |
| Deploy (Web) | Netlify / Azure App Service |
| Deploy (Agent) | GitHub Releases (Squirrel.Windows) |

---

*Connect Support — Personal use only. Not for commercial distribution.*
