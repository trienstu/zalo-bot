"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  weatherAuto?: boolean;
  weatherTime?: string;
  weatherCity?: string;
  isActive: boolean;
}

const POPULAR_CITIES = [
  "TP. Hồ Chí Minh",
  "Hà Nội",
  "Đà Nẵng",
  "Đà Lạt",
  "Cần Thơ",
  "Hải Phòng",
  "Nha Trang",
  "Bình Dương",
  "Đồng Nai",
  "Vũng Tàu",
  "Buôn Ma Thuột",
  "Quy Nhơn",
  "Huế",
  "Quảng Ninh",
  "Thanh Hóa",
  "Nghệ An",
];

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

function GroupPersonaFormInner() {
  const searchParams = useSearchParams();
  const urlGroupId = searchParams.get("group");

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
  const [weatherAuto, setWeatherAuto] = useState<boolean>(false);
  const [weatherTime, setWeatherTime] = useState<string>("07:00");
  const [weatherCity, setWeatherCity] = useState<string>("Hồ Chí Minh");
  const [testingWeather, setTestingWeather] = useState<boolean>(false);

  useEffect(() => {
    fetchGroups();
  }, []);

  // Tự động nhận diện và cập nhật cấu hình nhóm khi click nhóm ở cột trái
  useEffect(() => {
    if (groups.length > 0) {
      const target = groups.find((g) => g.id === urlGroupId) || groups[0];
      if (target && target.id !== selectedId) {
        setSelectedId(target.id);
        applyGroupState(target);
        setMsg(null);
      }
    }
  }, [urlGroupId, groups]);

  async function fetchGroups() {
    try {
      setLoading(true);
      const res = await fetch("/api/groups");
      const data = (await res.json()) as { groups?: GroupItem[] };
      if (data?.groups && data.groups.length > 0) {
        setGroups(data.groups);
        const target = (urlGroupId && data.groups.find((g) => g.id === urlGroupId)) || data.groups[0];
        setSelectedId(target.id);
        applyGroupState(target);
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
    setWeatherAuto(Boolean(g.weatherAuto));
    setWeatherTime(g.weatherTime || "07:00");
    setWeatherCity(g.weatherCity || "Hồ Chí Minh");
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
          weatherAuto,
          weatherTime,
          weatherCity,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (data.ok) {
        setMsg({ text: data.message || `Đã lưu cài đặt cho nhóm ${selectedGroup?.name || ""} thành công!`, ok: true });
        // Cập nhật lại state local
        setGroups((prev) =>
          prev.map((g) =>
            g.id === selectedId
              ? { ...g, persona, customPrompt, botName, welcomeMsg, mode, weatherAuto, weatherTime, weatherCity }
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

  async function handleTestWeather() {
    if (!selectedId) return;
    setTestingWeather(true);
    setMsg(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_weather",
          groupId: selectedId,
          groupName: selectedGroup?.name,
          weatherCity,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (data.ok) {
        setMsg({ text: data.message || "Đã gửi bản tin thử nghiệm vào nhóm Zalo!", ok: true });
      } else {
        setMsg({ text: data.error || "Lỗi gửi bản tin thử nghiệm", ok: false });
      }
    } catch (e) {
      setMsg({ text: `Lỗi kết nối: ${String(e)}`, ok: false });
    } finally {
      setTestingWeather(false);
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
            <div>
              <CardTitle className="text-xl font-bold bg-gradient-to-r from-amber-400 via-orange-300 to-cyan-400 bg-clip-text text-transparent">
                Cá Tính AI, Prompt & Thời Tiết Buổi Sáng
              </CardTitle>
              {selectedGroup && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs text-slate-400">Đang cấu hình:</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold shadow-sm">
                    <span>{selectedGroup.icon || "👥"}</span>
                    <span>{selectedGroup.name}</span>
                    <span className="text-[10px] font-mono text-slate-400 font-normal">({selectedGroup.count})</span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">ID: {selectedGroup.id}</span>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-2">
            Thiết lập phong cách phản hồi, kịch bản chỉ thị Prompt và lịch tự động gửi Bản tin thời tiết buổi sáng cho nhóm đang chọn ở cột trái.
          </p>
        </div>

        {selectedGroup && (
          <div className="flex items-center gap-2 self-start md:self-auto">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium px-5 py-2.5 rounded-xl shadow-lg shadow-orange-500/20 transition-all flex items-center gap-2 text-sm cursor-pointer"
            >
              {saving ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Đang lưu cài đặt...
                </>
              ) : (
                <>
                  <span>💾</span> Lưu Cài Đặt Nhóm
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
          Đang tải cấu hình nhóm Zalo...
        </div>
      ) : groups.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          Chưa tìm thấy nhóm Zalo nào trong cơ sở dữ liệu.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* 1. Chọn Preset Cá tính AI */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2.5">
              1. Chọn phong cách & cá tính AI cho [{selectedGroup?.name}]:
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

          {/* 2. Tùy chỉnh chi tiết (Tên bot, Chế độ, Custom Prompt, Welcome Msg) */}
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

          {/* 3. Bản Tin Thời Tiết & Chào Buổi Sáng Tự Động */}
          <div className="p-4 rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/30 to-slate-900/60 backdrop-blur-md flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-cyan-500/20">
              <div className="flex items-center gap-2">
                <span className="text-xl">☀️</span>
                <div>
                  <h4 className="text-sm font-bold text-cyan-300">Bản Tin Thời Tiết & Chào Buổi Sáng Tự Động</h4>
                  <p className="text-xs text-slate-400">Tự động gửi dự báo thời tiết, nhiệt độ, xác suất mưa và bụi mịn (AQI) vào nhóm mỗi sáng.</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestWeather}
                  disabled={testingWeather}
                  className="px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  title="Gửi thử ngay một bản tin mẫu vào nhóm để kiểm tra"
                >
                  {testingWeather ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                      <span>Đang gửi thử...</span>
                    </>
                  ) : (
                    <>
                      <span>🚀</span> Gửi thử vào nhóm
                    </>
                  )}
                </button>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={weatherAuto}
                    onChange={(e) => setWeatherAuto(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>
            </div>

            {weatherAuto && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    📍 Tỉnh / Thành phố dự báo cho nhóm:
                  </label>
                  <select
                    value={weatherCity}
                    onChange={(e) => setWeatherCity(e.target.value)}
                    className="w-full bg-slate-800/90 border border-cyan-500/30 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-400 transition-all"
                  >
                    {POPULAR_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    ⏰ Khung giờ tự động gửi mỗi sáng (HH:mm):
                  </label>
                  <input
                    type="time"
                    value={weatherTime}
                    onChange={(e) => setWeatherTime(e.target.value)}
                    className="w-full bg-slate-800/90 border border-cyan-500/30 rounded-xl px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-400 transition-all"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4. Khung xem trước phản hồi mẫu (Live Preview) */}
          <div className="mt-1 p-4 rounded-xl border border-white/10 bg-slate-950/60 backdrop-blur-md">
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

export function GroupPersonaForm() {
  return (
    <Suspense
      fallback={
        <Card className="p-6 text-center text-xs text-slate-400">
          <div className="inline-block w-5 h-5 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mr-2" />
          Đang tải cấu hình AI nhóm...
        </Card>
      }
    >
      <GroupPersonaFormInner />
    </Suspense>
  );
}
