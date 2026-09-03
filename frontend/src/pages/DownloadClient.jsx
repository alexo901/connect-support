import React from "react";
import { Link, useSearchParams } from "react-router-dom";

export default function DownloadClient() {
  const [params] = useSearchParams();
  const code = params.get("code") || "";

  // Small NSIS Web installer hosted on GitHub Release.
  // The installer downloads the remaining application package during installation.
  const downloadUrl = code
    ? "https://github.com/alexo901/connect-support/releases/download/v1.0.0/Connect%20Support%20Web%20Setup%201.0.0.exe"
    : "";

  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col">
      {/* NAVBAR */}
      <nav className="border-b border-[#30363d] px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <span className="text-xl">🛡️</span>

          <span className="text-lg font-bold text-white">
            Connect Support
          </span>
        </Link>

        <Link
          to="/get-support"
          className="text-sm text-[#8b949e] hover:text-white transition-colors"
        >
          Get Support
        </Link>
      </nav>

      {/* MAIN */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full">

          {/* HEADER */}
          <div className="text-center mb-10">
            <div className="text-6xl mb-4">💻</div>

            <h1 className="text-3xl font-bold text-white mb-3">
              Download Connect Support Agent
            </h1>

            <p className="text-[#8b949e]">
              Windows 10 / 11 — Secure remote support agent
            </p>
          </div>

          {/* WHAT HAPPENS NEXT */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              What happens next
            </h2>

            <ul className="space-y-3 text-sm text-[#8b949e]">
              {[
                "You download a small Connect Support installer first.",
                "When you run it, the remaining application files download automatically.",
                "The installer connects using the support code provided by your technician.",
                "No desktop shortcut is required for the support session.",
                "You can remove Connect Support later from Windows Settings → Apps.",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-[#2563eb] mt-0.5">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* INSTALLATION STEPS */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Installation steps
            </h2>

            <ol className="space-y-4">
              {[
                {
                  step: "1",
                  title: "Download the installer",
                  desc: "Click the download button below to download the small Connect Support setup file.",
                },
                {
                  step: "2",
                  title: "Run the installer",
                  desc: "Double-click the downloaded Connect Support Setup file.",
                },
                {
                  step: "3",
                  title: "Application files download",
                  desc: "The installer automatically downloads the remaining application files needed for installation.",
                },
                {
                  step: "4",
                  title: "Connect securely",
                  desc: "After installation, the Connect Support Agent starts and uses your unique support code.",
                },
                {
                  step: "5",
                  title: "Get support",
                  desc: "Your technician can then start the remote support session when you approve the connection.",
                },
              ].map((item) => (
                <li key={item.step} className="flex gap-4">
                  <span className="w-8 h-8 rounded-full bg-[#2563eb] text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {item.step}
                  </span>

                  <div>
                    <div className="font-medium text-white">
                      {item.title}
                    </div>

                    <div className="text-sm text-[#8b949e] mt-0.5">
                      {item.desc}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* DOWNLOAD SECTION */}
          {code ? (
            <>
              <div className="bg-[#161b22] border border-[#2563eb]/40 rounded-2xl p-6 mb-4 text-center">
                <p className="text-sm text-[#8b949e] mb-2">
                  Your support code
                </p>

                <div className="text-2xl font-bold tracking-[0.3em] text-white mb-5">
                  {code}
                </div>

                <a
                  href={downloadUrl}
                  className="flex flex-col sm:flex-row items-center justify-center gap-2 w-full py-5 rounded-2xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-lg transition-all shadow-lg shadow-blue-500/20"
                >
                  <span>⬇️ Download Connect Support Setup</span>

                  <span className="text-xs sm:text-sm font-normal opacity-75">
                    Windows 10 / 11
                  </span>
                </a>
              </div>

              <p className="text-center text-xs text-[#8b949e]">
                Only run the installer if this support code was provided by your
                trusted technician.
              </p>
            </>
          ) : (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 text-center">
              <p className="text-[#8b949e] mb-5">
                Go to Get Support and enter the 6-digit code from your
                technician first.
              </p>

              <Link
                to="/get-support"
                className="inline-flex px-6 py-3 rounded-xl bg-[#2563eb] text-white font-medium hover:bg-[#1d4ed8] transition-colors"
              >
                ← Enter Support Code
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}