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
  FolderPlus,
  Folder,
  Tag,
  FileEdit,
  Send,
  Copy,
  CheckSquare,
} from "lucide-react";
import { Card, CardTitle, Badge } from "@/components/ui";

interface ZaloMktCampaign {
  id: string;
  title: string;
  raw_content: string;
  images_json: string;
  status: "draft" | "running" | "paused" | "completed" | "stopped" | "scheduled";
  config_json: string;
  scheduled_at?: number | null;
  total_leads: number;
  sent_count: number;
  failed_count: number;
  not_found_count: number;
  skipped_count: number;
  created_at: number;
  updated_at: number;
}

interface ZaloMktContactGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: number;
  updated_at: number;
  member_count?: number;
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
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupFilterMode, setGroupFilterMode] = useState<"all" | "uncontacted" | "valid_only">("all");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleType, setScheduleType] = useState<"single" | "multi_slots">("single");
  const [scheduledDateTime, setScheduledDateTime] = useState("");
  const [scheduleSlots, setScheduleSlots] = useState<Array<{ time: string; batchSize: number }>>([
    { time: "09:00", batchSize: 50 },
    { time: "13:30", batchSize: 50 },
    { time: "18:00", batchSize: 50 },
  ]);
  const [minDelay, setMinDelay] = useState(25);
  const [maxDelay, setMaxDelay] = useState(45);
  const [autoAlias, setAutoAlias] = useState(true);
  const [autoFriend, setAutoFriend] = useState(false);
  const [aiRewrite, setAiRewrite] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [creating, setCreating] = useState(false);

  // State modal Sao Chép Chiến Dịch
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [campaignToCopy, setCampaignToCopy] = useState<ZaloMktCampaign | null>(null);
  const [copyTitle, setCopyTitle] = useState("");
  const [copyLeads, setCopyLeads] = useState(true);
  const [copying, setCopying] = useState(false);

  // State Modal Chỉnh Sửa Chiến Dịch
  const [showEditModal, setShowEditModal] = useState(false);
  const [campaignToEdit, setCampaignToEdit] = useState<ZaloMktCampaign | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editMinDelay, setEditMinDelay] = useState(30);
  const [editMaxDelay, setEditMaxDelay] = useState(60);
  const [editAutoAlias, setEditAutoAlias] = useState(true);
  const [editAutoFriend, setEditAutoFriend] = useState(false);
  const [editAiRewrite, setEditAiRewrite] = useState(false);
  const [editIsScheduled, setEditIsScheduled] = useState(false);
  const [editScheduleType, setEditScheduleType] = useState<"once" | "multi_slots">("once");
  const [editScheduledDateTime, setEditScheduledDateTime] = useState("");
  const [editScheduleSlots, setEditScheduleSlots] = useState<{ time: string; batchSize: number }[]>([
    { time: "09:00", batchSize: 50 },
    { time: "13:30", batchSize: 50 },
    { time: "18:00", batchSize: 50 },
  ]);
  const [editAdditionalPhones, setEditAdditionalPhones] = useState("");
  const [editSelectedGroupIds, setEditSelectedGroupIds] = useState<string[]>([]);
  const [editGroupFilterMode, setEditGroupFilterMode] = useState<"all" | "uncontacted" | "valid_only">("all");
  const [savingEdit, setSavingEdit] = useState(false);

  // State chọn và xóa SĐT trong Kho Data
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [deletingContacts, setDeletingContacts] = useState(false);

  // State Modal Quét Xác Minh Zalo (Pre-validation hub)
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyTargetGroupId, setVerifyTargetGroupId] = useState("all");
  const [verifyTask, setVerifyTask] = useState<any>(null);
  const [unverifiedCount, setUnverifiedCount] = useState(0);
  const [verifyingAction, setVerifyingAction] = useState(false);

  // State Modal Lượt Chạy (Batch Limit)
  const [runBatchCamp, setRunBatchCamp] = useState<ZaloMktCampaign | null>(null);
  const [runBatchAction, setRunBatchAction] = useState<"start" | "resume">("start");
  const [runBatchLimit, setRunBatchLimit] = useState<number>(30);

  // State AI preview modal
  const [showAiPreviewModal, setShowAiPreviewModal] = useState(false);
  const [previewSampleName, setPreviewSampleName] = useState("Nguyễn Văn A");
  const [previewSampleGender, setPreviewSampleGender] = useState(0); // 0: Nam, 1: Nữ
  const [previewSamplePhone, setPreviewSamplePhone] = useState("0912345678");
  const [previewSampleSdob, setPreviewSampleSdob] = useState("15/08/1990");
  const [previewResult, setPreviewResult] = useState("");
  const [loadingAiPreview, setLoadingAiPreview] = useState(false);

  // State chi tiết chiến dịch
  const [selectedCampaign, setSelectedCampaign] = useState<ZaloMktCampaign | null>(null);
  const [campaignLeads, setCampaignLeads] = useState<ZaloMktLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");

  // State kho contacts & nhóm
  const [contacts, setContacts] = useState<ZaloMktContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactStatusFilter, setContactStatusFilter] = useState("all");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState("all");
  const [contactTotal, setContactTotal] = useState(0);

  // State danh mục nhóm khách hàng
  const [groups, setGroups] = useState<ZaloMktContactGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("sky");
  const [creatingGroup, setCreatingGroup] = useState(false);

  // State gán SĐT vào nhóm
  const [showAddPhonesToGroupModal, setShowAddPhonesToGroupModal] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [groupPhonesText, setGroupPhonesText] = useState("");
  const [addingPhonesToGroup, setAddingPhonesToGroup] = useState(false);

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

  // Tải danh sách nhóm khách hàng
  const fetchGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const res = await fetch(`/api/zalomkt/groups?botId=${botId}`);
      const data = await res.json();
      if (data.ok) {
        setGroups(data.groups || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGroups(false);
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
        groupId: selectedGroupFilter,
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
  }, [botId, contactSearch, contactStatusFilter, selectedGroupFilter]);

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
    fetchGroups();
  }, [fetchCampaigns, fetchGroups]);

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

  // Tạo nhóm khách hàng mới
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("Vui lòng nhập tên nhóm khách hàng");
    setCreatingGroup(true);
    try {
      const res = await fetch("/api/zalomkt/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          name: newGroupName,
          description: newGroupDesc,
          color: newGroupColor,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewGroupName("");
        setNewGroupDesc("");
        setShowCreateGroupModal(false);
        fetchGroups();
      } else {
        alert("Lỗi tạo nhóm: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi: " + String(err));
    } finally {
      setCreatingGroup(false);
    }
  };

  // Xóa nhóm khách hàng
  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa nhóm "${groupName}"? Các số điện thoại trong danh bạ sẽ không bị xóa.`)) return;
    try {
      const res = await fetch(`/api/zalomkt/groups?id=${groupId}&botId=${botId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        if (selectedGroupFilter === groupId) setSelectedGroupFilter("all");
        fetchGroups();
        fetchContacts();
      } else {
        alert("Lỗi xóa nhóm: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi xóa nhóm: " + String(err));
    }
  };

  // Thêm danh sách số vào nhóm
  const handleAddPhonesToGroup = async () => {
    if (!targetGroupId) return alert("Vui lòng chọn nhóm cần thêm");
    if (!groupPhonesText.trim()) return alert("Vui lòng nhập ít nhất 1 số điện thoại");
    setAddingPhonesToGroup(true);
    try {
      const res = await fetch("/api/zalomkt/groups/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          groupId: targetGroupId,
          rawPhones: groupPhonesText,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ Đã thêm ${data.added} số mới vào nhóm! (Tổng thành viên nhóm: ${data.total})`);
        setShowAddPhonesToGroupModal(false);
        setGroupPhonesText("");
        fetchGroups();
        fetchContacts();
      } else {
        alert("Lỗi: " + data.error);
      }
    } catch (err: any) {
      alert("Lỗi: " + String(err));
    } finally {
      setAddingPhonesToGroup(false);
    }
  };

  // Xử lý tạo chiến dịch (hỗ trợ Chạy ngay, Lưu bản nháp, Lên lịch hẹn giờ)
  const handleCreateCampaign = async (mode: "run_now" | "save_draft" | "schedule") => {
    if (!createTitle.trim()) return alert("Vui lòng nhập tên chiến dịch");
    if (!createContent.trim()) return alert("Vui lòng nhập nội dung tin nhắn");
    if (!createPhones.trim() && selectedGroupIds.length === 0) {
      return alert("Vui lòng nhập danh sách số điện thoại hoặc tick chọn ít nhất 1 nhóm khách hàng");
    }

    let scheduledAt: number | null = null;
    let isDraft = false;

    if (mode === "schedule") {
      if (scheduleType === "multi_slots") {
        if (!scheduleSlots || scheduleSlots.length === 0) {
          return alert("Vui lòng thiết lập ít nhất 1 ca chạy trong ngày");
        }
        // Tính mốc ca chạy sắp tới đầu tiên
        const now = new Date();
        const sorted = [...scheduleSlots].sort((a, b) => a.time.localeCompare(b.time));
        const curMins = now.getHours() * 60 + now.getMinutes();
        let targetSlot = sorted.find((s) => {
          const [h, m] = s.time.split(":").map(Number);
          return h * 60 + m > curMins;
        });
        const targetDate = new Date();
        if (targetSlot) {
          const [h, m] = targetSlot.time.split(":").map(Number);
          targetDate.setHours(h, m, 0, 0);
        } else {
          targetSlot = sorted[0];
          const [h, m] = targetSlot.time.split(":").map(Number);
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(h, m, 0, 0);
        }
        scheduledAt = targetDate.getTime();
      } else {
        if (!scheduledDateTime) {
          return alert("Vui lòng chọn ngày và giờ hẹn chạy chiến dịch");
        }
        const schedTime = new Date(scheduledDateTime).getTime();
        if (isNaN(schedTime) || schedTime <= Date.now()) {
          return alert("Thời gian hẹn giờ phải ở tương lai so với hiện tại");
        }
        scheduledAt = schedTime;
      }
    } else if (mode === "save_draft") {
      isDraft = true;
    }

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
          groupIds: selectedGroupIds,
          groupFilterMode: selectedGroupIds.length > 0 ? groupFilterMode : "all",
          scheduledAt,
          isDraft,
          config: {
            minDelay: minDelay * 1000,
            maxDelay: maxDelay * 1000,
            autoAlias,
            autoFriend,
            aiRewrite,
            scheduleSlots: isScheduled && scheduleType === "multi_slots" ? scheduleSlots : undefined,
            batchLimit: isScheduled && scheduleType === "multi_slots" ? scheduleSlots[0]?.batchSize : undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        let msg = `🎉 Tạo chiến dịch thành công!\n- Tổng số nhận diện: ${data.totalLeads}\n- Tự động bỏ qua (Pre-flight Filter): ${data.skippedLeads} số chết/chặn`;
        if (mode === "run_now") {
          await handleControlCampaign(data.id, "start");
          msg += "\n- Trạng thái: Đang bắt đầu gửi ngay!";
        } else if (mode === "schedule") {
          if (scheduleType === "multi_slots") {
            msg += `\n- Trạng thái: Đã lên lịch chạy đa khung giờ (${scheduleSlots.map((s) => `${s.time}: ${s.batchSize} số`).join(", ")})`;
          } else {
            msg += `\n- Trạng thái: Đã lên lịch hẹn lúc ${new Date(scheduledAt!).toLocaleString("vi-VN")}`;
          }
        } else {
          msg += "\n- Trạng thái: Đã lưu bản nháp an toàn.";
        }
        alert(msg);
        setShowCreateModal(false);
        setCreateTitle("");
        setCreateContent("");
        setCreatePhones("");
        setSelectedGroupIds([]);
        setIsScheduled(false);
        setScheduledDateTime("");
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

  // Mở modal Sao Chép Chiến Dịch
  const handleOpenCopyModal = (camp: ZaloMktCampaign) => {
    setCampaignToCopy(camp);
    setCopyTitle(`${camp.title} (Bản sao)`);
    setCopyLeads(true);
    setShowCopyModal(true);
  };

  // Xác nhận sao chép chiến dịch
  const handleConfirmCopy = async () => {
    if (!campaignToCopy) return;
    if (!copyTitle.trim()) return alert("Vui lòng nhập tên cho chiến dịch mới");

    setCopying(true);
    try {
      const res = await fetch("/api/zalomkt/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "copy",
          sourceCampaignId: campaignToCopy.id,
          title: copyTitle.trim(),
          copyLeads,
          botId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`🎉 Nhân bản chiến dịch thành công!\n- Tên mới: ${copyTitle}\n- Số lượng leads sao chép: ${data.totalLeads || 0}`);
        setShowCopyModal(false);
        setCampaignToCopy(null);
        fetchCampaigns();
      } else {
        alert("Lỗi sao chép: " + (data.error || "Không xác định"));
      }
    } catch (err: any) {
      alert("Lỗi kết nối: " + String(err?.message || err));
    } finally {
      setCopying(false);
    }
  };

  // Mở modal Chỉnh Sửa Chiến Dịch
  const handleOpenEditModal = (camp: ZaloMktCampaign) => {
    setCampaignToEdit(camp);
    setEditTitle(camp.title);
    setEditContent(camp.raw_content);
    try {
      setEditImages(JSON.parse(camp.images_json || "[]"));
    } catch {
      setEditImages([]);
    }

    let config: any = {};
    try {
      config = JSON.parse(camp.config_json || "{}");
    } catch {}

    setEditMinDelay(Math.round((config.minDelay || 30000) / 1000));
    setEditMaxDelay(Math.round((config.maxDelay || 60000) / 1000));
    setEditAutoAlias(config.autoAlias !== false);
    setEditAutoFriend(Boolean(config.autoFriend));
    setEditAiRewrite(Boolean(config.aiRewrite));

    if (config.scheduleSlots && config.scheduleSlots.length > 0) {
      setEditIsScheduled(true);
      setEditScheduleType("multi_slots");
      setEditScheduleSlots(config.scheduleSlots);
    } else if (camp.scheduled_at && camp.scheduled_at > Date.now()) {
      setEditIsScheduled(true);
      setEditScheduleType("once");
      const d = new Date(camp.scheduled_at);
      const pad = (n: number) => n.toString().padStart(2, "0");
      setEditScheduledDateTime(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setEditIsScheduled(false);
      setEditScheduleType("once");
      setEditScheduledDateTime("");
    }

    setEditAdditionalPhones("");
    setEditSelectedGroupIds([]);
    setEditGroupFilterMode("all");
    setShowEditModal(true);
  };

  // Lưu chỉnh sửa chiến dịch
  const handleSaveEdit = async () => {
    if (!campaignToEdit) return;
    if (!editTitle.trim()) return alert("Vui lòng nhập tên chiến dịch");
    if (!editContent.trim()) return alert("Vui lòng nhập nội dung tin nhắn");

    let scheduledAt: number | null = null;
    if (editIsScheduled) {
      if (editScheduleType === "multi_slots") {
        if (!editScheduleSlots || editScheduleSlots.length === 0) {
          return alert("Vui lòng cấu hình ít nhất 1 ca chạy trong ngày");
        }
        const now = new Date();
        const sorted = [...editScheduleSlots].sort((a, b) => a.time.localeCompare(b.time));
        const curMins = now.getHours() * 60 + now.getMinutes();
        let targetSlot = sorted.find((s) => {
          const [h, m] = s.time.split(":").map(Number);
          return h * 60 + m > curMins;
        });
        const targetDate = new Date();
        if (targetSlot) {
          const [h, m] = targetSlot.time.split(":").map(Number);
          targetDate.setHours(h, m, 0, 0);
        } else {
          targetSlot = sorted[0];
          const [h, m] = targetSlot.time.split(":").map(Number);
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(h, m, 0, 0);
        }
        scheduledAt = targetDate.getTime();
      } else {
        if (!editScheduledDateTime) {
          return alert("Vui lòng chọn ngày và giờ hẹn chạy");
        }
        const schedTime = new Date(editScheduledDateTime).getTime();
        if (isNaN(schedTime) || schedTime <= Date.now()) {
          return alert("Thời gian hẹn giờ phải ở tương lai so với hiện tại");
        }
        scheduledAt = schedTime;
      }
    } else {
      scheduledAt = null;
    }

    setSavingEdit(true);
    try {
      const res = await fetch(`/api/zalomkt/campaigns/${campaignToEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          title: editTitle.trim(),
          rawContent: editContent.trim(),
          images: editImages,
          scheduledAt,
          rawPhones: editAdditionalPhones.trim() || undefined,
          groupIds: editSelectedGroupIds.length > 0 ? editSelectedGroupIds : undefined,
          groupFilterMode: editSelectedGroupIds.length > 0 ? editGroupFilterMode : "all",
          config: {
            minDelay: editMinDelay * 1000,
            maxDelay: editMaxDelay * 1000,
            autoAlias: editAutoAlias,
            autoFriend: editAutoFriend,
            aiRewrite: editAiRewrite,
            scheduleSlots: editIsScheduled && editScheduleType === "multi_slots" ? editScheduleSlots : undefined,
            batchLimit: editIsScheduled && editScheduleType === "multi_slots" ? editScheduleSlots[0]?.batchSize : undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        let msg = `✅ Đã lưu cập nhật chiến dịch thành công!`;
        if (data.newLeadsAdded > 0) {
          msg += `\nĐã bổ sung thêm ${data.newLeadsAdded} số điện thoại mới vào chiến dịch.`;
        }
        alert(msg);
        setShowEditModal(false);
        setCampaignToEdit(null);
        fetchCampaigns();
      } else {
        alert("Lỗi lưu cập nhật: " + (data.error || "Không rõ nguyên nhân"));
      }
    } catch (err: any) {
      alert("Lỗi kết nối: " + String(err));
    } finally {
      setSavingEdit(false);
    }
  };

  // Chọn & Bỏ chọn SĐT
  const toggleSelectPhone = (phone: string) => {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const isAllPageSelected = contacts.length > 0 && contacts.every((c) => selectedPhones.has(c.phone));

  const toggleSelectAllPage = () => {
    if (isAllPageSelected) {
      setSelectedPhones((prev) => {
        const next = new Set(prev);
        contacts.forEach((c) => next.delete(c.phone));
        return next;
      });
    } else {
      setSelectedPhones((prev) => {
        const next = new Set(prev);
        contacts.forEach((c) => next.add(c.phone));
        return next;
      });
    }
  };

  const clearSelectedPhones = () => {
    setSelectedPhones(new Set());
  };

  // Xóa danh sách SĐT đã chọn
  const handleDeleteSelectedContacts = async () => {
    if (selectedPhones.size === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa ${selectedPhones.size} số điện thoại đã chọn khỏi Kho Data không?\nThao tác này sẽ xóa vĩnh viễn khỏi danh bạ và các nhóm!`)) return;

    setDeletingContacts(true);
    try {
      const res = await fetch("/api/zalomkt/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          phones: Array.from(selectedPhones),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ Đã xóa thành công ${data.deletedCount} số điện thoại.`);
        clearSelectedPhones();
        fetchContacts();
      } else {
        alert("Lỗi khi xóa: " + (data.error || "Không xác định"));
      }
    } catch (err: any) {
      alert("Lỗi kết nối: " + String(err));
    } finally {
      setDeletingContacts(false);
    }
  };

  // Xóa 1 SĐT đơn lẻ
  const handleDeleteSingleContact = async (phone: string) => {
    if (!confirm(`Bạn có chắc muốn xóa số điện thoại ${phone} khỏi Kho Data?`)) return;

    setDeletingContacts(true);
    try {
      const res = await fetch("/api/zalomkt/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          phones: [phone],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSelectedPhones((prev) => {
          const next = new Set(prev);
          next.delete(phone);
          return next;
        });
        fetchContacts();
      } else {
        alert("Lỗi khi xóa: " + (data.error || ""));
      }
    } catch (err: any) {
      alert("Lỗi: " + String(err));
    } finally {
      setDeletingContacts(false);
    }
  };

  // Xóa tất cả SĐT theo bộ lọc hiện tại hoặc toàn bộ kho
  const handleDeleteAllFilteredContacts = async () => {
    const scopeLabel = selectedGroupFilter !== "all"
      ? `tất cả ${contactTotal} số trong nhóm này`
      : (contactSearch || contactStatusFilter !== "all"
        ? `tất cả ${contactTotal} số thỏa mãn bộ lọc hiện tại`
        : `toàn bộ ${contactTotal} số trong Kho Data`);

    if (!confirm(`⚠️ CẢNH BÁO QUAN TRỌNG:\nBạn có chắc chắn muốn xóa ${scopeLabel} không?\nToàn bộ danh bạ trong phạm vi này sẽ bị xóa vĩnh viễn khỏi hệ thống!`)) return;

    setDeletingContacts(true);
    try {
      const res = await fetch("/api/zalomkt/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId,
          deleteAll: true,
          filter: {
            search: contactSearch,
            status: contactStatusFilter,
            groupId: selectedGroupFilter,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ Đã xóa sạch ${data.deletedCount} số điện thoại.`);
        clearSelectedPhones();
        fetchContacts();
      } else {
        alert("Lỗi khi xóa: " + (data.error || ""));
      }
    } catch (err: any) {
      alert("Lỗi: " + String(err));
    } finally {
      setDeletingContacts(false);
    }
  };


  // Tải trạng thái tác vụ quét kiểm tra SĐT Zalo
  const fetchVerifyStatus = useCallback(async () => {
    try {
      const gId = verifyTargetGroupId === "all" ? "" : verifyTargetGroupId;
      const res = await fetch(`/api/zalomkt/contacts/verify?groupId=${gId}&botId=${botId}`);
      const data = await res.json();
      if (data.ok) {
        setVerifyTask(data.task || null);
        setUnverifiedCount(data.unverifiedCount || 0);
      }
    } catch (e) {
      console.error(e);
    }
  }, [botId, verifyTargetGroupId]);

  // Mở modal quét kiểm tra Zalo
  const handleOpenVerifyModal = () => {
    setShowVerifyModal(true);
    fetchVerifyStatus();
  };

  // Bắt đầu quét kiểm tra Zalo
  const handleStartVerification = async () => {
    setVerifyingAction(true);
    try {
      const gId = verifyTargetGroupId === "all" ? "" : verifyTargetGroupId;
      const res = await fetch("/api/zalomkt/contacts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          groupId: gId,
          botId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(data.message || "Đã khởi chạy tác vụ quét kiểm tra!");
        fetchVerifyStatus();
        fetchContacts();
      } else {
        alert("Lỗi: " + (data.error || "Không thể khởi chạy"));
      }
    } catch (err: any) {
      alert("Lỗi kết nối: " + String(err));
    } finally {
      setVerifyingAction(false);
    }
  };

  // Dừng quét kiểm tra Zalo
  const handleStopVerification = async () => {
    setVerifyingAction(true);
    try {
      const res = await fetch("/api/zalomkt/contacts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          botId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        alert("Đã dừng tác vụ quét kiểm tra.");
        fetchVerifyStatus();
      }
    } catch (err: any) {
      alert("Lỗi kết nối: " + String(err));
    } finally {
      setVerifyingAction(false);
    }
  };

  // Điều khiển chiến dịch (Start, Pause, Resume, Stop)
  const handleControlCampaign = async (
    id: string,
    action: "start" | "pause" | "resume" | "stop",
    batchLimit?: number,
  ) => {
    try {
      const res = await fetch(`/api/zalomkt/campaigns/${id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, action, batchLimit }),
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

  const openRunBatchModal = (camp: ZaloMktCampaign, action: "start" | "resume") => {
    let campConfig: any = {};
    try {
      campConfig = JSON.parse(camp.config_json || "{}");
    } catch {}
    const defaultLimit = typeof campConfig.batchLimit === "number" && campConfig.batchLimit > 0
      ? campConfig.batchLimit
      : 30;
    setRunBatchLimit(defaultLimit);
    setRunBatchAction(action);
    setRunBatchCamp(camp);
  };

  const confirmRunBatch = async () => {
    if (!runBatchCamp) return;
    const limit = Math.max(0, runBatchLimit);
    await handleControlCampaign(runBatchCamp.id, runBatchAction, limit);
    setRunBatchCamp(null);
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
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenVerifyModal}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 hover:from-purple-500 hover:to-indigo-500 transition-all"
                title="Quét tự động trạng thái Zalo trước khi chạy (Pre-validation hub)"
              >
                <Search className="h-4 w-4" />
                Quét Kiểm Tra Zalo
              </button>

              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 transition-all"
              >
                <Plus className="h-4 w-4" />
                Nhập Data SĐT
              </button>
            </div>
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
                                : camp.status === "scheduled"
                                ? "default"
                                : "muted"
                            }
                            className={camp.status === "scheduled" ? "bg-sky-500/20 text-sky-300 border border-sky-500/30" : undefined}
                          >
                            {camp.status === "running" && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400 animate-ping" />}
                            {camp.status === "scheduled" && <Clock className="mr-1 inline-block h-3 w-3 text-sky-400" />}
                            {camp.status === "running"
                              ? "Đang chạy"
                              : camp.status === "scheduled"
                              ? `Hẹn giờ (${camp.scheduled_at ? new Date(camp.scheduled_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) + " " + new Date(camp.scheduled_at).toLocaleDateString("vi-VN") : "Sắp chạy"})`
                              : camp.status === "paused"
                              ? "Tạm dừng"
                              : camp.status === "completed"
                              ? "Đã hoàn thành"
                              : camp.status === "stopped"
                              ? "Đã dừng"
                              : "Bản nháp"}
                          </Badge>
                        </div>
                        {(() => {
                          let campConfig: any = {};
                          try {
                            campConfig = JSON.parse(camp.config_json || "{}");
                          } catch {}
                          const batchLimit = campConfig.batchLimit;
                          const runSentCount = campConfig.runSentCount || 0;
                          return (
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
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
                              {typeof batchLimit === "number" && batchLimit > 0 && (
                                <>
                                  <span>•</span>
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                    camp.status === "paused" && runSentCount >= batchLimit
                                      ? "bg-amber-950/80 text-amber-300 border-amber-500/40"
                                      : "bg-indigo-950/80 text-indigo-300 border-indigo-500/40"
                                  }`}>
                                    🎯 Lượt này: <strong>{runSentCount}/{batchLimit}</strong> tin
                                    {camp.status === "paused" && runSentCount >= batchLimit ? " (Đã đạt định mức)" : ""}
                                  </span>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Nút hành động */}
                      <div className="flex items-center gap-2">
                        {(camp.status === "draft" || camp.status === "scheduled") && (
                          <button
                            onClick={() => openRunBatchModal(camp, "start")}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors"
                          >
                            <Play className="h-3.5 w-3.5" />
                            {camp.status === "scheduled" ? "Chạy ngay (Bỏ hẹn)" : "Bắt đầu gửi"}
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
                              onClick={() => openRunBatchModal(camp, "resume")}
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
                          onClick={() => handleOpenCopyModal(camp)}
                          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors"
                          title="Sao chép / Nhân bản chiến dịch"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Sao chép
                        </button>

                        <button
                          onClick={() => handleOpenEditModal(camp)}
                          className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors"
                          title="Chỉnh sửa thông tin & cấu hình chiến dịch"
                        >
                          <FileEdit className="h-3.5 w-3.5" />
                          Chỉnh sửa
                        </button>

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
                            {lead.gender === 0 ? (
                              <span className="text-sky-400 font-medium">Nam</span>
                            ) : lead.gender === 1 ? (
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

      {/* 4. NỘI DUNG TAB 2: KHO DATA SĐT TOÀN CỤC & PHÂN NHÓM */}
      {activeTab === "contacts" && (
        <div className="space-y-4">
          {/* Thanh danh mục nhóm khách hàng */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 backdrop-blur-md space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-sky-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Phân Nhóm Dữ Liệu Khách Hàng ({groups.length} nhóm)
                </h4>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateGroupModal(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 transition-colors"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  + Tạo Nhóm Mới
                </button>
                {groups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!targetGroupId && groups[0]) setTargetGroupId(groups[0].id);
                      setShowAddPhonesToGroupModal(true);
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    + Thêm SĐT Vào Nhóm
                  </button>
                )}
              </div>
            </div>

            {/* Danh sách chips lọc theo nhóm */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectedGroupFilter("all")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                  selectedGroupFilter === "all"
                    ? "bg-sky-500 text-white shadow-sm"
                    : "bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                <span>Tất cả số</span>
                <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px]">{contactTotal}</span>
              </button>

              {groups.map((grp) => (
                <div
                  key={grp.id}
                  className={`group relative flex items-center rounded-lg border transition-all ${
                    selectedGroupFilter === grp.id
                      ? "border-sky-500 bg-sky-500/20 text-sky-200"
                      : "border-slate-800 bg-slate-800/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedGroupFilter(grp.id)}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium"
                  >
                    <Tag className="h-3 w-3 text-sky-400" />
                    <span>{grp.name}</span>
                    <span className="rounded-full bg-slate-900/80 px-1.5 py-0.2 text-[10px] text-slate-300">
                      {grp.member_count || 0}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(grp.id, grp.name);
                    }}
                    title="Xóa nhóm"
                    className="pr-2 pl-0.5 text-slate-500 opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Thanh tìm kiếm & lọc trạng thái */}
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

            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-400">
                {selectedGroupFilter !== "all" ? (
                  <>Số trong nhóm: <strong className="text-sky-400">{contactTotal}</strong></>
                ) : (
                  <>Tổng số trong kho: <strong className="text-sky-400">{contactTotal}</strong> số</>
                )}
              </div>

              {contactTotal > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteAllFilteredContacts}
                  disabled={deletingContacts}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                  title="Xóa tất cả số theo phạm vi bộ lọc đang chọn"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa tất cả ({contactTotal})
                </button>
              )}
            </div>
          </div>

          {/* Thanh công cụ chọn & xóa hàng loạt khi có SĐT được tick chọn */}
          {selectedPhones.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-2.5 backdrop-blur-md animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                <CheckSquare className="h-4 w-4 text-rose-400" />
                <span>
                  Đã chọn <strong className="text-white font-bold">{selectedPhones.size}</strong> / {contacts.length} số trên trang này
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearSelectedPhones}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                >
                  Bỏ chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedContacts}
                  disabled={deletingContacts}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-500 transition-colors shadow-lg shadow-rose-950/50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingContacts ? "Đang xóa..." : `Xóa ${selectedPhones.size} số đã chọn`}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-md">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      onChange={toggleSelectAllPage}
                      className="rounded border-slate-700 bg-slate-850 text-sky-500 focus:ring-0 cursor-pointer"
                      title="Chọn / Bỏ chọn toàn bộ trang này"
                    />
                  </th>
                  <th className="p-3">Số Điện Thoại</th>
                  <th className="p-3">Tên Hiển Thị Zalo</th>
                  <th className="p-3">Giới Tính</th>
                  <th className="p-3">Ngày Sinh (sdob)</th>
                  <th className="p-3">Trạng Thái Zalo</th>
                  <th className="p-3">Số Chiến Dịch</th>
                  <th className="p-3">Lần Cuối Gửi</th>
                  <th className="p-3 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/30">
                {loadingContacts ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      Đang tải danh bạ khách hàng...
                    </td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      Chưa có số điện thoại nào trong kho dữ liệu.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c) => (
                    <tr
                      key={c.phone}
                      className={`hover:bg-slate-900/40 transition-colors ${
                        selectedPhones.has(c.phone) ? "bg-rose-950/10" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedPhones.has(c.phone)}
                          onChange={() => toggleSelectPhone(c.phone)}
                          className="rounded border-slate-700 bg-slate-850 text-sky-500 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="p-3 font-mono font-medium text-slate-200">{c.phone}</td>
                      <td className="p-3">
                        <div className="font-semibold text-white">{c.display_name || c.zalo_name || "-"}</div>
                        {c.bio && <div className="text-[10px] text-slate-400 italic truncate max-w-xs">{c.bio}</div>}
                      </td>
                      <td className="p-3">
                        {c.gender === 0 ? (
                          <span className="text-sky-400 font-medium">Nam</span>
                        ) : c.gender === 1 ? (
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
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteSingleContact(c.phone)}
                          disabled={deletingContacts}
                          className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title={`Xóa số ${c.phone} khỏi kho data`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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

              {/* Nạp nhanh từ Nhóm Khách Hàng */}
              {groups.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Folder className="h-3.5 w-3.5 text-sky-400" />
                      Nạp nhanh từ Nhóm Khách Hàng ({groups.length} nhóm có sẵn)
                    </label>
                    {selectedGroupIds.length > 0 && (
                      <span className="text-[11px] text-sky-400 font-medium">
                        Đã chọn {selectedGroupIds.length} nhóm (ước tính: {groups.filter((g) => selectedGroupIds.includes(g.id)).reduce((acc, g) => acc + (g.member_count || 0), 0)} số)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {groups.map((grp) => {
                      const isSelected = selectedGroupIds.includes(grp.id);
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => {
                            setSelectedGroupIds((prev) =>
                              isSelected ? prev.filter((id) => id !== grp.id) : [...prev, grp.id],
                            );
                          }}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                            isSelected
                              ? "border-sky-500 bg-sky-500/20 text-sky-200 shadow-sm"
                              : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                          }`}
                        >
                          <span className={`inline-block h-2 w-2 rounded-full ${isSelected ? "bg-sky-400" : "bg-slate-600"}`} />
                          <span>{grp.name}</span>
                          <span className="rounded-full bg-slate-950 px-1.5 py-0.2 text-[10px] text-slate-400">
                            {grp.member_count || 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Bộ lọc phân loại số trong nhóm */}
                  {selectedGroupIds.length > 0 && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-800">
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                        Phân loại dữ liệu SĐT nạp từ các nhóm đã chọn:
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setGroupFilterMode("all")}
                          className={`p-2 rounded-lg border text-left text-xs transition-all ${
                            groupFilterMode === "all"
                              ? "border-sky-500 bg-sky-500/20 text-sky-200"
                              : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          <div className="font-semibold text-sky-400">Toàn bộ nhóm</div>
                          <div className="text-[10px] text-slate-400">Nạp tất cả số có trong nhóm</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setGroupFilterMode("uncontacted")}
                          className={`p-2 rounded-lg border text-left text-xs transition-all ${
                            groupFilterMode === "uncontacted"
                              ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                              : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          <div className="font-semibold text-emerald-400">Chưa từng gửi tin</div>
                          <div className="text-[10px] text-slate-400">Chỉ số chưa chạy chiến dịch nào</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setGroupFilterMode("valid_only")}
                          className={`p-2 rounded-lg border text-left text-xs transition-all ${
                            groupFilterMode === "valid_only"
                              ? "border-purple-500 bg-purple-500/20 text-purple-200"
                              : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          <div className="font-semibold text-purple-400">Chỉ số có Zalo</div>
                          <div className="text-[10px] text-slate-400">Đã xác minh Valid trước đó</div>
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500">
                    * Các số điện thoại từ các nhóm được chọn sẽ tự động gộp và loại bỏ trùng lặp với danh sách bên dưới.
                  </p>
                </div>
              )}

              {/* Danh sách SĐT nhập tay hoặc paste */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Danh sách số điện thoại nhập thêm (Mỗi dòng 1 số hoặc kèm tên, tùy chọn nếu đã chọn nhóm)
                  </label>
                  <span className="text-[11px] text-emerald-400">
                    Tự bóc tách đa số & đổi 11 số sang 10 số
                  </span>
                </div>
                <textarea
                  rows={3}
                  placeholder={"0908120591 - 09888123456 Anh Tuấn\n0912345678, Nguyễn Văn A\n01681234567 (Tự đổi sang 0381234567)"}
                  value={createPhones}
                  onChange={(e) => setCreatePhones(e.target.value)}
                  className="mt-1 w-full font-mono rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  💡 Hỗ trợ dán dữ liệu tự do: nhận diện dòng chứa 2 số (VD: <code className="text-sky-300">0908120591 - 09888123456</code>), tự bóc tách tên khách hàng và tự động chuẩn hóa đầu số 11 số cũ của các nhà mạng về 10 số mới.
                </p>
              </div>

              {/* Hẹn giờ chạy chiến dịch */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-sky-400 uppercase tracking-wider">
                    <input
                      type="checkbox"
                      checked={isScheduled}
                      onChange={(e) => setIsScheduled(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    <Clock className="h-4 w-4" />
                    Lên Lịch Hẹn Giờ Gửi Tự Động
                  </label>
                  {isScheduled && (
                    <span className="text-[11px] text-amber-400 font-medium">
                      Hệ thống tự động kích hoạt khi đến giờ hẹn
                    </span>
                  )}
                </div>

                {isScheduled && (
                  <div className="space-y-3 pt-1">
                    {/* Chọn chế độ hẹn giờ: 1 lần hoặc theo ca */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setScheduleType("single")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          scheduleType === "single"
                            ? "border-sky-500 bg-sky-500/20 text-sky-300"
                            : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Hẹn giờ 1 lần
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduleType("multi_slots")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          scheduleType === "multi_slots"
                            ? "border-amber-500 bg-amber-500/20 text-amber-300"
                            : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Chạy theo ca trong ngày (Multi-slot Batching)
                      </button>
                    </div>

                    {scheduleType === "single" ? (
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-300 font-medium">Chọn ngày & giờ bắt đầu gửi:</label>
                        <input
                          type="datetime-local"
                          value={scheduledDateTime}
                          onChange={(e) => setScheduledDateTime(e.target.value)}
                          className="w-full rounded-xl border border-sky-500/40 bg-slate-900 px-3.5 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-300">
                            Các ca chạy trong ngày (Tự ngắt nghỉ giữa các ca để bảo vệ nick):
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setScheduleSlots((prev) => [...prev, { time: "20:00", batchSize: 50 }])
                            }
                            className="text-xs text-sky-400 hover:text-sky-300 font-medium"
                          >
                            + Thêm ca
                          </button>
                        </div>
                        <div className="space-y-2">
                          {scheduleSlots.map((slot, idx) => (
                            <div key={idx} className="flex items-center gap-3 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                              <span className="text-xs text-slate-400 w-12 font-medium">Ca {idx + 1}:</span>
                              <div className="flex items-center gap-1.5">
                                <label className="text-[11px] text-slate-400">Giờ:</label>
                                <input
                                  type="time"
                                  value={slot.time}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setScheduleSlots((prev) =>
                                      prev.map((s, i) => (i === idx ? { ...s, time: val } : s)),
                                    );
                                  }}
                                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <label className="text-[11px] text-slate-400">Số lượng:</label>
                                <input
                                  type="number"
                                  min={10}
                                  max={200}
                                  value={slot.batchSize}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10) || 50;
                                    setScheduleSlots((prev) =>
                                      prev.map((s, i) => (i === idx ? { ...s, batchSize: val } : s)),
                                    );
                                  }}
                                  className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                                />
                                <span className="text-[11px] text-slate-400">số</span>
                              </div>
                              {scheduleSlots.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setScheduleSlots((prev) => prev.filter((_, i) => i !== idx))}
                                  className="ml-auto text-rose-400 hover:text-rose-300 text-xs p-1"
                                  title="Xóa ca"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-slate-400">
                          * Ví dụ: 09:00 chạy 50 số, 13:30 chạy 50 số, 18:00 chạy 50 số. Sau mỗi ca bot sẽ tự chuyển sang trạng thái chờ ca tiếp theo.
                        </p>
                      </div>
                    )}
                  </div>
                )}
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

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Hủy bỏ
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCreateCampaign("save_draft")}
                  disabled={creating}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  <FileEdit className="h-3.5 w-3.5 text-slate-400" />
                  Lưu Bản Nháp
                </button>

                {isScheduled ? (
                  <button
                    type="button"
                    onClick={() => handleCreateCampaign("schedule")}
                    disabled={creating}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50 transition-all"
                  >
                    <Clock className="h-4 w-4" />
                    {creating ? "Đang lên lịch..." : "Lên Lịch Hẹn Giờ"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCreateCampaign("run_now")}
                    disabled={creating}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 transition-all"
                  >
                    <Send className="h-4 w-4" />
                    {creating ? "Đang khởi tạo & Lọc..." : "Bắt Đầu Gửi Ngay"}
                  </button>
                )}
              </div>
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
                    <option value={0}>Nam (Anh)</option>
                    <option value={1}>Nữ (Chị)</option>
                    <option value={-1}>Chưa rõ (Anh/Chị)</option>
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

      {/* MODAL 4: TẠO NHÓM KHÁCH HÀNG MỚI */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-sky-400" />
                Tạo Nhóm Khách Hàng Mới
              </h3>
              <button
                onClick={() => setShowCreateGroupModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-slate-300 font-semibold">Tên nhóm *</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Khách dự án The Privia, Đội Sale..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold">Mô tả nhóm (Tùy chọn)</label>
                <input
                  type="text"
                  placeholder="Ghi chú phân loại nhóm khách hàng..."
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold">Màu đại diện</label>
                <div className="mt-1.5 flex gap-2">
                  {[
                    { id: "sky", bg: "bg-sky-500" },
                    { id: "emerald", bg: "bg-emerald-500" },
                    { id: "indigo", bg: "bg-indigo-500" },
                    { id: "rose", bg: "bg-rose-500" },
                    { id: "amber", bg: "bg-amber-500" },
                    { id: "purple", bg: "bg-purple-500" },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setNewGroupColor(c.id)}
                      className={`h-6 w-6 rounded-full ${c.bg} transition-transform ${
                        newGroupColor === c.id ? "ring-2 ring-white scale-110" : "opacity-60 hover:opacity-100"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowCreateGroupModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={creatingGroup}
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {creatingGroup ? "Đang tạo..." : "Tạo Nhóm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: THÊM SĐT VÀO NHÓM */}
      {showAddPhonesToGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Tag className="h-4 w-4 text-emerald-400" />
                Thêm SĐT Vào Nhóm Khách Hàng
              </h3>
              <button
                onClick={() => setShowAddPhonesToGroupModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-slate-300 font-semibold">Chọn nhóm đích *</label>
                <select
                  value={targetGroupId}
                  onChange={(e) => setTargetGroupId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.member_count || 0} thành viên)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-semibold">Danh sách số điện thoại cần thêm *</label>
                <p className="text-[11px] text-slate-400 mb-1">
                  Mỗi dòng 1 số điện thoại. Hệ thống sẽ tự động liên kết vào nhóm và lưu vào Kho Data.
                </p>
                <textarea
                  rows={6}
                  placeholder={"0912345678\n0987654321\n0901234567"}
                  value={groupPhonesText}
                  onChange={(e) => setGroupPhonesText(e.target.value)}
                  className="w-full font-mono rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowAddPhonesToGroupModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddPhonesToGroup}
                disabled={addingPhonesToGroup}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {addingPhonesToGroup ? "Đang thêm..." : "Xác Nhận Thêm Vào Nhóm"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Cấu hình số lượng tin nhắn trong lượt chạy (Batch Limit) */}
      {runBatchCamp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Play className="h-4 w-4 text-emerald-400" />
                {runBatchAction === "start" ? "Bắt Đầu Gửi Tin Nhắn" : "Tiếp Tục Gửi Chiến Dịch"}
              </h3>
              <button
                onClick={() => setRunBatchCamp(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-1.5">
                <div className="font-semibold text-white truncate">{runBatchCamp.title}</div>
                <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                  <span>Tổng: <strong>{runBatchCamp.total_leads}</strong> số</span>
                  <span>•</span>
                  <span className="text-emerald-400">Đã gửi: <strong>{runBatchCamp.sent_count}</strong></span>
                  <span>•</span>
                  <span className="text-sky-400">
                    Còn lại: <strong>{Math.max(0, runBatchCamp.total_leads - runBatchCamp.sent_count - runBatchCamp.skipped_count)}</strong> số
                  </span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Số lượng tin nhắn trong lượt chạy này *
                </label>
                <p className="text-[11px] text-slate-400 mb-2">
                  Sau khi gửi đủ số tin nhắn thành công này, chiến dịch sẽ <strong>tự động tạm dừng</strong> để bạn kiểm tra kết quả và tránh bị Zalo đánh dấu spam. (Nhập 0 để gửi hết).
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={runBatchLimit}
                    onChange={(e) => setRunBatchLimit(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-slate-400 font-medium whitespace-nowrap">tin nhắn</span>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-slate-500 self-center mr-1">Chọn nhanh:</span>
                  {[10, 20, 30, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setRunBatchLimit(num)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors border ${
                        runBatchLimit === num
                          ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/50"
                          : "bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white"
                      }`}
                    >
                      {num} tin
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRunBatchLimit(0)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors border ${
                      runBatchLimit === 0
                        ? "bg-amber-600/30 text-amber-300 border-amber-500/50"
                        : "bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    Gửi hết (0)
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setRunBatchCamp(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmRunBatch}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-950/50"
              >
                <Play className="h-3.5 w-3.5" />
                {runBatchAction === "start" ? `Bắt đầu gửi ${runBatchLimit > 0 ? `(${runBatchLimit} tin)` : ""}` : `Tiếp tục gửi ${runBatchLimit > 0 ? `(${runBatchLimit} tin)` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Sao Chép / Nhân Bản Chiến Dịch */}
      {showCopyModal && campaignToCopy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Copy className="h-4 w-4 text-amber-400" />
                Sao Chép / Nhân Bản Chiến Dịch
              </h3>
              <button
                onClick={() => setShowCopyModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-1">
                <div className="text-[11px] text-slate-400">Chiến dịch gốc:</div>
                <div className="font-semibold text-white">{campaignToCopy.title}</div>
                <div className="text-[11px] text-slate-400">
                  Số lượng leads hiện tại: <strong>{campaignToCopy.total_leads}</strong> số
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Tên chiến dịch mới *
                </label>
                <input
                  type="text"
                  value={copyTitle}
                  onChange={(e) => setCopyTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                  placeholder="Nhập tên chiến dịch mới..."
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyLeads}
                    onChange={(e) => setCopyLeads(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <div>
                    <span className="font-semibold text-slate-200 block">
                      Sao chép danh sách số điện thoại (Leads)
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {copyLeads
                        ? `Sẽ nhân bản toàn bộ ${campaignToCopy.total_leads} số sang chiến dịch mới ở trạng thái chờ gửi (pending).`
                        : "Chỉ sao chép cấu hình, nội dung tin nhắn và hình ảnh. Danh sách số sẽ để trống để bạn nạp mới."}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmCopy}
                disabled={copying}
                className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-500 transition-colors shadow-lg shadow-amber-950/50 disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copying ? "Đang nhân bản..." : "Xác Nhận Sao Chép"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chỉnh Sửa Chiến Dịch */}
      {showEditModal && campaignToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 p-5">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-sky-500/20 p-2 text-sky-400">
                  <FileEdit className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Chỉnh Sửa Chiến Dịch
                  </h3>
                  <div className="text-[11px] text-slate-400">
                    ID: <code className="text-sky-300">{campaignToEdit.id}</code> • Đang có {campaignToEdit.total_leads} leads
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {campaignToEdit.status === "running" && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertCircle className="h-4 w-4 text-amber-400" />
                    Chiến dịch đang trong quá trình chạy!
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Mọi thay đổi về nội dung tin nhắn, độ trễ và các thiết lập chống spam sẽ áp dụng ngay cho các lượt gửi tiếp theo.
                  </p>
                </div>
              )}

              {/* Tên chiến dịch */}
              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Tên chiến dịch *
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                  placeholder="Nhập tên chiến dịch..."
                />
              </div>

              {/* Nội dung tin nhắn mẫu */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-semibold">
                    Nội dung tin nhắn mẫu *
                  </label>
                  <div className="flex gap-1.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setEditContent((prev) => prev + " {name}")}
                      className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20"
                    >
                      + {"{name}"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditContent((prev) => prev + " {gender_call}")}
                      className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20"
                    >
                      + {"{gender_call}"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditContent((prev) => prev + " {phone}")}
                      className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20"
                    >
                      + {"{phone}"}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white focus:border-sky-500 focus:outline-none leading-relaxed"
                  placeholder="Nhập nội dung tin nhắn gửi khách hàng..."
                />
              </div>

              {/* Cài đặt hẹn giờ / đa khung giờ */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-200 font-semibold">
                    <input
                      type="checkbox"
                      checked={editIsScheduled}
                      onChange={(e) => setEditIsScheduled(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    <Clock className="h-4 w-4 text-sky-400" />
                    <span>Lên lịch hẹn giờ chạy chiến dịch</span>
                  </label>

                  {editIsScheduled && (
                    <div className="flex items-center gap-1.5 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setEditScheduleType("once")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                          editScheduleType === "once" ? "bg-sky-500 text-white" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        1 mốc giờ
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditScheduleType("multi_slots")}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                          editScheduleType === "multi_slots" ? "bg-sky-500 text-white" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        Nhiều ca trong ngày
                      </button>
                    </div>
                  )}
                </div>

                {editIsScheduled && editScheduleType === "once" && (
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Thời gian chạy:</label>
                    <input
                      type="datetime-local"
                      value={editScheduledDateTime}
                      onChange={(e) => setEditScheduledDateTime(e.target.value)}
                      className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                )}

                {editIsScheduled && editScheduleType === "multi_slots" && (
                  <div className="space-y-2 border-t border-slate-800/80 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">Thiết lập các ca chạy (Khung giờ & Số lượng):</span>
                      <button
                        type="button"
                        onClick={() => setEditScheduleSlots([...editScheduleSlots, { time: "12:00", batchSize: 50 }])}
                        className="text-[11px] font-bold text-sky-400 hover:text-sky-300"
                      >
                        + Thêm ca
                      </button>
                    </div>
                    {editScheduleSlots.map((slot, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) => {
                            const updated = [...editScheduleSlots];
                            updated[idx].time = e.target.value;
                            setEditScheduleSlots(updated);
                          }}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                        />
                        <span className="text-slate-400">Gửi:</span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={slot.batchSize}
                          onChange={(e) => {
                            const updated = [...editScheduleSlots];
                            updated[idx].batchSize = Math.max(1, parseInt(e.target.value) || 1);
                            setEditScheduleSlots(updated);
                          }}
                          className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                        />
                        <span className="text-slate-400">số</span>
                        {editScheduleSlots.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setEditScheduleSlots(editScheduleSlots.filter((_, i) => i !== idx))}
                            className="p-1 text-slate-500 hover:text-rose-400"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cài đặt Giãn cách & Anti-Ban */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <div className="text-slate-200 font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Cấu Hình Anti-Ban & Giãn Cách
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Giãn cách tối thiểu (giây):</label>
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={editMinDelay}
                      onChange={(e) => setEditMinDelay(Math.max(5, parseInt(e.target.value) || 30))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Giãn cách tối đa (giây):</label>
                    <input
                      type="number"
                      min={10}
                      max={600}
                      value={editMaxDelay}
                      onChange={(e) => setEditMaxDelay(Math.max(5, parseInt(e.target.value) || 60))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-[11px]">
                    <input
                      type="checkbox"
                      checked={editAutoAlias}
                      onChange={(e) => setEditAutoAlias(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    Tự động đổi gợi nhớ tên phụ trên Zalo
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-[11px]">
                    <input
                      type="checkbox"
                      checked={editAutoFriend}
                      onChange={(e) => setEditAutoFriend(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    Tự động gửi lời mời kết bạn kèm theo
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-[11px]">
                    <input
                      type="checkbox"
                      checked={editAiRewrite}
                      onChange={(e) => setEditAiRewrite(e.target.checked)}
                      className="rounded border-slate-700 text-sky-500 focus:ring-0"
                    />
                    Kích hoạt AI viết lại tin nhắn (Chống spam fingerprint)
                  </label>
                </div>
              </div>

              {/* Bổ sung thêm SĐT hoặc Nhóm vào chiến dịch */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <div className="text-slate-200 font-semibold flex items-center gap-1.5">
                  <Plus className="h-4 w-4 text-sky-400" />
                  Bổ Sung Thêm Số Điện Thoại Vào Chiến Dịch (Tùy chọn)
                </div>
                <p className="text-[11px] text-slate-400">
                  Các số đã tồn tại trong chiến dịch sẽ tự động được lọc bỏ, chỉ chèn thêm các số mới.
                </p>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Nhập/Dán thêm SĐT mới (Hỗ trợ 11-&gt;10 số, bóc tách nhiều số):
                  </label>
                  <textarea
                    rows={2}
                    value={editAdditionalPhones}
                    onChange={(e) => setEditAdditionalPhones(e.target.value)}
                    placeholder="Dán thêm các số điện thoại mới tại đây..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>

                {groups.length > 0 && (
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Hoặc chọn thêm từ Nhóm Khách Hàng:
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {groups.map((grp) => (
                        <label
                          key={grp.id}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs cursor-pointer transition-colors ${
                            editSelectedGroupIds.includes(grp.id)
                              ? "border-sky-500 bg-sky-500/20 text-sky-200"
                              : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={editSelectedGroupIds.includes(grp.id)}
                            onChange={(e) => {
                              if (e.target.checked) setEditSelectedGroupIds([...editSelectedGroupIds, grp.id]);
                              else setEditSelectedGroupIds(editSelectedGroupIds.filter((id) => id !== grp.id));
                            }}
                            className="sr-only"
                          />
                          <span>{grp.name}</span>
                          <span className="text-[10px] opacity-75">({grp.member_count || 0})</span>
                        </label>
                      ))}
                    </div>

                    {/* Bộ lọc phân loại số trong nhóm khi chỉnh sửa */}
                    {editSelectedGroupIds.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-800">
                        <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                          Phân loại dữ liệu SĐT nạp từ các nhóm đã chọn:
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setEditGroupFilterMode("all")}
                            className={`p-2 rounded-lg border text-left text-xs transition-all ${
                              editGroupFilterMode === "all"
                                ? "border-sky-500 bg-sky-500/20 text-sky-200"
                                : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                            }`}
                          >
                            <div className="font-semibold text-sky-400">Toàn bộ nhóm</div>
                            <div className="text-[10px] text-slate-400">Nạp tất cả số có trong nhóm</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditGroupFilterMode("uncontacted")}
                            className={`p-2 rounded-lg border text-left text-xs transition-all ${
                              editGroupFilterMode === "uncontacted"
                                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                                : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                            }`}
                          >
                            <div className="font-semibold text-emerald-400">Chưa từng gửi tin</div>
                            <div className="text-[10px] text-slate-400">Chỉ số chưa chạy chiến dịch nào</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditGroupFilterMode("valid_only")}
                            className={`p-2 rounded-lg border text-left text-xs transition-all ${
                              editGroupFilterMode === "valid_only"
                                ? "border-purple-500 bg-purple-500/20 text-purple-200"
                                : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                            }`}
                          >
                            <div className="font-semibold text-purple-400">Chỉ số có Zalo</div>
                            <div className="text-[10px] text-slate-400">Đã xác minh Valid trước đó</div>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 border-t border-slate-800 p-4">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 transition-colors shadow-lg shadow-sky-950/50 disabled:opacity-50"
              >
                <FileEdit className="h-3.5 w-3.5" />
                {savingEdit ? "Đang lưu thay đổi..." : "Lưu Thay Đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Quét Tự Động Trạng Thái Zalo (Pre-validation hub) */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Search className="h-4 w-4 text-purple-400" />
                Quét Tự Động Trạng Thái Zalo (Pre-Validation Hub)
              </h3>
              <button
                onClick={() => setShowVerifyModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-xl bg-purple-950/20 border border-purple-500/30 p-3.5 text-slate-300 space-y-1">
                <div className="font-semibold text-purple-300">Tính năng xác thực trước:</div>
                <p className="text-[11px] text-slate-300">
                  Bot sẽ tự động quét kiểm tra từng SĐT với khoảng nghỉ an toàn 2.5s/số để phân loại tài khoản Zalo, lưu trực tiếp UID & Avatar vào Kho Data. Khi chạy chiến dịch sau này, bot sẽ gửi thẳng siêu tốc mà không cần tốn thời gian dò tìm lại!
                </p>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Chọn phạm vi quét kiểm tra:
                </label>
                <select
                  value={verifyTargetGroupId}
                  onChange={(e) => {
                    setVerifyTargetGroupId(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                >
                  <option value="all">Toàn bộ Kho Data (Tất cả SĐT chưa xác minh)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      Nhóm: {g.name} ({g.member_count || 0} số)
                    </option>
                  ))}
                </select>
              </div>

              {/* Thông tin trạng thái task */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Số lượng cần xác minh:</span>
                  <span className="font-bold text-amber-400">{unverifiedCount} số</span>
                </div>

                {verifyTask && (
                  <div className="space-y-2 border-t border-slate-800 pt-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">
                        Trạng thái:{" "}
                        <strong className={verifyTask.status === "running" ? "text-emerald-400" : "text-slate-300"}>
                          {verifyTask.status === "running" ? "Đang quét..." : "Đã dừng / Hoàn thành"}
                        </strong>
                      </span>
                      <span className="font-semibold text-sky-400">
                        {verifyTask.checked_count} / {verifyTask.total_phones}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                        style={{
                          width: `${verifyTask.total_phones > 0 ? Math.min(100, Math.round((verifyTask.checked_count / verifyTask.total_phones) * 100)) : 0}%`,
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center pt-1 text-[11px]">
                      <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
                        <div className="text-emerald-400 font-bold">{verifyTask.valid_count}</div>
                        <div className="text-[10px] text-slate-400">Có Zalo</div>
                      </div>
                      <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
                        <div className="text-slate-400 font-bold">{verifyTask.no_zalo_count}</div>
                        <div className="text-[10px] text-slate-400">Không có Zalo</div>
                      </div>
                      <div className="bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
                        <div className="text-rose-400 font-bold">{verifyTask.error_count}</div>
                        <div className="text-[10px] text-slate-400">Lỗi / Chặn</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowVerifyModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Đóng
              </button>

              {verifyTask && verifyTask.status === "running" ? (
                <button
                  type="button"
                  onClick={handleStopVerification}
                  disabled={verifyingAction}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition-colors"
                >
                  Dừng Quét
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartVerification}
                  disabled={verifyingAction || unverifiedCount === 0}
                  className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
                >
                  <Search className="h-3.5 w-3.5" />
                  Bắt Đầu Quét ({unverifiedCount} số)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
