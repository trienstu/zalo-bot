import React from "react";
import { useCurrentFrame } from "remotion";

interface AudioVisualizerProps {
  barCount?: number;
  color?: string;
  height?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  barCount = 8,
  color = "#818cf8",
  height = 36,
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "6px",
        height: `${height}px`,
      }}
    >
      {Array.from({ length: barCount }).map((_, i) => {
        // Pseudo-audio frequency spectrum simulation
        const wave1 = Math.sin((frame * 0.25) + i * 1.2);
        const wave2 = Math.cos((frame * 0.15) + i * 0.7);
        const factor = Math.max(0.15, Math.min(1.0, (wave1 + wave2 + 2) / 4));
        const barHeight = factor * height;

        return (
          <div
            key={i}
            style={{
              width: "5px",
              height: `${barHeight}px`,
              borderRadius: "4px",
              background: `linear-gradient(180deg, #ec4899 0%, ${color} 100%)`,
              transition: "height 0.05s ease",
            }}
          />
        );
      })}
    </div>
  );
};
