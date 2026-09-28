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
import { AudioVisualizer } from "../components/AudioVisualizer";

export interface MetricItem {
  label: string;
  value: string;
  subtext: string;
}

export interface LandscapeExplainerProps {
  badge: string;
  title: string;
  subtitle: string;
  bulletPoints: string[];
  metrics: MetricItem[];
  audioFile?: string;
  speakerName?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export const LandscapeExplainer: React.FC<LandscapeExplainerProps> = ({
  badge = "BÁO CÁO DỰ ÁN",
  title = "KIẾN TRÚC VẬN HÀNH TỰ ĐỘNG HÓA",
  subtitle = "Tối ưu hóa hiệu suất xử lý tác vụ thông minh trên hạ tầng đám mây",
  bulletPoints = [
    "Hệ thống định tuyến Query Planner giảm 80% độ trễ xử lý.",
    "Engine Remotion xuất bản video đồ họa chuyển động thời gian thực.",
    "Khả năng mở rộng đa luồng xử lý đồng thời không nghẽn tài nguyên.",
  ],
  metrics = [
    { label: "TỐC ĐỘ RENDER", value: "12 FPS", subtext: "Gấp 3 lần chuẩn cũ" },
    { label: "TIẾT KIỆM BĂNG THÔNG", value: "75%", subtext: "Nén chuẩn H.264" },
    { label: "ĐỘ TIN CẬY", value: "99.9%", subtext: "Zero-Downtime Worker" },
  ],
  audioFile,
  speakerName = "Ban Dự Án - Bot Sen Chúa",
  primaryColor = "#3b82f6",
  secondaryColor = "#8b5cf6",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Entrance spring animations
  const leftColSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const rightColSpring = spring({
    frame: frame - 6,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  // Dynamic progress percentage
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
        padding: "60px 80px",
        overflow: "hidden",
      }}
    >
      {/* Background */}
      <GlowBackground primaryColor={primaryColor} secondaryColor={secondaryColor} />

      {/* Embedded Audio */}
      {audioSrc && <Audio src={audioSrc} />}

      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div
          style={{
            padding: "8px 20px",
            borderRadius: "999px",
            background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
            fontSize: "18px",
            fontWeight: 700,
            letterSpacing: "1px",
            boxShadow: `0 4px 15px ${primaryColor}55`,
          }}
        >
          {badge}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            background: "rgba(255, 255, 255, 0.05)",
            padding: "10px 24px",
            borderRadius: "999px",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            backdropFilter: "blur(20px)",
          }}
        >
          <span style={{ fontSize: "18px", color: "#cbd5e1", fontWeight: 500 }}>
            {speakerName}
          </span>
          <AudioVisualizer barCount={9} color={secondaryColor} height={24} />
        </div>
      </div>

      {/* Main Grid: Left (Content) & Right (Metrics) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: "50px",
          alignItems: "center",
          zIndex: 10,
          margin: "30px 0",
        }}
      >
        {/* Left Column */}
        <div
          style={{
            transform: `translateX(${(1 - leftColSpring) * -50}px)`,
            opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          <h1
            style={{
              fontSize: "48px",
              fontWeight: 800,
              lineHeight: 1.25,
              margin: "0 0 16px 0",
              background: "linear-gradient(180deg, #FFFFFF 40%, #BFDBFE 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {title}
          </h1>

          <p
            style={{
              fontSize: "22px",
              color: "#94a3b8",
              lineHeight: 1.5,
              margin: "0 0 32px 0",
            }}
          >
            {subtitle}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {bulletPoints.map((pt, idx) => {
              const delay = 12 + idx * 8;
              const ptSpring = spring({
                frame: frame - delay,
                fps,
                config: { damping: 14, stiffness: 120 },
              });

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "16px 20px",
                    borderRadius: "16px",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    transform: `translateX(${(1 - ptSpring) * -30}px)`,
                    opacity: interpolate(frame, [delay, delay + 6], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    }),
                  }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "10px",
                      background: `${primaryColor}33`,
                      border: `1px solid ${primaryColor}77`,
                      color: "#93c5fd",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      fontSize: "16px",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    ✓
                  </div>
                  <span style={{ fontSize: "20px", color: "#f1f5f9", lineHeight: 1.4 }}>
                    {pt}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Dynamic Metric Cards */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            transform: `scale(${rightColSpring})`,
            opacity: interpolate(frame, [6, 16], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          {metrics.map((m, idx) => {
            const mDelay = 20 + idx * 10;
            const cardSpring = spring({
              frame: frame - mDelay,
              fps,
              config: { damping: 12, stiffness: 100 },
            });

            return (
              <div
                key={idx}
                style={{
                  padding: "24px 28px",
                  borderRadius: "24px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  backdropFilter: "blur(30px)",
                  boxShadow: "0 15px 35px rgba(0, 0, 0, 0.4)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transform: `scale(${cardSpring})`,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#94a3b8",
                      letterSpacing: "1px",
                      marginBottom: "6px",
                    }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{
                      fontSize: "40px",
                      fontWeight: 800,
                      color: "#60a5fa",
                      lineHeight: 1,
                    }}
                  >
                    {m.value}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "16px",
                    color: "#cbd5e1",
                    background: "rgba(255, 255, 255, 0.06)",
                    padding: "8px 16px",
                    borderRadius: "12px",
                    fontWeight: 500,
                  }}
                >
                  {m.subtext}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Progress Bar */}
      <div style={{ zIndex: 10, width: "100%" }}>
        <div
          style={{
            height: "6px",
            width: "100%",
            borderRadius: "999px",
            background: "rgba(255, 255, 255, 0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`,
              borderRadius: "999px",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
