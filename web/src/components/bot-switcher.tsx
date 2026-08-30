"use client";

import React, { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";

export function BotSwitcher() {
  const [isBot2, setIsBot2] = useState(false);
  const [hostname, setHostname] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsBot2(window.location.port === "3001");
      setHostname(window.location.hostname);
    }
  }, []);

  const bot1Url = `http://${hostname || "34.42.52.96"}/`;
  const bot2Url = `http://${hostname || "34.42.52.96"}:3001/`;

  return (
    <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-slate-900/80 border border-slate-800">
      <div className="flex items-center gap-2 min-w-0 px-1 py-0.5">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-base shadow-sm shrink-0 ${
          isBot2 ? "bg-gradient-to-tr from-pink-600 to-rose-400 text-white" : "bg-gradient-to-tr from-cyan-600 to-blue-500 text-white"
        }`}>
          {isBot2 ? "🌸" : "🤖"}
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-100 truncate">
              {isBot2 ? "Mộc Miên (Bot 2)" : "Sen Chúa (Bot 1)"}
            </span>
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {isBot2 ? "Dashboard :3001" : "Dashboard :3000"}
          </span>
        </div>
      </div>

      <a
        href={isBot2 ? bot1Url : bot2Url}
        title={isBot2 ? "Mở Dashboard Bot 1 (Sen Chúa)" : "Mở Dashboard Bot 2 (Mộc Miên)"}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-cyan-950/80 hover:text-cyan-300 text-slate-300 transition-all border border-slate-700/60 shrink-0"
      >
        <span>{isBot2 ? "🤖 Bot 1" : "🌸 Bot 2"}</span>
        <ExternalLink className="h-3 w-3 opacity-70" />
      </a>
    </div>
  );
}
