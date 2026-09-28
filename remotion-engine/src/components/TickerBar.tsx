import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface TickerBarProps {
  items: string[];
  speed?: number;
  label?: string;
  labelColor?: string;
}

export const TickerBar: React.FC<TickerBarProps> = ({
  items,
  speed = 4,
  label = "TIN MỚI",
  labelColor = "#EF4444",
}) => {
  const frame = useCurrentFrame();

  const repeatedText = [...items, ...items, ...items].join("   •   ");
  const offset = (frame * speed) % 2000;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "64px",
        backgroundColor: "#0B0F19",
        borderTop: "2px solid #EF4444",
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        zIndex: 50,
      }}
    >
      {/* Fixed Badge */}
      <div
        style={{
          height: "100%",
          padding: "0 28px",
          backgroundColor: labelColor,
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          fontWeight: 900,
          fontSize: "20px",
          letterSpacing: "1px",
          flexShrink: 0,
          zIndex: 10,
          boxShadow: "5px 0 15px rgba(0, 0, 0, 0.4)",
        }}
      >
        🔴 {label}
      </div>

      {/* Scrolling Text */}
      <div
        style={{
          whiteSpace: "nowrap",
          transform: `translateX(-${offset}px)`,
          fontSize: "22px",
          fontWeight: 600,
          color: "#F8FAFC",
          paddingLeft: "20px",
        }}
      >
        {repeatedText}
      </div>
    </div>
  );
};
