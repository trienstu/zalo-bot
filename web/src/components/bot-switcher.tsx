"use client";

import React, { useState, useEffect } from "react";

export function BotSwitcher() {
  const [isBot2, setIsBot2] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsBot2(window.location.port === "3001");
    }
  }, []);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
      <div className={`flex h-6 w-6 items-center justify-center rounded-lg text-sm ${
        isBot2 ? "bg-pink-600/30 border border-pink-500/40 text-pink-300" : "bg-cyan-600/30 border border-cyan-500/40 text-cyan-300"
      }`}>
        {isBot2 ? "🌸" : "🤖"}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-slate-100">
          {isBot2 ? "Mộc Miên (Bot 2)" : "Sen Chúa (Bot 1)"}
        </span>
        <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      </div>
    </div>
  );
}
