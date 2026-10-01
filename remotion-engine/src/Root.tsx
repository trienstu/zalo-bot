import React from "react";
import { Composition } from "remotion";
import { VerticalShorts, type VerticalShortsProps } from "./templates/VerticalShorts";
import { LandscapeExplainer, type LandscapeExplainerProps } from "./templates/LandscapeExplainer";
import { TikTokViralStory, type TikTokViralStoryProps } from "./templates/TikTokViralStory";
import { VersusComparison, type VersusComparisonProps } from "./templates/VersusComparison";
import { BreakingNews, type BreakingNewsProps } from "./templates/BreakingNews";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 1. Video Dọc Đồ Họa Điểm Tin (Vertical Shorts) */}
      <Composition
        id="VerticalShorts"
        component={VerticalShorts as any}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          badge: "AI SPOTLIGHT 2026",
          title: "3 ĐỘT PHÁ CỦA AI AGENT",
          subtitle: "Thay đổi phương thức vận hành doanh nghiệp toàn cầu",
          points: [
            "Tự chủ điều hướng quy trình (Autonomous Planning)",
            "Đồ thị tri thức hợp nhất (Unified Knowledge Graph)",
            "Tương tác thời gian thực đa phương tiện (Realtime Multimodal)",
          ],
          audioFile: "narration.mp3",
          bgMusicFile: "music/ambient-lofi.mp3",
          speakerName: "Sen Chúa AI",
          primaryColor: "#4f46e5",
          secondaryColor: "#ec4899",
        }}
      />

      {/* 2. Video Ngang Thuyết Trình / Báo Cáo Dự Án (Landscape Explainer) */}
      <Composition
        id="LandscapeExplainer"
        component={LandscapeExplainer as any}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          badge: "BÁO CÁO CÔNG NGHỆ",
          title: "KIẾN TRÚC VẬN HÀNH TỰ ĐỘNG HÓA",
          subtitle: "Tối ưu hóa hiệu suất xử lý tác vụ thông minh trên hạ tầng đám mây",
          bulletPoints: [
            "Hệ thống định tuyến Query Planner giảm 80% độ trễ xử lý.",
            "Engine Remotion xuất bản video đồ họa chuyển động thời gian thực.",
            "Khả năng mở rộng đa luồng xử lý đồng thời không nghẽn tài nguyên.",
          ],
          metrics: [
            { label: "TỐC ĐỘ RENDER", value: "12 FPS", subtext: "Gấp 3 lần chuẩn cũ" },
            { label: "TIẾT KIỆM BĂNG THÔNG", value: "75%", subtext: "Nén chuẩn H.264" },
            { label: "ĐỘ TIN CẬY", value: "99.9%", subtext: "Zero-Downtime Worker" },
          ],
          audioFile: "narration.mp3",
          bgMusicFile: "music/ambient-lofi.mp3",
          speakerName: "Ban Dự Án - Bot Sen Chúa",
          primaryColor: "#3b82f6",
          secondaryColor: "#8b5cf6",
        }}
      />

      {/* 3. Video TikTok Viral Nhiều Cảnh + Phụ Đề Nhảy Chữ Karaoke (TikTokViralStory) */}
      <Composition
        id="TikTokViralStory"
        component={TikTokViralStory as any}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          audioFile: "narration.mp3",
          bgMusicFile: "music/ambient-lofi.mp3",
        }}
      />

      {/* 4. Video So Sánh A vs B (VersusComparison) */}
      <Composition
        id="VersusComparison"
        component={VersusComparison as any}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          audioFile: "narration.mp3",
          bgMusicFile: "music/ambient-lofi.mp3",
        }}
      />

      {/* 5. Video Bản Tin Nóng / Thời Sự Kèm Dòng Chữ Chạy (BreakingNews) */}
      <Composition
        id="BreakingNews"
        component={BreakingNews as any}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          headline: "THỊ TRƯỜNG TÀI CHÍNH TOÀN CẦU BIẾN ĐỘNG MẠNH MẼ",
          sourceText: "BẢN TIN KINH TẾ 24H • SEN CHÚA AI",
          keyPoints: [
            "VN-Index tiếp tục thu hút dòng tiền lớn từ nhà đầu tư tổ chức.",
            "Tỷ giá và giá vàng duy trì vùng dao động ổn định sau can thiệp.",
            "Dự báo tăng trưởng kinh tế quý tới có nhiều điểm sáng vượt kỳ vọng.",
          ],
          tickerItems: [
            "VN-INDEX: 1,320.45 (+18.6)",
            "VÀNG SJC: 85.50 Tr/Lượng",
            "USD/VND: 25,410",
            "DẦU BRENT: $74.2/thùng",
          ],
          audioFile: "narration.mp3",
          bgMusicFile: "music/ambient-lofi.mp3",
        }}
      />
    </>
  );
};
