import React from "react";
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); setLoading(false); return; }
      localStorage.setItem("cs_token", data.token);
      localStorage.setItem("cs_username", data.username);
      navigate("/dashboard");
    } catch { setError("Network error. Try again."); setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🛡️</div>
          <h1 className="text-2xl font-bold text-white">Connect Support</h1>
          <p className="text-[#8b949e] text-sm mt-1">Technician Login</p>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#8b949e] mb-2">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required autoFocus
                className="w-full px-4 py-3 rounded-xl bg-[#0d1117] border border-[#30363d] text-white placeholder-[#484f58] focus:border-[#2563eb] focus:outline-none text-sm"
                placeholder="admin" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#8b949e] mb-2">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-4 py-3 rounded-xl bg-[#0d1117] border border-[#30363d] text-white placeholder-[#484f58] focus:border-[#2563eb] focus:outline-none text-sm"
                placeholder="••••••••" />
            </div>
            {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white font-semibold transition-all">
              {loading ? "Signing in…" : "Sign In to Dashboard"}
            </button>
          </form>

          <div className="mt-6 p-3 rounded-lg bg-[#0d1117] border border-[#30363d]">
            <p className="text-xs text-[#8b949e] text-center">
              Default: <code className="text-[#3b82f6]">admin</code> / <code className="text-[#3b82f6]">admin123</code>
              <br/><span className="text-yellow-500">Change immediately after first login.</span>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[#8b949e] mt-6">
          Need support? <Link to="/get-support" className="text-[#3b82f6] hover:underline">Enter your code →</Link>
        </p>
      </div>
    </div>
  );
}
