import fs from "node:fs";
import { callGemini } from "../gemini.js";
import {
  ZaloMktCampaign,
  ZaloMktCampaignConfig,
  checkAndActivateScheduledCampaigns,
  getActiveRunningCampaign,
  getCampaignById,
  getMktContact,
  getNextPendingLead,
  normalizePhoneNumber,
  recalculateCampaignCounts,
  updateCampaignConfig,
  updateCampaignStatus,
  updateLead,
  upsertMktContact,
} from "../db/zalomkt-db.js";

const ThreadTypeUser = 0;

let workerRunning = false;
let isProcessingLead = false;

/**
 * Xác định đại từ xưng hô theo chuẩn giới tính Zalo API và bộ quy tắc tiếng Việt.
 * - gender === 0: Nam (Mặc định: "Anh", nếu >= 55 tuổi: "Bác")
 * - gender === 1: Nữ (Mặc định: "Chị", nếu >= 55 tuổi: "Cô")
 * - gender === -1 hoặc 2: Chưa rõ / Ẩn thông tin -> Phân tích chữ đệm & tên tiếng Việt, nếu không chắc -> "Anh/Chị"
 */
export function resolveVietnamesePronoun(params: {
  gender?: number;
  fullName?: string;
  sdob?: string;
}): string {
  const { gender, fullName = "", sdob = "" } = params;

  let isSenior = false;
  if (sdob && sdob.includes("/")) {
    const parts = sdob.split("/");
    if (parts.length === 3 && parts[2]) {
      const year = parseInt(parts[2], 10);
      const currentYear = new Date().getFullYear();
      if (!isNaN(year) && year > 1930 && year <= currentYear) {
        if (currentYear - year >= 55) {
          isSenior = true;
        }
      }
    }
  }

  // 0: Nam (Chuẩn Zalo Web API)
  if (gender === 0) {
    return isSenior ? "Bác" : "Anh";
  }
  // 1: Nữ (Chuẩn Zalo Web API)
  if (gender === 1) {
    return isSenior ? "Cô" : "Chị";
  }

  // Heuristic chữ đệm & tên tiếng Việt khi gender === -1 hoặc 2
  const cleanName = fullName.trim().toLowerCase();
  if (cleanName) {
    const words = cleanName.split(/\s+/);
    const femaleIndicators = [
      "thị", "thi", "nữ", "nu", "hồng", "hong", "thảo", "thao", "mai", "loan",
      "hoa", "hương", "huong", "lan", "linh", "hằng", "hang", "trang", "phương", "phuong",
      "quỳnh", "quynh", "thu", "nga", "hà", "ha", "huyền", "huyen", "diệu", "dieu",
      "oanh", "trâm", "tram", "hạnh", "hanh", "yến", "yen", "dung", "thủy", "thuy",
      "vy", "nhi", "chi", "ngân", "ngan", "ly", "my", "thư", "thu", "nhung", "tuyết", "tuyet"
    ];
    const maleIndicators = [
      "văn", "van", "trọng", "trong", "tuấn", "tuan", "hùng", "hung", "dũng", "dung",
      "hoàng", "hoang", "huy", "đức", "duc", "hải", "hai", "nam", "phong", "long",
      "thành", "thanh", "thắng", "thang", "quân", "quan", "cường", "cuong", "khoa",
      "kiên", "kien", "sơn", "son", "tùng", "tung", "trung", "hiếu", "hieu", "duy",
      "đạt", "dat", "bảo", "bao", "phúc", "phuc", "khang", "bách", "bach", "bình", "binh"
    ];

    if (words.some((w) => w === "thị" || w === "thi")) {
      return isSenior ? "Cô" : "Chị";
    }
    if (words.some((w) => w === "văn" || w === "van")) {
      return isSenior ? "Bác" : "Anh";
    }

    const lastName = words[words.length - 1];
    if (lastName) {
      if (femaleIndicators.includes(lastName)) {
        return isSenior ? "Cô" : "Chị";
      }
      if (maleIndicators.includes(lastName)) {
        return isSenior ? "Bác" : "Anh";
      }
    }
  }

  return "Anh/Chị";
}

/**
 * Sinh nội dung tin nhắn cá nhân hóa bằng AI (Gemini Flash-Lite).
 * Giữ nguyên 100% nội dung cốt lõi, link, số liên hệ; làm mới câu chữ,
 * điều chỉnh xưng hô theo tên, giới tính, tuổi (nếu có ngày sinh).
 */
export async function generatePersonalizedMessage(params: {
  rawContent: string;
  recipientName: string;
  gender: number; // 0: Nam, 1: Nữ, -1: Chưa rõ
  phone: string;
  sdob?: string;
}): Promise<string> {
  const { rawContent, recipientName, gender, phone, sdob } = params;

  // Xác định đại từ xưng hô chuẩn xác
  const pronoun = resolveVietnamesePronoun({
    gender,
    fullName: recipientName,
    sdob,
  });

  const fallbackText = rawContent
    .replace(/\{name\}/gi, recipientName)
    .replace(/\{gender_call\}/gi, pronoun)
    .replace(/\{phone\}/gi, phone)
    .replace(/\{sdob\}/gi, sdob || "");

  try {
    const systemPrompt = `Bạn là trợ lý marketing chuyên nghiệp, khéo léo và tự nhiên.
Nhiệm vụ: Cá nhân hóa tin nhắn gửi khách hàng qua Zalo dựa trên tin nhắn gốc.

CÁC NGUYÊN TẮC BẮT BUỘC:
1. TUYỆT ĐỐI BẢO TOÀN NGUYÊN VẸN 100%: Mọi đường link (URL), số điện thoại liên hệ, mã ưu đãi, tên dự án/sản phẩm và giá trị cốt lõi từ tin nhắn gốc.
2. XƯNG HÔ CHUẨN XÁC: Gọi người nhận là "${pronoun} ${recipientName}". Giữ thái độ lịch thiệp, tôn trọng, chân thành.
3. BIẾN THỂ TỰ NHIÊN (ANTI-SPAM): Thay đổi linh hoạt lời chào, cách mở đầu hoặc đảo câu nhẹ nhàng, thêm icon/emoji sinh động để mỗi tin nhắn là một phiên bản độc nhất, không bị hệ thống chống spam của Zalo đánh dấu tin rác.
4. ĐỊNH DẠNG: Chỉ trả về nội dung tin nhắn hoàn chỉnh để gửi thẳng cho khách hàng. Không thêm tiêu đề, không thêm ghi chú, không thêm dấu ngoặc kép bọc ngoài.`;

    const userPrompt = `Dữ liệu khách hàng:
- Họ tên: ${recipientName}
- Xưng hô: ${pronoun}
- Số điện thoại: ${phone}
${sdob ? `- Ngày sinh: ${sdob}` : ""}

Tin nhắn gốc cần gửi:
---
${rawContent}
---`;

    const aiResult = await callGemini(systemPrompt, userPrompt, {
      model: "gemini-2.5-flash-lite",
      temperature: 0.7,
      maxTokens: 1000,
    });

    if (aiResult && aiResult.trim().length > 10) {
      return aiResult.trim();
    }
  } catch (err) {
    console.warn(`[zalomkt-worker] Lỗi gọi AI cá nhân hóa, fallback sang template gốc:`, err);
  }

  return fallbackText;
}

/** Tạm dừng một khoảng thời gian (ms), có thể ngắt quãng nếu chiến dịch bị dừng */
async function smartSleep(ms: number, campaignId: string): Promise<boolean> {
  const step = 500;
  let elapsed = 0;
  while (elapsed < ms) {
    await new Promise((r) => setTimeout(r, Math.min(step, ms - elapsed)));
    elapsed += step;

    // Kiểm tra xem chiến dịch có bị chuyển sang paused hoặc stopped không
    const camp = getCampaignById(campaignId);
    if (!camp || camp.status !== "running") {
      return false; // Bị ngắt
    }
  }
  return true;
}

/**
 * Khởi động Zalo Marketing Background Worker
 */
export function initZaloMktWorker(api: any): void {
  if (workerRunning) return;
  workerRunning = true;
  console.log(`[zalomkt-worker] 🚀 Khởi chạy Zalo Marketing Background Worker...`);

  // Chạy vòng lặp định kỳ kiểm tra chiến dịch
  setInterval(() => {
    try {
      checkAndActivateScheduledCampaigns();
    } catch (schedErr) {
      console.error(`[zalomkt-worker] Lỗi kiểm tra lịch hẹn chiến dịch:`, schedErr);
    }

    if (isProcessingLead) return;

    void (async () => {
      const activeCampaign = getActiveRunningCampaign();
      if (!activeCampaign) return;

      isProcessingLead = true;
      try {
        await processNextLeadInCampaign(api, activeCampaign);
      } catch (err) {
        console.error(`[zalomkt-worker] Lỗi xử lý chiến dịch ${activeCampaign.id}:`, err);
      } finally {
        isProcessingLead = false;
      }
    })();
  }, 3000);
}

/**
 * Xử lý lead tiếp theo trong chiến dịch
 */
async function processNextLeadInCampaign(api: any, campaign: ZaloMktCampaign): Promise<void> {
  let config: ZaloMktCampaignConfig = {};
  try {
    config = JSON.parse(campaign.config_json || "{}");
  } catch {}

  const minDelay = typeof config.minDelay === "number" && config.minDelay >= 5000 ? config.minDelay : 25000;
  const maxDelay = typeof config.maxDelay === "number" && config.maxDelay >= minDelay ? config.maxDelay : 45000;
  const autoAlias = config.autoAlias !== false; // Mặc định bật
  const autoFriend = Boolean(config.autoFriend); // Mặc định tắt
  const aiRewrite = config.aiRewrite !== false; // Mặc định bật

  const lead = getNextPendingLead(campaign.id);
  if (!lead) {
    // Không còn lead nào chờ gửi -> Hoàn tất chiến dịch
    updateCampaignStatus(campaign.id, "completed");
    recalculateCampaignCounts(campaign.id);
    console.log(`[zalomkt-worker] 🎉 Chiến dịch [${campaign.title}] (ID: ${campaign.id}) đã HOÀN TẤT.`);
    return;
  }

  console.log(`[zalomkt-worker] 👤 Đang xử lý lead ${lead.phone} cho chiến dịch [${campaign.title}]...`);
  updateLead(lead.id, { status: "searching" });

  const normalized = normalizePhoneNumber(lead.phone);
  let targetUid: string | null = null;
  let targetDisplayName = lead.custom_name || "";
  let targetGender = -1;
  let targetAvatar = "";
  let targetSdob = "";

  // 1. Kiểm tra đối chiếu với Kho Data Toàn Cục (Smart Pre-Flight Filter)
  const existingContact = getMktContact(normalized);
  if (existingContact) {
    if (existingContact.is_blacklisted) {
      updateLead(lead.id, {
        status: "skipped",
        skip_reason: "Số nằm trong danh sách đen (Blacklist)",
      });
      recalculateCampaignCounts(campaign.id);
      return;
    }

    if (existingContact.status_code === "no_zalo") {
      updateLead(lead.id, {
        status: "skipped",
        skip_reason: "Số không có Zalo (đã ghi nhận từ trước)",
      });
      recalculateCampaignCounts(campaign.id);
      return;
    }

    if (existingContact.status_code === "blocked_stranger") {
      updateLead(lead.id, {
        status: "skipped",
        skip_reason: "Chặn tin nhắn từ người lạ (đã ghi nhận từ trước)",
      });
      recalculateCampaignCounts(campaign.id);
      return;
    }

    if (existingContact.status_code === "valid" && existingContact.zalo_uid) {
      targetUid = existingContact.zalo_uid;
      targetDisplayName = existingContact.display_name || existingContact.zalo_name || targetDisplayName;
      targetGender = existingContact.gender ?? -1;
      targetAvatar = existingContact.avatar || "";
      targetSdob = existingContact.sdob || "";
    }
  }

  // 2. Nếu chưa có UID trong Kho Data, gọi API Zalo tìm kiếm (findUser)
  if (!targetUid) {
    try {
      console.log(`[zalomkt-worker] 🔍 Đang quét SĐT ${normalized} trên Zalo...`);
      const userProfile = await api.findUser(normalized);

      if (userProfile && userProfile.uid) {
        targetUid = String(userProfile.uid);
        targetDisplayName = userProfile.display_name || userProfile.zalo_name || targetDisplayName;
        targetGender = typeof userProfile.gender === "number" ? userProfile.gender : -1;
        targetAvatar = userProfile.avatar || "";
        targetSdob = userProfile.sdob || "";

        // Lưu thông tin vào Kho Data Toàn Cục
        upsertMktContact({
          phone: normalized,
          zalo_uid: targetUid,
          zalo_name: userProfile.zalo_name || "",
          display_name: targetDisplayName,
          gender: targetGender,
          dob: userProfile.dob || null,
          sdob: targetSdob,
          avatar: targetAvatar,
          bio: userProfile.status || "",
          status_code: "valid",
          last_checked_at: Date.now(),
        });
      } else {
        // Không tìm thấy user
        upsertMktContact({
          phone: normalized,
          status_code: "no_zalo",
          last_checked_at: Date.now(),
        });
        updateLead(lead.id, {
          status: "skipped",
          skip_reason: "Số chưa đăng ký tài khoản Zalo",
        });
        recalculateCampaignCounts(campaign.id);
        return;
      }
    } catch (findErr: any) {
      const errStr = String(findErr?.message || findErr);
      const isNotFound = findErr?.code === 216 || /chưa đăng ký|không tìm thấy|not found/i.test(errStr);

      if (isNotFound) {
        upsertMktContact({
          phone: normalized,
          status_code: "no_zalo",
          last_checked_at: Date.now(),
        });
        updateLead(lead.id, {
          status: "skipped",
          skip_reason: "Số chưa đăng ký tài khoản Zalo",
        });
      } else {
        console.warn(`[zalomkt-worker] Lỗi tìm user ${normalized}:`, errStr);
        updateLead(lead.id, {
          status: "failed",
          error_message: `Lỗi quét Zalo: ${errStr}`,
        });
      }
      recalculateCampaignCounts(campaign.id);
      return;
    }
  }

  // 3. Cập nhật profile đã tìm thấy vào lead
  updateLead(lead.id, {
    zalo_uid: targetUid,
    display_name: targetDisplayName,
    gender: targetGender,
    avatar: targetAvatar,
    status: "ready",
  });

  // 4. Cá nhân hóa nội dung tin nhắn bằng AI (chống spam Zalo)
  const recipientName = lead.custom_name || targetDisplayName || "Quý khách";
  let messageText = campaign.raw_content;

  if (aiRewrite) {
    messageText = await generatePersonalizedMessage({
      rawContent: campaign.raw_content,
      recipientName,
      gender: targetGender,
      phone: lead.phone,
      sdob: targetSdob,
    });
  } else {
    const pronoun = resolveVietnamesePronoun({
      gender: targetGender,
      fullName: recipientName,
      sdob: targetSdob,
    });
    messageText = campaign.raw_content
      .replace(/\{name\}/gi, recipientName)
      .replace(/\{gender_call\}/gi, pronoun)
      .replace(/\{phone\}/gi, lead.phone);
  }

  updateLead(lead.id, {
    personalized_text: messageText,
    status: "sending",
  });

  // 5. Chuẩn bị hình ảnh (Cụm nhiều ảnh dạng album)
  let imageAttachments: string[] = [];
  try {
    const rawImgs = JSON.parse(campaign.images_json || "[]");
    if (Array.isArray(rawImgs)) {
      imageAttachments = rawImgs.filter((p) => typeof p === "string" && fs.existsSync(p));
    }
  } catch {}

  // 6. Gửi tin nhắn & Cụm ảnh cho khách hàng
  console.log(`[zalomkt-worker] 📤 Đang gửi tin nhắn (${imageAttachments.length} ảnh) tới ${recipientName} (${targetUid})...`);
  try {
    const sendPayload: any = {
      msg: messageText,
    };
    if (imageAttachments.length > 0) {
      sendPayload.attachments = imageAttachments;
    }

    await api.sendMessage(sendPayload, targetUid, ThreadTypeUser);

    const sentAt = Date.now();
    updateLead(lead.id, {
      status: "sent",
      sent_at: sentAt,
    });

    upsertMktContact({
      phone: normalized,
      total_sent: 1,
      last_sent_at: sentAt,
      status_code: "valid",
    });

    // Cập nhật số tin nhắn thành công trong lượt chạy hiện tại
    config.runSentCount = (config.runSentCount || 0) + 1;
    updateCampaignConfig(campaign.id, config);

    console.log(`[zalomkt-worker] ✅ Gửi tin nhắn thành công tới ${recipientName} (${normalized}) [Lượt này: ${config.runSentCount}${config.batchLimit ? `/${config.batchLimit}` : ""}].`);

    // 7. Tự động đổi tên gợi nhớ: [Tên Zalo] + [SĐT]
    if (autoAlias) {
      const aliasName = `${targetDisplayName || "Khách"} ${lead.phone}`.trim();
      try {
        console.log(`[zalomkt-worker] 🏷️ Đang đổi tên gợi nhớ thành: "${aliasName}"...`);
        await api.changeFriendAlias(aliasName, targetUid);
        updateLead(lead.id, {
          alias_updated: 1,
          alias_name: aliasName,
        });
        console.log(`[zalomkt-worker] ✅ Đã đổi tên gợi nhớ thành công.`);
      } catch (aliasErr) {
        console.warn(`[zalomkt-worker] Đổi tên gợi nhớ thất bại (có thể do chưa là bạn bè):`, aliasErr);
      }
    }

    // 8. Tự động gửi lời mời kết bạn (nếu được bật)
    if (autoFriend) {
      try {
        console.log(`[zalomkt-worker] 🤝 Đang gửi lời mời kết bạn tới ${targetUid}...`);
        await api.sendFriendRequest("Chào bạn, mình xin phép kết bạn để tiện trao đổi thêm nhé!", targetUid);
        updateLead(lead.id, {
          friend_requested: 1,
        });
        console.log(`[zalomkt-worker] ✅ Đã gửi lời mời kết bạn thành công.`);
      } catch (friendErr) {
        console.warn(`[zalomkt-worker] Gửi kết bạn thất bại:`, friendErr);
      }
    }
  } catch (sendErr: any) {
    const errStr = String(sendErr?.message || sendErr);
    console.warn(`[zalomkt-worker] ❌ Gửi tin nhắn thất bại tới ${normalized}:`, errStr);

    const isStrangerBlocked = /chặn|stranger|không nhận tin|block/i.test(errStr);
    if (isStrangerBlocked) {
      upsertMktContact({
        phone: normalized,
        status_code: "blocked_stranger",
      });
      updateLead(lead.id, {
        status: "failed",
        error_message: "Người dùng chặn nhận tin nhắn từ người lạ",
      });
    } else {
      updateLead(lead.id, {
        status: "failed",
        error_message: `Gửi lỗi: ${errStr}`,
      });
    }
  }

  // 9. Cập nhật thống kê chiến dịch
  recalculateCampaignCounts(campaign.id);

  // 10. Kiểm tra định mức số lượng tin nhắn trong lượt chạy này (Batch Limit)
  const batchLimit = config.batchLimit;
  if (typeof batchLimit === "number" && batchLimit > 0 && (config.runSentCount || 0) >= batchLimit) {
    console.log(`[zalomkt-worker] ⏸️ Đã hoàn thành định mức lượt chạy: ${config.runSentCount}/${batchLimit} tin nhắn gửi thành công. Tự động tạm dừng chiến dịch [${campaign.title}] (ID: ${campaign.id}).`);
    updateCampaignStatus(campaign.id, "paused");
    return;
  }

  // 11. Smart Anti-Ban Random Delay (Giãn cách ngẫu nhiên an toàn)
  const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  console.log(`[zalomkt-worker] ⏳ Giãn cách an toàn Anti-Ban: Chờ ${Math.round(randomDelay / 1000)}s trước khi xử lý số tiếp theo...`);
  const sleepCompleted = await smartSleep(randomDelay, campaign.id);
  if (!sleepCompleted) {
    console.log(`[zalomkt-worker] ⏸️ Chiến dịch [${campaign.title}] đã được tạm dừng hoặc hủy.`);
  }
}
