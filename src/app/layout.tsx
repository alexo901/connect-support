import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Connect Support",
  description: "Personal remote support application for friends and family.",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#0d1117] text-[#e6edf3]">{children}</body>
    </html>
  );
}
