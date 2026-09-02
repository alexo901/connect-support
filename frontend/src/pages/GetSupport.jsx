import React from "react";
import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "";

export default function GetSupport() {
  const navigate = useNavigate();
  const [digits, setDigits] = useState(Array(6).fill(""));
  const [step, setStep] = useState("enter-code"); // enter-code | verified | error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadInfo, setDownloadInfo] = useState(null);
  const inputRefs = useRef([]);

  const code = digits.join("");

  function handleDigit(i, val) {
    if (!/^\d*$/.test(val)) return;
    const next = [...digits];
    next[i] = val.slice(-1);
    setDigits(next);
    if (val && i < 5) inputRefs.current[i + 1]?.focus();
  }

  function handleKeyDown(i, e) {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputRefs.current[i - 1]?.focus();
  }

  function handlePaste(e) {
    const p = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (p.length === 6) { setDigits(p.split("")); inputRefs.current[5]?.focus(); }
  }

  async function verify() {
    if (code.length !== 6) { setError("Please enter all 6 digits."); return; }
    setLoading(true); setError("");
    try {
      const r1 = await fetch(`${API}/api/support/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!r1.ok) {
        const d = await r1.json();
        setError(d.error || "Invalid code. Check with your technician.");
        setStep("error"); setLoading(false); return;
      }
      const r2 = await fetch(`${API}/api/download?code=${code}`);
      if (r2.ok) setDownloadInfo(await r2.json());
      setStep("verified");
    } catch { setError("Network error. Try again."); }
    finally { setLoading(false); }
  }

  function reset() {
    setDigits(Array(6).fill("")); setStep("enter-code");
    setError(""); setDownloadInfo(null);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col">
      <nav className="border-b border-[#30363d] px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <span className="text-xl">🛡️</span>
          <span className="text-lg font-bold text-white">Connect Support</span>
        </Link>
        <Link to="/login" className="text-sm text-[#8b949e] hover:text-white">Technician Login</Link>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">

          {step === "enter-code" && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8">
              <div className="text-center mb-8">
                <div className="text-5xl mb-4">🔑</div>
                <h1 className="text-2xl font-bold text-white">Get Remote Support</h1>
                <p className="text-[#8b949e] mt-2 text-sm">Enter the 6-digit code your technician gave you</p>
              </div>

              <div className="flex gap-3 justify-center mb-6" onPaste={handlePaste}>
                {digits.map((d, i) => (
                  <input key={i} ref={el => inputRefs.current[i] = el}
                    type="text" inputMode="numeric" maxLength={1} value={d}
                    onChange={e => handleDigit(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className="w-12 h-14 text-center text-2xl font-bold rounded-xl bg-[#0d1117] border-2 border-[#30363d] text-white focus:border-[#2563eb] focus:outline-none"
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">{error}</div>}

              <button onClick={verify} disabled={loading || code.length !== 6}
                className="w-full py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white font-semibold transition-all">
                {loading ? "Verifying…" : "Verify Code & Get Support →"}
              </button>
              <p className="text-center text-xs text-[#8b949e] mt-4">Your technician provides the 6-digit code</p>
            </div>
          )}

          {step === "verified" && downloadInfo && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8">
              <div className="text-center mb-6">
                <div className="text-5xl mb-4">✅</div>
                <h1 className="text-2xl font-bold text-white">Code Verified!</h1>
                <p className="text-[#8b949e] mt-2 text-sm">
                  Code <span className="font-mono font-bold text-[#3b82f6]">{code}</span> is valid.
                </p>
              </div>

              <div className="mb-6 space-y-3">
                {downloadInfo.instructions?.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm text-[#8b949e]">
                    <span className="w-5 h-5 rounded-full bg-[#2563eb] text-white text-xs flex items-center justify-center flex-shrink-0">{i+1}</span>
                    <span>{s.replace(/^\d+\.\s*/, "")}</span>
                  </div>
                ))}
              </div>

              <a href={`${API}${downloadInfo.downloadUrl}`} download={downloadInfo.fileName}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold transition-all shadow-lg shadow-blue-500/20 mb-4">
                ⬇️ Download Connect Support Agent
              </a>

              <div className="p-4 rounded-xl bg-[#0d1117] border border-[#30363d] mb-4">
                <p className="text-xs text-[#8b949e] text-center leading-relaxed">
                  <strong className="text-yellow-400">🔒 Privacy:</strong> The agent runs silently.
                  Remove anytime from Windows Settings → Apps.
                </p>
              </div>
              <button onClick={reset} className="w-full py-2 rounded-lg text-sm text-[#8b949e] hover:text-white border border-[#30363d] transition-colors">
                ← Enter a different code
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 text-center">
              <div className="text-5xl mb-4">❌</div>
              <h2 className="text-xl font-bold text-white mb-2">Code Not Found</h2>
              <p className="text-[#8b949e] text-sm mb-6">{error}</p>
              <button onClick={reset} className="px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium transition-colors">
                Try Again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
