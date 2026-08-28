"use client";

import { useState, useEffect } from "react";
import { Card, CardTitle, Button } from "@/components/ui";

export interface GroupItem {
  id: string;
  name: string;
  count: string;
  icon: string;
  mode: "interactive" | "silent" | "disabled";
  persona: "humorous" | "professional" | "friendly" | "strict" | "custom";
  customPrompt: string;
  botName: string;
  welcomeMsg: string;
  isActive: boolean;
}

const PERSONA_PRESETS = [
  {
    id: "humorous" as const,
    name: "Hài Hước / Lầy Lội",
    icon: "🎭",
    badge: "Mặc định",
    color: "from-amber-500/20 to-orange-500/10 border-amber-500/40 text-amber-300",
    desc: "Chém gió bá đạo, dí dỏm, thả miếng bắt trend, tạo không khí gắn kết sôi nổi cho anh em.",
    sample: "Dạ em Sen Chúa chào bác! Câu hỏi này dễ ợt, để em 'bật mode thông thái' giải quyết trong 1 nốt nhạc nè! 😎",
  },
  {
    id: "professional" as const,
    name: "Chuyên Nghiệp / Công Nghệ",
    icon: "💼",
    badge: "Chuyên gia",
    color: "from-cyan-500/20 to-blue-500/10 border-cyan-500/40 text-cyan-300",
    desc: "Súc tích, logic, phân tích chuyên môn sâu (Công nghệ, AI, Lập trình, Marketing, Tài chính).",
    sample: "Chào bạn. Vấn đề này có 3 giải pháp kỹ thuật tối ưu sau: 1. Tối ưu kiến trúc... 2. Xử lý cache... Bạn có thể tham khảo nhé.",
  },
  {
    id: "friendly" as const,
    name: "Thân Thiện / Tận Tâm",
    icon: "🌸",
    badge: "Chu đáo",
    color: "from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300",
    desc: "Nhẹ nhàng, ân cần, lễ phép, giải thích cặn kẽ và hỗ trợ thành viên với sự kiên nhẫn tối đa.",
    sample: "Dạ em chào bạn ạ! Rất vui được hỗ trợ bạn. Bạn đừng lo nhé, mình cùng từng bước xem xét vấn đề này nha.",
  },
  {
    id: "strict" as const,
    name: "Nghiêm Túc / Quản Trị",
    icon: "🛡️",
    badge: "Kỷ luật",
    color: "from-rose-500/20 to-red-500/10 border-rose-500/40 text-rose-300",
    desc: "Chuẩn mực, đề cao kỷ luật và nội quy nhóm, cảnh báo thẳng thắn các hành vi vi phạm quy tắc.",
    sample: "Thông báo: Vui lòng tuân thủ đúng nội quy thảo luận của nhóm. Mọi hành vi spam link quảng cáo sẽ bị xử lý.",
  },
  {
    id: "custom" as const,
    name: "Tùy Chỉnh Nâng Cao",
    icon: "⚡",
    badge: "Custom Prompt",
    color: "from-purple-500/20 to-indigo-500/10 border-purple-500/40 text-purple-300",
    desc: "Tự viết kịch bản System Prompt, quy định cách xưng hô, cấm kỵ và phong cách theo ý bạn.",
    sample: "Tuân thủ 100% chỉ đạo và quy tắc riêng mà Quản trị viên đã soạn thảo trong khung bên dưới.",
  },
];

export function GroupPersonaForm() {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Form state cho nhóm đang chọn
  const [persona, setPersona] = useState<GroupItem["persona"]>("humorous");
  const [customPrompt, setCustomPrompt] = useState("");
  const [botName, setBotName] = useState("Sen Chúa");
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [mode, setMode] = useState<GroupItem["mode"]>("interactive");

  useEffect(() => {
    fetchGroups();
  }, []);

  async function fetchGroups() {
    try {
      setLoading(true);
      const res = await fetch("/api/groups");
      const data = (await res.json()) as { groups?: GroupItem[] };
      if (data?.groups && data.groups.length > 0) {
        setGroups(data.groups);
        const first = data.groups[0];
        if (!selectedId || !data.groups.some((g) => g.id === selectedId)) {
          setSelectedId(first.id);
          applyGroupState(first);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function applyGroupState(g: GroupItem) {
    setPersona(g.persona || "humorous");
    setCustomPrompt(g.customPrompt || "");
    setBotName(g.botName || "Sen Chúa");
    setWelcomeMsg(g.welcomeMsg || "");
    setMode(g.mode || "interactive");
  }

  function handleSelectGroup(id: string) {
    setSelectedId(id);
    const target = groups.find((g) => g.id === id);
    if (target) {
      applyGroupState(target);
      setMsg(null);
    }
  }

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_persona",
          groupId: selectedId,
          persona,
          customPrompt,
          botName,
          welcomeMsg,
          mode,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (data.ok) {
        setMsg({ text: data.message || "Đã lưu cài đặt cá tính thành công!", ok: true });
        // Cập nhật lại state local
        setGroups((prev) =>
          prev.map((g) =>
            g.id === selectedId
              ? { ...g, persona, customPrompt, botName, welcomeMsg, mode }
              : g,
          ),
        );
      } else {
        setMsg({ text: data.error || "Lỗi lưu cài đặt", ok: false });
      }
    } catch (e) {
      setMsg({ text: `Lỗi kết nối: ${String(e)}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  const selectedGroup = groups.find((g) => g.id === selectedId);
  const currentPersonaInfo = PERSONA_PRESETS.find((p) => p.id === persona) || PERSONA_PRESETS[0];

  return (
    <Card className="border border-white/10 bg-slate-900/60 backdrop-blur-xl shadow-2xl rounded-2xl overflow-hidden p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🤖</span>
            <CardTitle className="text-xl font-bold bg-gradient-to-r from-amber-400 via-orange-300 to-rose-400 bg-clip-text text-transparent">
              Cá Tính AI & Prompt Riêng Từng Nhóm
            </CardTitle>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Thiết lập phong cách trả lời, xưng hô và kịch bản chỉ thị System Prompt độc quyền cho từng nhóm Zalo.
          </p>
        </div>

        {selectedGroup && (
          <div className="flex items-center gap-2 self-start md:self-auto">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium px-5 py-2 rounded-xl shadow-lg shadow-orange-500/20 transition-all flex items-center gap-2 text-sm"
            >
              {saving ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Đang lưu...
                </>
              ) : (
                <>
                  <span>💾</span> Lưu Cá Tính Nhóm
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {msg && (
        <div
          className={`mt-4 p-3 rounded-xl text-sm flex items-center gap-2 border transition-all ${
            msg.ok
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
              : "bg-rose-500/15 border-rose-500/40 text-rose-300"
          }`}
        >
          <span>{msg.ok ? "✅" : "⚠️"}</span>
          <span>{msg.text}</span>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm flex items-center justify-center gap-3">
          <span className="inline-block w-5 h-5 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          Đang tải danh sách nhóm Zalo...
        </div>
      ) : groups.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          Chưa tìm thấy nhóm Zalo nào trong cơ sở dữ liệu.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* 1. Thanh chọn nhóm (Tabs) */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2.5">
              1. Chọn nhóm Zalo cần cấu hình:
            </label>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const isSelected = g.id === selectedId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => handleSelectGroup(g.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium transition-all flex items-center gap-2 border ${
                      isSelected
                        ? "bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-md shadow-amber-500/10 scale-[1.02]"
                        : "bg-slate-800/60 border-slate-700/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <span>{g.icon || "👥"}</span>
                    <span className="truncate max-w-[180px] font-semibold">{g.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-900/80 text-slate-400">
                      {g.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Chọn Preset Cá tính AI */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2.5">
              2. Chọn phong cách & cá tính AI cho [{selectedGroup?.name}]:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PERSONA_PRESETS.map((p) => {
                const isCurrent = persona === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setPersona(p.id)}
                    className={`cursor-pointer p-4 rounded-xl border transition-all relative flex flex-col justify-between bg-gradient-to-br ${
                      isCurrent
                        ? `${p.color} ring-1 ring-amber-400/50 shadow-lg scale-[1.01]`
                        : "from-slate-800/40 to-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{p.icon}</span>
                          <span className="font-bold text-sm text-slate-100">{p.name}</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/40 border border-white/10 text-slate-300 font-medium">
                          {p.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">{p.desc}</p>
                    </div>

                    {isCurrent && (
                      <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-1.5 text-[11px] text-amber-300 font-semibold">
                        <span>✨</span> Đang áp dụng cho nhóm này
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Tùy chỉnh chi tiết (Tên bot, Chế độ, Custom Prompt, Welcome Msg) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
            {/* Cột trái: Tên Bot, Chế độ & Welcome Msg */}
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Tên / Biệt danh của Bot trong nhóm:
                </label>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="Ví dụ: Sen Chúa, Trợ Lý AI, Giáo Sư..."
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition-all"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Tên này sẽ được xưng hô trong lời chào và các câu phản hồi của Bot.
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Chế độ hoạt động của nhóm:
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60 transition-all"
                >
                  <option value="interactive">🟢 Tương tác tự do (Trả lời khi tag, lệnh, tổng hợp...)</option>
                  <option value="silent">🟡 Tàu ngầm (Chỉ âm thầm ghi nhận dữ liệu & thống kê)</option>
                  <option value="disabled">🔴 Tắt hoàn toàn (Bỏ qua tin nhắn nhóm này)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Thông điệp chào mừng thành viên mới (Tùy chọn):
                </label>
                <textarea
                  rows={3}
                  value={welcomeMsg}
                  onChange={(e) => setWelcomeMsg(e.target.value)}
                  placeholder="Ví dụ: Chào mừng bạn đã tham gia nhóm! Nhóm chúng mình chuyên chia sẻ kiến thức AI..."
                  className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition-all resize-none"
                />
              </div>
            </div>

            {/* Cột phải: Custom System Prompt */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 block">
                  Chỉ thị / System Prompt Riêng Biệt (Custom Rules):
                </label>
                <span className="text-[10px] text-amber-400/90 font-medium">Bắt buộc tuân thủ 100%</span>
              </div>
              <textarea
                rows={7}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Ví dụ:&#10;- Đây là nhóm chuyên thảo luận về Prompt Engineering & AI Tools.&#10;- Luôn xưng em và gọi mọi người là 'các chuyên gia'.&#10;- Không trả lời các chủ đề về tôn giáo, chính trị hoặc cờ bạc."
                className="w-full flex-1 bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 font-mono text-xs leading-relaxed transition-all resize-none"
              />
              <span className="text-[11px] text-slate-400 leading-tight">
                💡 Mẹo: Bạn có thể nhập các quy định cấm kỵ, từ khóa xưng hô, hoặc chuyên môn trọng tâm cho nhóm.
              </span>
            </div>
          </div>

          {/* 4. Khung xem trước phản hồi mẫu (Live Preview) */}
          <div className="mt-2 p-4 rounded-xl border border-white/10 bg-slate-950/60 backdrop-blur-md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                <span>💬</span> Xem trước phản hồi mẫu của [{botName}]:
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {currentPersonaInfo.icon} {currentPersonaInfo.name}
              </span>
            </div>
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 leading-relaxed font-sans">
              {currentPersonaInfo.sample}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
