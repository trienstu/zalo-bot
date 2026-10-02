"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Megaphone,
  Users,
  Play,
  Pause,
  Square,
  Plus,
  RefreshCw,
  Search,
  Download,
  Trash2,
  Eye,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  UserCheck,
  X,
  Upload,
  Calendar,
  Layers,
} from "lucide-react";
import { Card, CardTitle, Badge } from "@/components/ui";

interface ZaloMktCampaign {
  id: string;
  title: string;
  raw_content: string;
  images_json: string;
  status: "draft" | "running" | "paused" | "completed" | "stopped";
  config_json: string;
  total_leads: number;
  sent_count: number;
  failed_count: number;
  not_found_count: number;
  skipped_count: number;
  created_at: number;
  updated_at: number;
}

interface ZaloMktContact {
  phone: string;
  zalo_uid?: string | null;
  zalo_name: string;
  display_name: string;
  gender: number;
  dob?: number | null;
  sdob: string;
  avatar: string;
  bio: string;
  status_code: "unverified" | "valid" | "no_zalo" | "blocked_stranger" | "invalid_phone";
  is_blacklisted: number;
  total_sent: number;
  last_sent_at?: number | null;
  last_checked_at?: number | null;
  ai_tags: string[];
  ai_notes: string;
  created_at: number;
  updated_at: number;
}

interface ZaloMktLead {
  id: number;
  campaign_id: string;
  phone: string;
  custom_name: string;
  zalo_uid?: string | null;
  display_name: string;
  gender: number;
  avatar: string;
  status: "pending" | "searching" | "ready" | "sending" | "sent" | "failed" | "skipped";
  skip_reason: string;
  personalized_text: string;
  alias_updated: number;
  alias_name: string;
  friend_requested: number;
  error_message: string;
  sent_at?: number | null;
  created_at: number;
}

export interface ZaloMktStats {
  totalContacts: number;
  validContacts: number;
  noZaloContacts: number;
  blockedStrangerContacts: number;
  totalCampaigns: number;
  runningCampaigns: number;
  totalSentMessages: number;
}

export function ZaloMktManager({ botId = "bot-1" }: { botId?: string }) {
  const [activeTab, setActiveTab] = useState<"campaigns" | "contacts" | "settings">("campaigns");

  // State chiến dịch
  const [campaigns, setCampaigns] = useState<ZaloMktCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [stats, setStats] = useState<ZaloMktStats | null>(null);

  // State modal tạo chiến dịch
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createPhones, setCreatePhones] = useState("");
  const [minDelay, setMinDelay] = useState(25);
  const [maxDelay, setMaxDelay] = useState(45);
  const [autoAlias, setAutoAlias] = useState(true);
  const [autoFriend, setAutoFriend] = useState(false);
  const [aiRewrite, setAiRewrite] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [creating, setCreating] = useState(false);

  // State AI preview modal
  const [showAiPreviewModal, setShowAiPreviewModal] = useState(false);
  const [previewSampleName, setPreviewSampleName] = useState("Nguyễn Văn A");
  const [previewSampleGender, setPreviewSampleGender] = useState(1);
  const [previewSamplePhone, setPreviewSamplePhone] = useState("0912345678");
  const [previewSampleSdob, setPreviewSampleSdob] = useState("15/08/1990");
  const [previewResult, setPreviewResult] = useState("");
  const [loadingAiPreview, setLoadingAiPreview] = useState(false);

  // State chi tiết chiến dịch
  const [selectedCampaign, setSelectedCampaign] = useState<ZaloMktCampaign | null>(null);
  const [campaignLeads, setCampaignLeads] = useState<ZaloMktLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");

  // State kho contacts
  const [contacts, setContacts] = useState<ZaloMktContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactStatusFilter, setContactStatusFilter] = useState("all");
  const [contactTotal, setContactTotal] = useState(0);

  // State modal nhập contacts
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPhonesText, setImportPhonesText] = useState("");
  const [importing, setImporting] = useState(false);

  // Tải danh sách chiến dịch
  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const res = await fetch(`/api/zalomkt/campaigns?botId=${botId}`);
      const data = await res.json();
      if (data.ok) {
        setCampaigns(data.campaigns || []);
        setStats(data.stats || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCampaigns(false);
    }
  }, [botId]);

  // Tải danh sách contacts
  const fetchContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const query = new URLSearchParams({
        botId,
        search: contactSearch,
        status: contactStatusFilter,
        limit: "50",
      });
      const res = await fetch(`/api/zalomkt/contacts?${query.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setContacts(data.contacts || []);
        setContactTotal(data.pagination?.total || 0);
        if (data.stats) setStats(data.stats);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingContacts(false);
    }
  }, [botId, contactSearch, contactStatusFilter]);

  // Tải danh sách leads của 1 chiến dịch
  const fetchCampaignDetails = useCallback(async (campId: string) => {
    setLoadingLeads(true);
    try {
      const res = await fetch(`/api/zalomkt/campaigns/${campId}?botId=${botId}&status=${leadStatusFilter}`);
      const data = await res.json();
      if (data.ok) {
        setSelectedCampaign(data.campaign);
        setCampaignLeads(data.leads || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLeads(false);
    }
  }, [botId, leadStatusFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    if (activeTab === "contacts") {
      fetchContacts();
    }
  }, [activeTab, fetchContacts]);

  useEffect(() => {
    if (selectedCampaign) {
      fetchCampaignDetails(selectedCampaign.id);
    }
  }, [selectedCampaign?.id, leadStatusFilter, fetchCampaignDetails]);

  // Auto refresh định kỳ 5s nếu có chiến dịch đang chạy
  useEffect(() => {
    const hasRunning = campaigns.some((c) => c.status === "running");
    if (!hasRunning) return;

    const interval = setInterval(() => {
      fetchCampaigns();
      if (selectedCampaign) {
        fetchCampaignDetails(selectedCampaign.id);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [campaigns, selectedCampaign, fetchCampaigns, fetchCampaignDetails]);

  // Xử lý Upload ảnh
  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingImages(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]!);
    }

    try {
      const res = await fetch("/api/zalomkt/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.files)) {
        setUploadedImages((prev) => [...prev, ...data.files]);
      } else {
        alert(data.error || "Lỗi tải ảnh lên");
      }
    } catch (err: any) {
      alert("Lỗi tải ảnh: " + String(err));
    } finally {
      setUploadingImages(false);
    }
  };

  // Xử lý tạo chiến dịch
  const handleCreateCampaign = async () => {
    if (!createTitle.trim()) return alert("Vui lòng nhập tên chiến dịch");
    if (!createContent.trim()) return alert("Vui lòng nhập nội dung tin nhắn");
    if (!createPhones.trim()) return alert("Vui lòng nhập ít nhất 1 số điện thoại");

    setCreating(true);
    try {
      const res = await fetch("/api/zalomkt/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          title: createTitle,
          rawContent: createContent,
          images: uploadedImages,
          rawPhones: createPhones,
          config: {
            minDelay: minDelay * 1000,
            maxDelay: maxDelay * 1000,
            autoAlias,
            autoFriend,
            aiRewrite,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(
          `🎉 Tạo chiến dịch thành công!\n- Tổng số nhận diện: ${data.totalLeads}\n- Tự động bỏ qua (Pre-flight Filter): ${data.skippedLeads} số chết/chặn`,
        );
        setShowCreateModal(false);
        setCreateTitle("");
        setCreateContent("");
        setCreatePhones("");
        setUploadedImages([]);
        fetchCampaigns();
      } else {
        alert("Lỗi tạo chiến dịch: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi gửi dữ liệu: " + String(err));
    } finally {
      setCreating(false);
    }
  };

  // Điều khiển chiến dịch (Start, Pause, Resume, Stop)
  const handleControlCampaign = async (id: string, action: "start" | "pause" | "resume" | "stop") => {
    try {
      const res = await fetch(`/api/zalomkt/campaigns/${id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, action }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchCampaigns();
        if (selectedCampaign && selectedCampaign.id === id) {
          fetchCampaignDetails(id);
        }
      } else {
        alert("Thao tác thất bại: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi thao tác: " + String(err));
    }
  };

  // Xóa chiến dịch
  const handleDeleteCampaign = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa chiến dịch này và toàn bộ lịch sử gửi của nó?")) return;
    try {
      const res = await fetch(`/api/zalomkt/campaigns/${id}?botId=${botId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        if (selectedCampaign?.id === id) setSelectedCampaign(null);
        fetchCampaigns();
      } else {
        alert("Lỗi xóa: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi xóa: " + String(err));
    }
  };

  // Thử nghiệm AI cá nhân hóa
  const handleTestAiPreview = async () => {
    if (!createContent.trim()) return alert("Vui lòng soạn nội dung tin nhắn trước khi xem thử!");
    setLoadingAiPreview(true);
    setPreviewResult("");
    setShowAiPreviewModal(true);

    try {
      const res = await fetch("/api/zalomkt/preview-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawContent: createContent,
          recipientName: previewSampleName,
          gender: previewSampleGender,
          phone: previewSamplePhone,
          sdob: previewSampleSdob,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setPreviewResult(data.personalizedText);
      } else {
        setPreviewResult("Lỗi tạo mẫu: " + data.error);
      }
    } catch (err: any) {
      setPreviewResult("Lỗi kết nối: " + String(err));
    } finally {
      setLoadingAiPreview(false);
    }
  };

  // Nhập SĐT hàng loạt vào kho data
  const handleImportContacts = async () => {
    if (!importPhonesText.trim()) return alert("Vui lòng nhập danh sách số điện thoại");
    setImporting(true);
    try {
      const res = await fetch("/api/zalomkt/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, rawPhones: importPhonesText }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ Đã nạp thành công!\n- Số mới thêm: ${data.imported}\n- Số đã có sẵn: ${data.updated}`);
        setShowImportModal(false);
        setImportPhonesText("");
        fetchContacts();
      } else {
        alert("Lỗi: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi: " + String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Overview Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="flex flex-col justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-sky-400" />
            Kho Data SĐT
          </CardTitle>
          <div className="mt-2 text-2xl font-bold text-slate-100">{stats?.totalContacts || 0}</div>
          <div className="mt-1 text-xs text-slate-400">
            {stats?.validContacts || 0} có Zalo • {stats?.noZaloContacts || 0} chưa có Zalo
          </div>
        </Card>

        <Card className="flex flex-col justify-between">
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-emerald-400" />
            Chiến Dịch
          </CardTitle>
          <div className="mt-2 text-2xl font-bold text-slate-100">{stats?.totalCampaigns || 0}</div>
          <div className="mt-1 text-xs text-slate-400">{stats?.runningCampaigns || 0} đang chạy trực tiếp</div>
        </Card>

        <Card className="flex flex-col justify-between">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-indigo-400" />
            Tin Đã Gửi
          </CardTitle>
          <div className="mt-2 text-2xl font-bold text-slate-100">{stats?.totalSentMessages || 0}</div>
          <div className="mt-1 text-xs text-slate-400">Cá nhân hóa AI & cụm ảnh</div>
        </Card>

        <Card className="flex flex-col justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            Đã Lọc Trước
          </CardTitle>
          <div className="mt-2 text-2xl font-bold text-amber-300">
            {stats?.blockedStrangerContacts || 0} số
          </div>
          <div className="mt-1 text-xs text-slate-400">Tránh gửi thử số chặn người lạ</div>
        </Card>
      </div>

      {/* 2. Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("campaigns")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "campaigns"
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Megaphone className="h-4 w-4" />
            Quản Lý Chiến Dịch
          </button>
          <button
            onClick={() => setActiveTab("contacts")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "contacts"
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Users className="h-4 w-4" />
            Kho Data SĐT Toàn Cục
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "settings"
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            Cấu Hình & Anti-Ban
          </button>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === "campaigns" && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-indigo-500 transition-all"
            >
              <Plus className="h-4 w-4" />
              Tạo Chiến Dịch Mới
            </button>
          )}

          {activeTab === "contacts" && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 transition-all"
            >
              <Plus className="h-4 w-4" />
              Nhập Data SĐT
            </button>
          )}

          <button
            onClick={() => {
              if (activeTab === "campaigns") fetchCampaigns();
              else if (activeTab === "contacts") fetchContacts();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Làm mới
          </button>
        </div>
      </div>

      {/* 3. NỘI DUNG TAB 1: CHIẾN DỊCH */}
      {activeTab === "campaigns" && (
        <div className="space-y-6">
          {loadingCampaigns && campaigns.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">Đang tải danh sách chiến dịch...</div>
          ) : campaigns.length === 0 ? (
            <Card className="py-12 text-center">
              <Megaphone className="mx-auto h-12 w-12 text-slate-600" />
              <div className="mt-3 text-base font-semibold text-slate-200">Chưa có chiến dịch marketing nào</div>
              <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                Bấm vào nút &quot;Tạo Chiến Dịch Mới&quot; ở góc trên để bắt đầu gửi tin nhắn cá nhân hóa và cụm ảnh cho danh sách SĐT.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {campaigns.map((camp) => {
                const completedCount = camp.sent_count + camp.failed_count + camp.skipped_count;
                const percent = camp.total_leads > 0 ? Math.round((completedCount / camp.total_leads) * 100) : 0;

                return (
                  <Card key={camp.id} className="relative overflow-hidden border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur-md">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-bold text-white tracking-tight">{camp.title}</h3>
                          <Badge
                            tone={
                              camp.status === "running"
                                ? "ok"
                                : camp.status === "paused"
                                ? "warn"
                                : camp.status === "completed"
                                ? "default"
                                : "muted"
                            }
                          >
                            {camp.status === "running" && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400 animate-ping" />}
                            {camp.status === "running"
                              ? "Đang chạy"
                              : camp.status === "paused"
                              ? "Tạm dừng"
                              : camp.status === "completed"
                              ? "Đã hoàn thành"
                              : camp.status === "stopped"
                              ? "Đã dừng"
                              : "Bản nháp"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-slate-500" />
                            {new Date(camp.created_at).toLocaleString("vi-VN")}
                          </span>
                          <span>•</span>
                          <span>Tổng: <strong className="text-slate-200">{camp.total_leads}</strong> số</span>
                          <span>•</span>
                          <span className="text-emerald-400">Thành công: <strong>{camp.sent_count}</strong></span>
                          <span>•</span>
                          <span className="text-amber-400">Tự động bỏ qua: <strong>{camp.skipped_count}</strong></span>
                          {camp.failed_count > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-rose-400">Thất bại: <strong>{camp.failed_count}</strong></span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Nút hành động */}
                      <div className="flex items-center gap-2">
                        {camp.status === "draft" && (
                          <button
                            onClick={() => handleControlCampaign(camp.id, "start")}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Bắt đầu gửi
                          </button>
                        )}

                        {camp.status === "running" && (
                          <>
                            <button
                              onClick={() => handleControlCampaign(camp.id, "pause")}
                              className="flex items-center gap-1.5 rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-semibold text-amber-400 border border-amber-500/30 hover:bg-amber-600/30"
                            >
                              <Pause className="h-3.5 w-3.5" />
                              Tạm dừng
                            </button>
                            <button
                              onClick={() => handleControlCampaign(camp.id, "stop")}
                              className="flex items-center gap-1.5 rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-semibold text-rose-400 border border-rose-500/30 hover:bg-rose-600/30"
                            >
                              <Square className="h-3.5 w-3.5" />
                              Dừng hẳn
                            </button>
                          </>
                        )}

                        {camp.status === "paused" && (
                          <>
                            <button
                              onClick={() => handleControlCampaign(camp.id, "resume")}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30"
                            >
                              <Play className="h-3.5 w-3.5" />
                              Tiếp tục
                            </button>
                            <button
                              onClick={() => handleControlCampaign(camp.id, "stop")}
                              className="flex items-center gap-1.5 rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-semibold text-rose-400 border border-rose-500/30 hover:bg-rose-600/30"
                            >
                              <Square className="h-3.5 w-3.5" />
                              Dừng hẳn
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => setSelectedCampaign(camp)}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Chi tiết
                        </button>

                        <a
                          href={`/api/zalomkt/campaigns/${camp.id}/export?botId=${botId}`}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          title="Tải file Excel/CSV kết quả"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Xuất CSV
                        </a>

                        <button
                          onClick={() => handleDeleteCampaign(camp.id)}
                          className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20"
                          title="Xóa chiến dịch"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Thanh tiến độ */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                        <span>Tiến trình hoàn thành: <strong>{completedCount}</strong> / {camp.total_leads} số</span>
                        <span className="font-semibold text-sky-400">{percent}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Modal / Bảng chi tiết chiến dịch được chọn */}
          {selectedCampaign && (
            <div className="mt-8 space-y-4 rounded-2xl border border-sky-500/30 bg-slate-950/80 p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Layers className="h-5 w-5 text-sky-400" />
                    Chi Tiết Tiến Độ: {selectedCampaign.title}
                  </h3>
                  <div className="mt-1 text-xs text-slate-400">
                    ID: <code className="text-sky-300">{selectedCampaign.id}</code> • Đang hiển thị danh sách số điện thoại trong chiến dịch
                  </div>
                </div>
                <button
                  onClick={() => setSelectedCampaign(null)}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Bộ lọc trạng thái Lead */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  {["all", "sent", "failed", "skipped", "pending"].map((st) => (
                    <button
                      key={st}
                      onClick={() => setLeadStatusFilter(st)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                        leadStatusFilter === st
                          ? "bg-sky-500 text-white"
                          : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      {st === "all"
                        ? "Tất cả"
                        : st === "sent"
                        ? "Đã gửi"
                        : st === "failed"
                        ? "Thất bại"
                        : st === "skipped"
                        ? "Tự bỏ qua"
                        : "Chờ gửi"}
                    </button>
                  ))}
                </div>

                <a
                  href={`/api/zalomkt/campaigns/${selectedCampaign.id}/export?botId=${botId}`}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30"
                >
                  <Download className="h-3.5 w-3.5" />
                  Tải Excel/CSV danh sách này
                </a>
              </div>

              {/* Bảng Leads */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="p-3">SĐT</th>
                      <th className="p-3">Tên Khách Hàng</th>
                      <th className="p-3">Giới Tính</th>
                      <th className="p-3">Trạng Thái</th>
                      <th className="p-3">Đổi Tên Gợi Nhớ</th>
                      <th className="p-3">Ghi Chú / Lỗi</th>
                      <th className="p-3">Thời Gian Gửi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                    {loadingLeads ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-500">
                          Đang tải dữ liệu leads...
                        </td>
                      </tr>
                    ) : campaignLeads.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-500">
                          Không có số điện thoại nào thỏa mãn bộ lọc.
                        </td>
                      </tr>
                    ) : (
                      campaignLeads.map((lead) => (
                        <tr key={lead.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="p-3 font-mono font-medium text-slate-200">{lead.phone}</td>
                          <td className="p-3">
                            <div className="font-medium text-white">{lead.custom_name || lead.display_name || "-"}</div>
                            {lead.zalo_uid && <div className="text-[10px] text-slate-500">UID: {lead.zalo_uid}</div>}
                          </td>
                          <td className="p-3">
                            {lead.gender === 1 ? (
                              <span className="text-sky-400 font-medium">Nam</span>
                            ) : lead.gender === 0 ? (
                              <span className="text-pink-400 font-medium">Nữ</span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge
                              tone={
                                lead.status === "sent"
                                  ? "ok"
                                  : lead.status === "failed"
                                  ? "danger"
                                  : lead.status === "skipped"
                                  ? "warn"
                                  : "muted"
                              }
                            >
                              {lead.status === "sent"
                                ? "Đã gửi"
                                : lead.status === "failed"
                                ? "Thất bại"
                                : lead.status === "skipped"
                                ? "Tự bỏ qua"
                                : lead.status === "sending"
                                ? "Đang gửi..."
                                : lead.status === "searching"
                                ? "Đang quét..."
                                : "Chờ gửi"}
                            </Badge>
                          </td>
                          <td className="p-3">
                            {lead.alias_updated ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                                <CheckCircle2 className="h-3 w-3" />
                                {lead.alias_name || "Đã đổi"}
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px]">Chưa đổi</span>
                            )}
                          </td>
                          <td className="p-3 max-w-xs truncate text-slate-400">
                            {lead.skip_reason || lead.error_message || "-"}
                          </td>
                          <td className="p-3 text-slate-400">
                            {lead.sent_at ? new Date(lead.sent_at).toLocaleTimeString("vi-VN") : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. NỘI DUNG TAB 2: KHO DATA SĐT TOÀN CỤC */}
      {activeTab === "contacts" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative min-w-[260px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Tìm SĐT hoặc Tên Zalo..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <select
                value={contactStatusFilter}
                onChange={(e) => setContactStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="valid">Có Zalo (Hợp lệ)</option>
                <option value="no_zalo">Chưa có Zalo</option>
                <option value="blocked_stranger">Chặn tin nhắn người lạ</option>
                <option value="unverified">Chưa kiểm tra</option>
              </select>
            </div>

            <div className="text-xs text-slate-400">
              Tổng số trong kho: <strong className="text-sky-400">{contactTotal}</strong> số
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-md">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="p-3">Số Điện Thoại</th>
                  <th className="p-3">Tên Hiển Thị Zalo</th>
                  <th className="p-3">Giới Tính</th>
                  <th className="p-3">Ngày Sinh (sdob)</th>
                  <th className="p-3">Trạng Thái Zalo</th>
                  <th className="p-3">Số Chiến Dịch</th>
                  <th className="p-3">Lần Cuối Gửi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/30">
                {loadingContacts ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Đang tải danh bạ khách hàng...
                    </td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Chưa có số điện thoại nào trong kho dữ liệu.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c) => (
                    <tr key={c.phone} className="hover:bg-slate-900/40 transition-colors">
                      <td className="p-3 font-mono font-medium text-slate-200">{c.phone}</td>
                      <td className="p-3">
                        <div className="font-semibold text-white">{c.display_name || c.zalo_name || "-"}</div>
                        {c.bio && <div className="text-[10px] text-slate-400 italic truncate max-w-xs">{c.bio}</div>}
                      </td>
                      <td className="p-3">
                        {c.gender === 1 ? (
                          <span className="text-sky-400 font-medium">Nam</span>
                        ) : c.gender === 0 ? (
                          <span className="text-pink-400 font-medium">Nữ</span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        {c.sdob ? (
                          <span className="inline-flex items-center gap-1 text-amber-300 font-mono text-[11px]">
                            <Calendar className="h-3 w-3" />
                            {c.sdob}
                          </span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge
                          tone={
                            c.status_code === "valid"
                              ? "ok"
                              : c.status_code === "blocked_stranger"
                              ? "danger"
                              : c.status_code === "no_zalo"
                              ? "warn"
                              : "muted"
                          }
                        >
                          {c.status_code === "valid"
                            ? "Có Zalo (Sống)"
                            : c.status_code === "blocked_stranger"
                            ? "Chặn người lạ"
                            : c.status_code === "no_zalo"
                            ? "Chưa có Zalo"
                            : "Chưa kiểm tra"}
                        </Badge>
                      </td>
                      <td className="p-3 text-slate-300 font-medium">{c.total_sent || 0} lần</td>
                      <td className="p-3 text-slate-400">
                        {c.last_sent_at ? new Date(c.last_sent_at).toLocaleDateString("vi-VN") : "Chưa gửi"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. NỘI DUNG TAB 3: CẤU HÌNH & ANTI-BAN */}
      {activeTab === "settings" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="space-y-4">
            <CardTitle className="flex items-center gap-2 text-base text-sky-400 font-bold">
              <ShieldCheck className="h-5 w-5" />
              Cơ Chế Bảo Vệ Nick Zalo (Anti-Ban Engine)
            </CardTitle>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p>
                Hệ thống Zalo Marketing đã được tích hợp bộ lọc và cơ chế điều tốc chuẩn chống quét spam của Zalo:
              </p>
              <ul className="list-disc pl-4 space-y-2 text-slate-400">
                <li>
                  <strong className="text-slate-200">Độ trễ ngẫu nhiên (Random Jitter):</strong> Giữa mỗi lượt gửi, bot tự động giãn cách ngẫu nhiên từ 25s – 45s (mô phỏng người thật thao tác).
                </li>
                <li>
                  <strong className="text-slate-200">AI Spin & Unique Hash:</strong> Mỗi tin nhắn gửi đi đều được AI làm mới cấu trúc câu, thay đổi lời chào và emoji để không trùng hash tin nhắn rác.
                </li>
                <li>
                  <strong className="text-slate-200">Kho Data lọc trước (Pre-Flight Filter):</strong> Tự động phát hiện và bỏ qua các số không dùng Zalo hoặc đã chặn người lạ, không tốn lượt gửi thử giúp nick không bị tính điểm vi phạm.
                </li>
                <li>
                  <strong className="text-slate-200">Cụm nhiều ảnh (Album Layout):</strong> Sử dụng tính năng groupMediaMsg của Zalo để gom toàn bộ ảnh thành 1 album duy nhất, tránh gửi rời rạc làm ngập tin nhắn khách hàng.
                </li>
              </ul>
            </div>
          </Card>

          <Card className="space-y-4">
            <CardTitle className="flex items-center gap-2 text-base text-amber-400 font-bold">
              <AlertCircle className="h-5 w-5" />
              Khuyến Nghị Vận Hành An Toàn
            </CardTitle>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-amber-200">
                <span className="font-semibold">Lưu ý giới hạn hàng ngày:</span> Đối với tài khoản Zalo cá nhân, nên gửi tối đa từ <strong>30 – 50 số lạ mỗi ngày</strong>. Không nên gửi quá 100 số/ngày để bảo vệ tài khoản sống lâu dài.
              </div>
              <p className="text-slate-400">
                Nếu cần tiếp cận lượng khách hàng lớn hơn, anh có thể chia danh sách thành nhiều chiến dịch chạy rải rác vào các khung giờ vàng trong ngày (09:00 - 11:30 sáng và 14:00 - 17:00 chiều).
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 1: TẠO CHIẾN DỊCH MỚI */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-sky-400" />
                Khởi Tạo Chiến Dịch Zalo Marketing
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Tên chiến dịch *</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Giới thiệu dự án Imperia - Khách hàng VIP"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Nội dung tin nhắn gốc *</label>
                  <button
                    type="button"
                    onClick={handleTestAiPreview}
                    className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 font-medium"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Thử nghiệm AI cá nhân hóa
                  </button>
                </div>
                <textarea
                  rows={4}
                  placeholder="Chào {gender_call} {name}, bên em đang có ưu đãi dự án mới... Liên hệ 0912345678"
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span>Biến hỗ trợ:</span>
                  <code className="text-sky-300 bg-slate-800 px-1 rounded">&#123;name&#125;</code> (Tên Zalo)
                  <code className="text-sky-300 bg-slate-800 px-1 rounded">&#123;gender_call&#125;</code> (Anh/Chị/Bác)
                  <code className="text-sky-300 bg-slate-800 px-1 rounded">&#123;phone&#125;</code> (Số điện thoại)
                  <code className="text-sky-300 bg-slate-800 px-1 rounded">&#123;sdob&#125;</code> (Ngày sinh nếu có)
                </div>
              </div>

              {/* Upload cụm ảnh */}
              <div>
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Hình ảnh đính kèm (Gửi dạng CỤM ALBUM nhiều ảnh)</span>
                  <span className="text-slate-400 font-normal">{uploadedImages.length} ảnh đã chọn</span>
                </label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {uploadedImages.map((imgPath, idx) => (
                    <div key={idx} className="relative rounded-lg border border-slate-700 bg-slate-800 p-1 text-[11px] text-slate-300 flex items-center gap-1.5">
                      <span className="truncate max-w-[120px]">{imgPath.split("/").pop()}</span>
                      <button
                        type="button"
                        onClick={() => setUploadedImages((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}

                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-600 bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800">
                    <Upload className="h-3.5 w-3.5 text-sky-400" />
                    {uploadingImages ? "Đang tải ảnh..." : "+ Thêm ảnh (1 hoặc nhiều ảnh)"}
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleUploadImages}
                      disabled={uploadingImages}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Danh sách SĐT */}
              <div>
                <label className="text-xs font-semibold text-slate-300">
                  Danh sách số điện thoại nhận tin * (Mỗi dòng 1 số hoặc kèm tên)
                </label>
                <textarea
                  rows={4}
                  placeholder={"0912345678, Nguyễn Văn A\n0987654321, Trần Thị B\n0901234567"}
                  value={createPhones}
                  onChange={(e) => setCreatePhones(e.target.value)}
                  className="mt-1 w-full font-mono rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              {/* Cấu hình Anti-ban */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="text-xs font-bold text-sky-400 uppercase tracking-wider">Cấu Hình Thông Minh & Anti-Ban</div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="text-slate-300 font-medium">Khoảng cách gửi tối thiểu (giây)</label>
                    <input
                      type="number"
                      min={10}
                      max={120}
                      value={minDelay}
                      onChange={(e) => setMinDelay(parseInt(e.target.value, 10) || 25)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-300 font-medium">Khoảng cách gửi tối đa (giây)</label>
                    <input
                      type="number"
                      min={minDelay}
                      max={180}
                      value={maxDelay}
                      onChange={(e) => setMaxDelay(parseInt(e.target.value, 10) || 45)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoAlias}
                      onChange={(e) => setAutoAlias(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    <span className="text-slate-200">
                      Tự động đổi tên gợi nhớ: <strong>Tên Zalo + SĐT</strong> ngay sau khi gửi thành công
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiRewrite}
                      onChange={(e) => setAiRewrite(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    <span className="text-slate-200">
                      Bật <strong>AI Viết lại chống spam</strong> (mỗi tin nhắn biến thể câu chữ độc nhất)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoFriend}
                      onChange={(e) => setAutoFriend(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    <span className="text-slate-200">Tự động gửi kèm lời mời kết bạn (chuyển tin vào hộp thư chính)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleCreateCampaign}
                disabled={creating}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50"
              >
                {creating ? "Đang khởi tạo & Lọc trước..." : "Khởi Tạo Chiến Dịch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: XEM THỬ AI CÁ NHÂN HÓA */}
      {showAiPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-2xl border border-sky-500/40 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-400" />
                Xem Thử Tin Nhắn AI Cá Nhân Hóa
              </h3>
              <button
                onClick={() => setShowAiPreviewModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400">Tên khách mẫu:</label>
                  <input
                    type="text"
                    value={previewSampleName}
                    onChange={(e) => setPreviewSampleName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400">Giới tính:</label>
                  <select
                    value={previewSampleGender}
                    onChange={(e) => setPreviewSampleGender(parseInt(e.target.value, 10))}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white"
                  >
                    <option value={1}>Nam (Anh)</option>
                    <option value={0}>Nữ (Chị)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400">Ngày sinh mẫu (sdob):</label>
                <input
                  type="text"
                  value={previewSampleSdob}
                  onChange={(e) => setPreviewSampleSdob(e.target.value)}
                  placeholder="15/08/1990"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold">Kết quả AI sinh tự nhiên:</label>
                <div className="mt-1 rounded-xl border border-sky-500/20 bg-slate-950 p-3.5 text-slate-200 leading-relaxed whitespace-pre-wrap min-h-[100px]">
                  {loadingAiPreview ? (
                    <div className="flex items-center justify-center py-6 text-sky-400 gap-2">
                      <Sparkles className="h-4 w-4 animate-spin" />
                      Gemini Flash-Lite đang cá nhân hóa tin nhắn...
                    </div>
                  ) : (
                    previewResult || "Chưa có kết quả"
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={handleTestAiPreview}
                disabled={loadingAiPreview}
                className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Sinh mẫu khác
              </button>
              <button
                type="button"
                onClick={() => setShowAiPreviewModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: NHẬP SĐT VÀO KHO DATA */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-400" />
                Nạp Danh Sách SĐT Vào Kho Data
              </h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-400">
                Nhập danh sách số điện thoại (mỗi dòng 1 số hoặc phân cách bằng dấu phẩy) để lưu vào kho danh bạ tập trung.
              </p>
              <textarea
                rows={6}
                placeholder={"0912345678\n0987654321\n0901234567"}
                value={importPhonesText}
                onChange={(e) => setImportPhonesText(e.target.value)}
                className="w-full font-mono rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleImportContacts}
                disabled={importing}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {importing ? "Đang nạp..." : "Lưu vào Kho Data"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
