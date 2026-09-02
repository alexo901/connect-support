"use client";
import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col">
      {/* Nav */}
      <nav className="border-b border-[#30363d] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Connect Support" width={36} height={36} />
          <span className="text-xl font-bold text-white">Connect Support</span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/get-support"
            className="text-sm text-[#8b949e] hover:text-white transition-colors"
          >
            Get Support
          </Link>
          <Link
            href="/login"
            className="text-sm px-4 py-2 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium transition-colors"
          >
            Technician Login
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="max-w-3xl w-full text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1f2937] border border-[#374151] text-sm text-[#60a5fa] mb-8">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse-dot inline-block"></span>
            Personal Remote Support — Private & Secure
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
            Remote support for
            <span className="text-[#3b82f6]"> friends & family</span>
          </h1>

          <p className="text-lg text-[#8b949e] mb-10 max-w-xl mx-auto">
            Simple, fast, and private remote assistance. No subscriptions, no corporate bloat.
            Just you helping the people you care about.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/get-support"
              className="px-8 py-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold text-lg transition-all shadow-lg shadow-blue-500/20"
            >
              Get Support Now
            </Link>
            <Link
              href="/login"
              className="px-8 py-4 rounded-xl bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] text-white font-semibold text-lg transition-all"
            >
              Technician Dashboard →
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-20 max-w-4xl w-full grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: "🖥️",
              title: "Full Remote Desktop",
              desc: "Real-time screen viewing and mouse/keyboard control.",
            },
            {
              icon: "🔒",
              title: "Privacy First",
              desc: "Screen curtain mode and input lock to protect privacy during maintenance.",
            },
            {
              icon: "⚡",
              title: "One 6-Digit Code",
              desc: "Your friend enters a code, downloads a tiny agent, and you're connected.",
            },
            {
              icon: "💬",
              title: "Live Chat",
              desc: "Communicate in real-time during the support session.",
            },
            {
              icon: "📁",
              title: "File Transfer",
              desc: "Send and receive files securely during the session.",
            },
            {
              icon: "🛡️",
              title: "Emergency Exit",
              desc: "Ctrl+Alt+Esc instantly terminates the session — always in control.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-xl bg-[#161b22] border border-[#30363d] hover:border-[#2563eb] transition-colors"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-white mb-1">{f.title}</h3>
              <p className="text-sm text-[#8b949e]">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-[#30363d] px-6 py-6 text-center text-sm text-[#8b949e]">
        Connect Support · Personal Use Only · Not for commercial distribution
      </footer>
    </div>
  );
}
