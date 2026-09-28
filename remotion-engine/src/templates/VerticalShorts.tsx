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

export interface VerticalShortsProps {
  badge: string;
  title: string;
  subtitle: string;
  points: string[];
  audioFile?: string;
  speakerName?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export const VerticalShorts: React.FC<VerticalShortsProps> = ({
  badge = "AI KNOWLEDGE",
  title = "3 ĐỘT PHÁ CỦA AI AGENT",
  subtitle = "Thay đổi phương thức vận hành doanh nghiệp 2026",
  points = [
    "Tự chủ điều hướng quy trình (Autonomous Planning)",
    "Đồ thị tri thức hợp nhất (Unified Knowledge Graph)",
    "Tương tác thời gian thực đa phương tiện (Realtime Multimodal)",
  ],
  audioFile,
  speakerName = "Sen Chúa AI",
  primaryColor = "#4f46e5",
  secondaryColor = "#ec4899",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Entrance spring animation for main container
  const containerScale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100, mass: 0.9 },
  });

  const containerOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Dynamic progress percentage
  const progressPercent = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });

  // Audio source resolution
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
        padding: "80px 60px",
        overflow: "hidden",
      }}
    >
      {/* Background with Ambient Orbs */}
      <GlowBackground primaryColor={primaryColor} secondaryColor={secondaryColor} />

      {/* Embedded Audio */}
      {audioSrc && <Audio src={audioSrc} />}

      {/* Top Header: Brand + Speaker + Audio Waveform */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
          background: "rgba(255, 255, 255, 0.05)",
          padding: "16px 28px",
          borderRadius: "999px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "#10b981",
              boxShadow: "0 0 12px #10b981",
            }}
          />
          <span style={{ fontSize: "22px", fontWeight: 600, color: "#e2e8f0" }}>
            {speakerName}
          </span>
        </div>
        <AudioVisualizer barCount={7} color={primaryColor} height={28} />
      </div>

      {/* Center Body: Glassmorphism Card */}
      <div
        style={{
          width: "100%",
          padding: "60px 48px",
          borderRadius: "36px",
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          backdropFilter: "blur(40px)",
          boxShadow: "0 25px 70px rgba(0, 0, 0, 0.6)",
          transform: `scale(${containerScale})`,
          opacity: containerOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          zIndex: 10,
        }}
      >
        {/* Glow Badge */}
        <div
          style={{
            padding: "10px 24px",
            borderRadius: "999px",
            background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
            color: "#ffffff",
            fontSize: "22px",
            fontWeight: 800,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            marginBottom: "30px",
            boxShadow: `0 6px 20px ${secondaryColor}66`,
          }}
        >
          ✨ {badge}
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "58px",
            fontWeight: 800,
            lineHeight: 1.25,
            margin: "0 0 20px 0",
            background: "linear-gradient(180deg, #FFFFFF 30%, #C7D2FE 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.5px",
          }}
        >
          {title}
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: "28px",
            color: "#94a3b8",
            lineHeight: 1.5,
            margin: "0 0 40px 0",
          }}
        >
          {subtitle}
        </p>

        {/* Staggered Bullet Points */}
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            textAlign: "left",
          }}
        >
          {points.map((pt, idx) => {
            const delay = 15 + idx * 10;
            const itemSpring = spring({
              frame: frame - delay,
              fps,
              config: { damping: 14, stiffness: 120 },
            });
            const itemOpacity = interpolate(frame, [delay, delay + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "18px",
                  padding: "18px 24px",
                  borderRadius: "18px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  transform: `translateX(${(1 - itemSpring) * -35}px)`,
                  opacity: itemOpacity,
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "12px",
                    background: `${primaryColor}33`,
                    border: `1px solid ${primaryColor}77`,
                    color: "#a5b4fc",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontSize: "20px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}
                </div>
                <div
                  style={{
                    fontSize: "25px",
                    fontWeight: 500,
                    color: "#f8fafc",
                    lineHeight: 1.4,
                  }}
                >
                  {pt}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer / Progress Bar */}
      <div style={{ zIndex: 10, width: "100%" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "20px",
            color: "#64748b",
            marginBottom: "12px",
            fontWeight: 500,
          }}
        >
          <span>Remotion AI Engine</span>
          <span>Full HD 9:16</span>
        </div>
        <div
          style={{
            height: "8px",
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
