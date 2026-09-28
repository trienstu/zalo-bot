import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface WordTiming {
  text: string;
  startFrame: number;
  endFrame: number;
}

interface KineticCaptionsProps {
  words: string[];
  startFrame?: number;
  durationInFrames?: number;
  fontSize?: number;
  highlightColor?: string;
}

/**
 * Hiệu ứng phụ đề nhảy chữ Karaoke / CapCut phong cách Alex Hormozi:
 * Từng từ được đọc đến đâu sẽ phóng to (pop scale), đổi màu neon rực rỡ và phát sáng!
 */
export const KineticCaptions: React.FC<KineticCaptionsProps> = ({
  words,
  startFrame = 0,
  durationInFrames = 90,
  fontSize = 44,
  highlightColor = "#FACC15", // Vibrant Yellow
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const totalWords = words.length;
  if (totalWords === 0) return null;

  const framesPerWord = durationInFrames / totalWords;
  const currentWordIndex = Math.min(
    totalWords - 1,
    Math.max(0, Math.floor((frame - startFrame) / framesPerWord))
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "14px 18px",
        padding: "20px 30px",
        maxWidth: "920px",
        lineHeight: 1.4,
      }}
    >
      {words.map((word, index) => {
        const wordStartFrame = startFrame + index * framesPerWord;
        const isActive = index === currentWordIndex;
        const isPast = index < currentWordIndex;

        // Spring pop when the word becomes active
        const wordSpring = spring({
          frame: frame - wordStartFrame,
          fps,
          config: { damping: 10, stiffness: 200, mass: 0.5 },
        });

        const scale = isActive ? 1 + (wordSpring * 0.2) : 1;
        const color = isActive ? "#000000" : isPast ? "#FFFFFF" : "#64748B";
        const backgroundColor = isActive ? highlightColor : "transparent";
        const boxShadow = isActive ? `0 0 25px ${highlightColor}AA` : "none";

        return (
          <span
            key={index}
            style={{
              fontSize: `${fontSize}px`,
              fontWeight: 900,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Impact, sans-serif",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              padding: "4px 12px",
              borderRadius: "10px",
              color,
              backgroundColor,
              boxShadow,
              transform: `scale(${scale})`,
              display: "inline-block",
              transition: "color 0.1s ease",
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
