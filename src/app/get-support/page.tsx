"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";

type DownloadInfo = {
  code: string;
  fileName: string;
  downloadUrl: string;
  instructions: string[];
};

export default function GetSupportPage() {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [step, setStep] = useState<"enter-code" | "verified" | "error">("enter-code");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  function handleDigit(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  }

  async function handleVerify() {
    if (code.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      // First verify the code exists
      const verifyRes = await fetch("/api/support/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        setError(data.error || "Invalid support code. Please check with your technician.");
        setStep("error");
        setLoading(false);
        return;
      }

      // Get download info
      const dlRes = await fetch(`/api/download?code=${code}`);
      if (dlRes.ok) {
        const dlData = await dlRes.json();
        setDownloadInfo(dlData);
      }

      setStep("verified");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setDigits(Array(6).fill(""));
    setStep("enter-code");
    setError("");
    setDownloadInfo(null);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col">
      {/* Nav */}
      <nav className="border-b border-[#30363d] px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.png" alt="Connect Support" width={32} height={32} />
          <span className="text-lg font-bold text-white">Connect Support</span>
        </Link>
        <Link href="/login" className="text-sm text-[#8b949e] hover:text-white transition-colors">
          Technician Login
        </Link>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md animate-fade-in">

          {/* STEP 1: Enter Code */}
          {step === "enter-code" && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-2xl bg-[#1f2937] flex items-center justify-center text-3xl mx-auto mb-4">
                  🔑
                </div>
                <h1 className="text-2xl font-bold text-white">Get Remote Support</h1>
                <p className="text-[#8b949e] mt-2 text-sm">
                  Enter the 6-digit code your technician gave you
                </p>
              </div>

              {/* 6-digit input */}
              <div className="flex gap-3 justify-center mb-6" onPaste={handlePaste}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-12 h-14 text-center text-2xl font-bold rounded-xl bg-[#0d1117] border-2 border-[#30363d] text-white focus:border-[#2563eb] focus:outline-none transition-colors"
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
                  {error}
                </div>
              )}

              <button
                onClick={handleVerify}
                disabled={loading || code.length !== 6}
                className="w-full py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base transition-all"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Verifying…
                  </span>
                ) : (
                  "Verify Code & Get Support →"
                )}
              </button>

              <p className="text-center text-xs text-[#8b949e] mt-4">
                Your technician will give you a 6-digit code to start the session
              </p>
            </div>
          )}

          {/* STEP 2: Code Verified — Show Download */}
          {step === "verified" && downloadInfo && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 animate-fade-in">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center text-3xl mx-auto mb-4 border border-green-500/20">
                  ✅
                </div>
                <h1 className="text-2xl font-bold text-white">Code Verified!</h1>
                <p className="text-[#8b949e] mt-2 text-sm">
                  Your support code{" "}
                  <span className="font-mono font-bold text-[#3b82f6]">{code}</span> is valid.
                </p>
              </div>

              {/* Instructions */}
              <div className="mb-6 space-y-2">
                {downloadInfo.instructions.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm text-[#8b949e]">
                    <span className="w-5 h-5 rounded-full bg-[#2563eb] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step.replace(/^\d+\.\s*/, "")}</span>
                  </div>
                ))}
              </div>

              {/* Download Button */}
              <a
                href={downloadInfo.downloadUrl}
                download={downloadInfo.fileName}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold text-base transition-all shadow-lg shadow-blue-500/20 mb-4"
              >
                <span className="text-xl">⬇️</span>
                Download Connect Support Agent
                <span className="text-xs opacity-70 ml-1">({downloadInfo.fileName})</span>
              </a>

              <div className="p-4 rounded-xl bg-[#0d1117] border border-[#30363d] mb-4">
                <p className="text-xs text-[#8b949e] text-center leading-relaxed">
                  <strong className="text-yellow-400">🔒 Privacy Notice:</strong> The agent runs
                  silently in the background. It connects only to your technician and can be
                  removed anytime from Windows Settings → Apps.
                </p>
              </div>

              <button
                onClick={handleReset}
                className="w-full py-2 rounded-lg text-sm text-[#8b949e] hover:text-white border border-[#30363d] hover:border-[#484f58] transition-colors"
              >
                ← Enter a different code
              </button>
            </div>
          )}

          {/* STEP: Error */}
          {step === "error" && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 text-center animate-fade-in">
              <div className="text-5xl mb-4">❌</div>
              <h2 className="text-xl font-bold text-white mb-2">Code Not Found</h2>
              <p className="text-[#8b949e] text-sm mb-6">
                {error || "The support code you entered is invalid. Please double-check with your technician."}
              </p>
              <button
                onClick={handleReset}
                className="px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
