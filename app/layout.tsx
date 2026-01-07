import React from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <nav className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <div className="w-3 h-3 bg-neon-400 rounded-full shadow-[0_0_10px_#4ade80]" />
            NEON<span className="text-slate-500">PREDICT</span>
          </a>
          <div className="flex gap-6 text-sm font-medium">
            <a href="/" className="hover:text-neon-400 transition-colors">Calculator</a>
            <a href="/admin" className="hover:text-neon-400 transition-colors">Admin</a>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto p-6">
        {children}
      </main>
    </>
  );
}