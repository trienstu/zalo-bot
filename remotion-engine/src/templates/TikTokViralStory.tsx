import React from "react";
import {
  AbsoluteFill,
  Audio,
  Series,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { KineticCaptions } from "../components/KineticCaptions";

export interface StoryScene {
  hookEmoji: string;
  badge: string;
  words: string[];
  subtext: string;
  accentColor: string;
}

export interface TikTokViralStoryProps {
  audioFile?: string;
  bgMusicFile?: string;
  scenes?: StoryScene[];
}

export const TikTokViralStory: React.FC<TikTokViralStoryProps> = ({
  audioFile = "narration.mp3",
  bgMusicFile = "music/ambient-lofi.mp3",
  scenes = [
    {
      hookEmoji: "🚨",
      badge: "CẢNH BÁO BÍ MẬT",
      words: ["BẠN", "CÓ", "BIẾT", "TẠI", "SAO", "90%", "AI", "AGENT", "THẤT", "BẠI?"],
      subtext: "Một sai lầm chí mạng mà hầu hết lập trình viên mắc phải",
      accentColor: "#EF4444",
    },
    {
      hookEmoji: "🧠",
      badge: "NGUYÊN NHÂN GỐC RỄ",
      words: ["VÌ", "CHÚNG", "KHÔNG", "CÓ", "ĐỒ", "THỊ", "TRI", "THỨC", "LIÊN", "KẾT!"],
      subtext: "Prompt dài không thể thay thế cho hệ thống bộ nhớ ngữ cảnh",
      accentColor: "#F59E0B",
    },
    {
      hookEmoji: "🚀",
      badge: "GIẢI PHÁP 2026",
      words: ["KẾT", "HỢP", "KNOWLEDGE", "GRAPH", "ĐỂ", "TỰ", "CHỦ", "100%!"],
      subtext: "Trải nghiệm ngay bot thế hệ mới cùng Sen Chúa AI",
      accentColor: "#10B981",
    },
  ],
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

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

  const framesPerScene = Math.floor(durationInFrames / scenes.length);

  return (
    <AbsoluteFill
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#ffffff",
        overflow: "hidden",
      }}
    >
      <GlowBackground primaryColor="#6366f1" secondaryColor="#ec4899" />
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

      <Series>
        {scenes.map((scene, idx) => (
          <Series.Sequence key={idx} durationInFrames={framesPerScene}>
            <StorySceneView scene={scene} durationInFrames={framesPerScene} />
          </Series.Sequence>
        ))}
      </Series>

      {/* Persistent Top Progress Bars (Story Segments like Instagram/TikTok) */}
      <div
        style={{
          position: "absolute",
          top: "40px",
          left: "40px",
          right: "40px",
          display: "flex",
          gap: "10px",
          zIndex: 100,
        }}
      >
        {scenes.map((_, sIdx) => {
          const segStart = sIdx * framesPerScene;
          const segEnd = segStart + framesPerScene;
          const segProgress = interpolate(frame, [segStart, segEnd], [0, 100], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={sIdx}
              style={{
                flex: 1,
                height: "6px",
                borderRadius: "999px",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${segProgress}%`,
                  backgroundColor: "#FFFFFF",
                  borderRadius: "999px",
                }}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const StorySceneView: React.FC<{ scene: StoryScene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entrance spring animation
  const emojiSpring = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 140, mass: 0.7 },
  });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "80px 40px",
        textAlign: "center",
      }}
    >
      {/* Huge Animated Emoji */}
      <div
        style={{
          fontSize: "120px",
          marginBottom: "24px",
          transform: `scale(${emojiSpring})`,
          filter: "drop-shadow(0 15px 30px rgba(0, 0, 0, 0.5))",
        }}
      >
        {scene.hookEmoji}
      </div>

      {/* Badge */}
      <div
        style={{
          padding: "10px 24px",
          borderRadius: "999px",
          backgroundColor: `${scene.accentColor}22`,
          border: `2px solid ${scene.accentColor}`,
          color: scene.accentColor,
          fontSize: "22px",
          fontWeight: 900,
          letterSpacing: "2px",
          textTransform: "uppercase",
          marginBottom: "36px",
          boxShadow: `0 0 25px ${scene.accentColor}44`,
        }}
      >
        {scene.badge}
      </div>

      {/* Kinetic Pop Captions */}
      <KineticCaptions
        words={scene.words}
        durationInFrames={durationInFrames}
        fontSize={46}
        highlightColor={scene.accentColor}
      />

      {/* Subtext */}
      <div
        style={{
          marginTop: "40px",
          fontSize: "26px",
          color: "#CBD5E1",
          maxWidth: "780px",
          lineHeight: 1.5,
          fontWeight: 500,
        }}
      >
        {scene.subtext}
      </div>
    </AbsoluteFill>
  );
};
