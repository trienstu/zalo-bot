"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bot, Plus, Check, ChevronDown, Sparkles, RefreshCw, X, ShieldCheck } from "lucide-react";

export interface BotItem {
  id: string;
  name: string;
  avatarUrl?: string;
  zaloName?: string;
  zaloId?: string;
  isOnline: boolean;
  groupCount?: number;
  memberCount?: number;
}

export function BotSwitcher() {
  const [bots, setBots] = useState<BotItem[]>([]);
  const [activeBotId, setActiveBotId] = useState<string>("bot-1");
  const [openDropdown, setOpenDropdown] = useState(false);
  const [openAddModal, setOpenAddModal] = useState(false);
  const [newBotName, setNewBotName] = useState("");
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Đọc cookie active_bot_id
  function getCookie(name: string): string {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2] || "") : "bot-1";
  }

  function setBotCookie(bId: string) {
    document.cookie = `active_bot_id=${encodeURIComponent(bId)}; path=/; max-age=31536000; SameSite=Lax`;
  }

  async function loadBots() {
    try {
      const res = await fetch("/api/bots");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.bots)) {
          setBots(data.bots);
        }
        const currentCookie = getCookie("active_bot_id");
        setActiveBotId(currentCookie || data.activeBotId || "bot-1");
      }
    } catch {}
  }

  useEffect(() => {
    loadBots();

    // Click outside to close dropdown
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeBot = bots.find((b) => b.id === activeBotId) || bots[0] || {
    id: "bot-1",
    name: "Bot 1 (Sen Chúa)",
    isOnline: false,
  };

  async function handleSwitchBot(targetBotId: string) {
    if (targetBotId === activeBotId) {
      setOpenDropdown(false);
      return;
    }
    setBotCookie(targetBotId);
    setActiveBotId(targetBotId);
    setOpenDropdown(false);
    // Reload page to refresh all server components & DB context with explicit botId
    window.location.href = window.location.pathname + (targetBotId === "bot-1" ? "" : `?botId=${encodeURIComponent(targetBotId)}`);
  }

  async function handleCreateBot(e: React.FormEvent) {
    e.preventDefault();
    if (!newBotName.trim()) return;

    setCreating(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBotName.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.bot) {
        setBotCookie(data.bot.id);
        setOpenAddModal(false);
        setNewBotName("");
        // Reload and navigate to /login so user can scan QR for the new bot
        window.location.href = "/login";
      } else {
        setErrorMsg(data.error || "Không thể tạo bot mới");
      }
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpenDropdown(!openDropdown)}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-slate-950 border border-cyan-500/40 hover:border-cyan-400/80 px-2.5 sm:px-3 py-1.5 shadow-sm shadow-cyan-500/10 transition-all cursor-pointer group"
          title="Bấm để đổi bot hoặc thêm bot mới"
        >
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
            {activeBot.avatarUrl ? (
              <img src={activeBot.avatarUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <Bot className="h-3.5 w-3.5 text-cyan-300" />
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-950 ${
                activeBot.isOnline ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              }`}
            />
          </div>

          <div className="text-left min-w-0 max-w-[110px] sm:max-w-[150px]">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                {activeBot.name}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <span className={activeBot.isOnline ? "text-emerald-400 font-semibold" : "text-slate-500"}>
                {activeBot.isOnline ? "🟢 Online" : "⚪ Offline"}
              </span>
            </div>
          </div>

          <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-cyan-300 transition-transform" />
        </button>

        {/* Dropdown Menu */}
        {openDropdown && (
          <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/80 backdrop-blur-xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-2.5 py-1.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Danh sách Bot ({bots.length})
              </span>
              <button
                type="button"
                onClick={loadBots}
                className="text-slate-400 hover:text-cyan-300 p-1"
                title="Làm mới"
              >
                <RefreshCw size={12} />
              </button>
            </div>

            <div className="py-1.5 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
              {bots.map((b) => {
                const isSelected = b.id === activeBot.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSwitchBot(b.id)}
                    className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-cyan-500/15 border border-cyan-500/40 text-cyan-200"
                        : "hover:bg-slate-800/80 text-slate-300 hover:text-white border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700">
                        {b.avatarUrl ? (
                          <img src={b.avatarUrl} alt="" className="h-full w-full rounded-lg object-cover" />
                        ) : (
                          <Bot className="h-4 w-4 text-cyan-400" />
                        )}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-900 ${
                            b.isOnline ? "bg-emerald-400" : "bg-slate-500"
                          }`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-bold truncate ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                          {b.name}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {b.groupCount !== undefined ? `${b.groupCount} nhóm` : "0 nhóm"} •{" "}
                          <span className={b.isOnline ? "text-emerald-400" : "text-slate-500"}>
                            {b.isOnline ? "Đang chạy" : "Chưa kết nối"}
                          </span>
                        </p>
                      </div>
                    </div>

                    {isSelected && <Check className="h-4 w-4 text-cyan-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Nút Thêm Bot Mới */}
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setOpenDropdown(false);
                  setOpenAddModal(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold transition-all cursor-pointer"
              >
                <Plus size={14} />
                <span>Thêm Bot Zalo Mới</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 🌟 Modal Thêm Bot Mới */}
      {openAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 relative">
            <button
              onClick={() => setOpenAddModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Thêm Bot Zalo Mới</h3>
                <p className="text-xs text-slate-400">Tích hợp thêm tài khoản Bot Zalo thứ 2, 3 vào Dashboard</p>
              </div>
            </div>

            <form onSubmit={handleCreateBot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Tên gợi nhớ cho Bot mới:
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ví dụ: Bot 2 (Trợ Lý MMO) hoặc Bot Bán Hàng"
                  value={newBotName}
                  onChange={(e) => setNewBotName(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              {errorMsg && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300">
                  {errorMsg}
                </div>
              )}

              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs text-slate-400 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
                  <ShieldCheck size={14} />
                  <span>Cách thức hoạt động:</span>
                </div>
                <p>
                  • Sau khi bấm Tạo, Dashboard sẽ tự động chuyển sang Bot mới và mở trang <strong>Quét mã QR Zalo</strong>.
                </p>
                <p>
                  • Dữ liệu và lịch sử của Bot này sẽ được lưu hoàn toàn riêng biệt.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setOpenAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={creating || !newBotName.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {creating && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>{creating ? "Đang tạo..." : "Tạo & Quét QR"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
