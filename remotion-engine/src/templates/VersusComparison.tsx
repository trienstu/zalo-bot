import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";

export interface OptionData {
  name: string;
  badge: string;
  color: string;
  points: string[];
}

export interface VersusComparisonProps {
  title?: string;
  subtitle?: string;
  optionA?: OptionData;
  optionB?: OptionData;
  audioFile?: string;
}

export const VersusComparison: React.FC<VersusComparisonProps> = ({
  title = "ĐẦU TƯ 2026: NÊN CHỌN KÊNH NÀO?",
  subtitle = "So sánh chuyên sâu hai kênh tài sản truyền thống hàng đầu",
  optionA = {
    name: "VÀNG SJC",
    badge: "TRÚ ẨN AN TOÀN",
    color: "#EAB308",
    points: [
      "Thanh khoản tức thì, dễ mua bán",
      "Bảo toàn giá trị chống lạm phát",
      "Không tạo dòng tiền thụ động định kỳ",
    ],
  },
  optionB = {
    name: "BẤT ĐỘNG SẢN",
    badge: "LÃI VỐN & DÒNG TIỀN",
    color: "#10B981",
    points: [
      "Đòn bẩy tài chính ngân hàng tối ưu",
      "Tạo dòng tiền cho thuê bền vững",
      "Vốn đầu vào lớn, thanh khoản chậm hơn",
    ],
  },
  audioFile = "narration.mp3",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const cardASpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const cardBSpring = spring({
    frame: frame - 5,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const vsScale = spring({
    frame: frame - 15,
    fps,
    config: { damping: 8, stiffness: 160 },
  });

  const progressPercent = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });

  const audioSrc = audioFile
    ? audioFile.startsWith("http") || audioFile.startsWith("data:")
      ? audioFile
      : staticFile(audioFile)
    : null;

  return (
    <AbsoluteFill
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "70px 50px",
        overflow: "hidden",
      }}
    >
      <GlowBackground primaryColor={optionA.color} secondaryColor={optionB.color} />
      {audioSrc && <Audio src={audioSrc} />}

      {/* Top Header */}
      <div style={{ textAlign: "center", zIndex: 10 }}>
        <h1
          style={{
            fontSize: "52px",
            fontWeight: 900,
            margin: "0 0 14px 0",
            background: "linear-gradient(180deg, #FFFFFF 40%, #E2E8F0 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.5px",
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: "24px", color: "#94a3b8", margin: 0 }}>{subtitle}</p>
      </div>

      {/* Center Side-by-Side (or Stacked in 9:16) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "24px",
          position: "relative",
          zIndex: 10,
          margin: "20px 0",
        }}
      >
        {/* Card A */}
        <div
          style={{
            padding: "36px 32px",
            borderRadius: "28px",
            background: "rgba(255, 255, 255, 0.05)",
            border: `2px solid ${optionA.color}66`,
            backdropFilter: "blur(30px)",
            transform: `scale(${cardASpring})`,
            boxShadow: `0 15px 40px ${optionA.color}22`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <span style={{ fontSize: "36px", fontWeight: 900, color: optionA.color }}>
              {optionA.name}
            </span>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 800,
                padding: "6px 16px",
                borderRadius: "999px",
                backgroundColor: `${optionA.color}22`,
                color: optionA.color,
                border: `1px solid ${optionA.color}`,
              }}
            >
              {optionA.badge}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {optionA.points.map((p, idx) => (
              <div key={idx} style={{ fontSize: "22px", color: "#F1F5F9", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ color: optionA.color, fontWeight: 700 }}>•</span> {p}
              </div>
            ))}
          </div>
        </div>

        {/* Floating Pulsing VS Badge */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${vsScale})`,
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #EF4444 0%, #F59E0B 100%)",
            color: "#ffffff",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontSize: "30px",
            fontWeight: 900,
            border: "4px solid #0B0F19",
            boxShadow: "0 0 30px rgba(239, 68, 68, 0.8)",
            zIndex: 20,
          }}
        >
          VS
        </div>

        {/* Card B */}
        <div
          style={{
            padding: "36px 32px",
            borderRadius: "28px",
            background: "rgba(255, 255, 255, 0.05)",
            border: `2px solid ${optionB.color}66`,
            backdropFilter: "blur(30px)",
            transform: `scale(${cardBSpring})`,
            boxShadow: `0 15px 40px ${optionB.color}22`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <span style={{ fontSize: "36px", fontWeight: 900, color: optionB.color }}>
              {optionB.name}
            </span>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 800,
                padding: "6px 16px",
                borderRadius: "999px",
                backgroundColor: `${optionB.color}22`,
                color: optionB.color,
                border: `1px solid ${optionB.color}`,
              }}
            >
              {optionB.badge}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {optionB.points.map((p, idx) => (
              <div key={idx} style={{ fontSize: "22px", color: "#F1F5F9", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ color: optionB.color, fontWeight: 700 }}>•</span> {p}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ zIndex: 10 }}>
        <div
          style={{
            height: "8px",
            width: "100%",
            borderRadius: "999px",
            backgroundColor: "rgba(255, 255, 255, 0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: `linear-gradient(90deg, ${optionA.color}, ${optionB.color})`,
              borderRadius: "999px",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
