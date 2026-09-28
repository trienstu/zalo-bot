import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface GlowBackgroundProps {
  primaryColor?: string;
  secondaryColor?: string;
}

export const GlowBackground: React.FC<GlowBackgroundProps> = ({
  primaryColor = "#4f46e5",
  secondaryColor = "#ec4899",
}) => {
  const frame = useCurrentFrame();

  const rot1 = interpolate(frame, [0, 300], [0, 360]);
  const rot2 = interpolate(frame, [0, 300], [360, 0]);
  const pulse = 1 + 0.08 * Math.sin(frame * 0.05);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#07090E",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      {/* Mesh Orb 1 */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "15%",
          width: "700px",
          height: "700px",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${primaryColor}44 0%, transparent 70%)`,
          filter: "blur(100px)",
          transform: `rotate(${rot1}deg) scale(${pulse})`,
        }}
      />

      {/* Mesh Orb 2 */}
      <div
        style={{
          position: "absolute",
          bottom: "15%",
          right: "10%",
          width: "800px",
          height: "800px",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${secondaryColor}33 0%, transparent 70%)`,
          filter: "blur(110px)",
          transform: `rotate(${rot2}deg) scale(${pulse})`,
        }}
      />

      {/* Subtle Dot Grid Overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          opacity: 0.5,
        }}
      />
    </div>
  );
};
