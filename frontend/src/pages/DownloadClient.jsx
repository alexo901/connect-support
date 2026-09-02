import React from "react";
import { Link, useSearchParams } from "react-router-dom";

export default function DownloadClient() {
  const [params] = useSearchParams();
  const code = params.get("code") || "";
  const API = import.meta.env.VITE_API_URL || "";

  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col">
      <nav className="border-b border-[#30363d] px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <span className="text-xl">🛡️</span>
          <span className="text-lg font-bold text-white">Connect Support</span>
        </Link>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-10">
            <div className="text-6xl mb-4">💻</div>
            <h1 className="text-3xl font-bold text-white mb-3">Download Connect Support Agent</h1>
            <p className="text-[#8b949e]">Windows 10 / 11 — Silent background agent</p>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">What gets installed</h2>
            <ul className="space-y-3 text-sm text-[#8b949e]">
              {[
                "A lightweight background service (~15 MB installed)",
                "No desktop shortcut, no Start Menu entry, no visible window",
                "Appears only in the System Tray (bottom-right corner)",
                "Runs automatically after Windows restarts",
                "Connects only to your technician using the 6-digit code",
                "Remove anytime: Windows Settings → Apps → Connect Support Agent",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-[#2563eb] mt-0.5">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Installation steps</h2>
            <ol className="space-y-4">
              {[
                { step: "1", title: "Download the installer", desc: "Click the download button below. It's a small stub installer (~500 KB)." },
                { step: "2", title: "Run the installer", desc: "Double-click the downloaded file. No UAC prompts — installs for current user only." },
                { step: "3", title: "Wait for connection", desc: "The agent starts silently. A small icon appears in your system tray (⬇ bottom-right)." },
                { step: "4", title: "Approve the connection", desc: "When your technician connects, a popup asks you to Allow or Decline." },
                { step: "5", title: "Get support", desc: "Your technician can now help you. Press Ctrl+Alt+Esc at any time to end the session." },
              ].map((item) => (
                <li key={item.step} className="flex gap-4">
                  <span className="w-8 h-8 rounded-full bg-[#2563eb] text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {item.step}
                  </span>
                  <div>
                    <div className="font-medium text-white">{item.title}</div>
                    <div className="text-sm text-[#8b949e] mt-0.5">{item.desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {code && (
            <a
              href={`${API}/api/download/stub?code=${code}`}
              download={`ConnectSupport-Setup-${code}.ps1`}
              className="flex items-center justify-center gap-3 w-full py-5 rounded-2xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-lg transition-all shadow-lg shadow-blue-500/20 mb-4"
            >
              ⬇️ Download Connect Support Agent
              <span className="text-sm opacity-75">for code {code}</span>
            </a>
          )}

          {!code && (
            <div className="text-center">
              <p className="text-[#8b949e] mb-4">Go to Get Support to enter your code first.</p>
              <Link to="/get-support" className="px-6 py-3 rounded-xl bg-[#2563eb] text-white font-medium hover:bg-[#1d4ed8] transition-colors">
                ← Enter Support Code
              </Link>
            </div>
          )}

          <div className="p-4 rounded-xl bg-[#0d1117] border border-[#30363d] text-center">
            <p className="text-xs text-[#8b949e] leading-relaxed">
              🔒 The agent connects only to your trusted technician using your unique code.
              It does <strong>not</strong> upload your data or allow any unauthorized access.
              Emergency exit: <strong className="text-white font-mono">Ctrl+Alt+Esc</strong>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
