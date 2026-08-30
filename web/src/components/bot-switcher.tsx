"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, usePathname } from "next/navigation";

export function BotSwitcher() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeBot, setActiveBot] = useState("bot-1");

  useEffect(() => {
    const urlBot = searchParams?.get("botId");
    if (urlBot === "bot-2" || urlBot === "bot-1") {
      setActiveBot(urlBot);
      document.cookie = `active_bot_id=${urlBot}; path=/; max-age=31536000; SameSite=Lax`;
    } else {
      const match = document.cookie.match(/(^| )active_bot_id=([^;]+)/);
      const cookieBot = match ? decodeURIComponent(match[2]) : "bot-1";
      setActiveBot(cookieBot);
    }
  }, [searchParams]);

  function switchBot(bId: string) {
    document.cookie = `active_bot_id=${bId}; path=/; max-age=31536000; SameSite=Lax`;
    setActiveBot(bId);
    window.location.href = `${pathname}?botId=${bId}`;
  }

  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800 shadow-inner">
      <button
        type="button"
        onClick={() => switchBot("bot-1")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          activeBot === "bot-1"
            ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
            : "text-slate-400 hover:text-white hover:bg-slate-800/80"
        }`}
      >
        <span>🤖 Sen Chúa</span>
      </button>

      <button
        type="button"
        onClick={() => switchBot("bot-2")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
          activeBot === "bot-2"
            ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/20"
            : "text-slate-400 hover:text-white hover:bg-slate-800/80"
        }`}
      >
        <span>🌸 Mộc Miên</span>
      </button>
    </div>
  );
}
