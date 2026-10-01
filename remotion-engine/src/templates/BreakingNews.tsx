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
import { TickerBar } from "../components/TickerBar";
import { AudioVisualizer } from "../components/AudioVisualizer";

export interface BreakingNewsProps {
  headline: string;
  sourceText?: string;
  keyPoints: string[];
  tickerItems?: string[];
  audioFile?: string;
  bgMusicFile?: string;
}

export const BreakingNews: React.FC<BreakingNewsProps> = ({
  headline = "THỊ TRƯỜNG CHỨNG KHOÁN BÙNG NỔ THANH KHOẢN 35.000 TỶ",
  sourceText = "BẢN TIN KINH TẾ 24H • SEN CHÚA AI",
  keyPoints = [
    "VN-Index vượt mốc kháng cự mạnh với đà lan tỏa toàn thị trường.",
    "Khối ngoại quay lại mua ròng mạnh mẽ nhóm cổ phiếu Ngân hàng & Bán lẻ.",
    "Thanh khoản lập đỉnh cao nhất trong vòng 6 tháng qua.",
  ],
  tickerItems = [
    "VN-INDEX: 1,320.45 (+18.6)",
    "VN30: 1,385.12 (+22.4)",
    "VÀNG SJC: 85.50 Tr/Lượng",
    "USD/VND: 25,410",
    "DẦU BRENT: $74.2/thùng",
  ],
  audioFile = "narration.mp3",
  bgMusicFile = "music/ambient-lofi.mp3",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Flashing red live indicator
  const flashOpacity = 0.6 + 0.4 * Math.sin(frame * 0.2);

  const cardSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const audioSrc = audioFile
    ? audioFile.startsWith("http") || audioFile.startsWith("data:")
      ? audioFile
      : staticFile(audioFile)
    : null;

  const bgMusicSrc = bgMusicFile
    ? bgMusicFile.startsWith("http") || bgMusicFile.startsWith("data:")
      ? bgMusicFile
      : staticFile(bgMusicFile)
    : null;

  return (
    <AbsoluteFill
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "70px 50px 100px 50px", // extra bottom for TickerBar
        overflow: "hidden",
      }}
    >
      <GlowBackground primaryColor="#EF4444" secondaryColor="#3B82F6" />
      {/* Background Music with Audio Ducking */}
      {bgMusicSrc && (
        <Audio
          src={bgMusicSrc}
          loop
          volume={(f) =>
            interpolate(
              f,
              [0, 30, Math.max(31, durationInFrames - 30), durationInFrames],
              [0, 0.14, 0.14, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )
          }
        />
      )}
      {audioSrc && <Audio src={audioSrc} volume={1.0} />}

      {/* Top News Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              padding: "10px 22px",
              borderRadius: "8px",
              backgroundColor: "#DC2626",
              color: "#ffffff",
              fontSize: "20px",
              fontWeight: 900,
              letterSpacing: "2px",
              boxShadow: `0 0 20px rgba(220, 38, 38, ${flashOpacity})`,
            }}
          >
            ⚡ BREAKING NEWS
          </div>
          <span style={{ fontSize: "18px", color: "#CBD5E1", fontWeight: 600 }}>
            {sourceText}
          </span>
        </div>

        <AudioVisualizer barCount={8} color="#EF4444" height={28} />
      </div>

      {/* Main Glass News Card */}
      <div
        style={{
          width: "100%",
          padding: "50px 40px",
          borderRadius: "32px",
          background: "rgba(15, 23, 42, 0.75)",
          border: "2px solid rgba(239, 68, 68, 0.4)",
          backdropFilter: "blur(40px)",
          transform: `scale(${cardSpring})`,
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.7)",
          zIndex: 10,
        }}
      >
        {/* Headline */}
        <h1
          style={{
            fontSize: "48px",
            fontWeight: 900,
            lineHeight: 1.3,
            margin: "0 0 32px 0",
            color: "#FFFFFF",
            letterSpacing: "-0.5px",
            borderLeft: "6px solid #EF4444",
            paddingLeft: "20px",
          }}
        >
          {headline}
        </h1>

        {/* Bullet Points */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {keyPoints.map((pt, idx) => {
            const delay = 15 + idx * 10;
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
                  opacity: interpolate(frame, [delay, delay + 8], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                }}
              >
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    backgroundColor: "#EF444422",
                    border: "1px solid #EF4444",
                    color: "#EF4444",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontSize: "18px",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}
                </div>
                <div style={{ fontSize: "24px", color: "#F8FAFC", lineHeight: 1.4, fontWeight: 500 }}>
                  {pt}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrolling Ticker at Bottom */}
      <TickerBar items={tickerItems} speed={5} label="THỜI SỰ" labelColor="#DC2626" />
    </AbsoluteFill>
  );
};
