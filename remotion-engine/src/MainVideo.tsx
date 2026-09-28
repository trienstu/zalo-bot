import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface VideoProps {
  title: string;
  badge: string;
  subtitle: string;
  points: string[];
}

export const MainVideo: React.FC<VideoProps> = ({
  title,
  badge,
  subtitle,
  points,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entrance spring animation for the main card
  const cardScale = spring({
    frame,
    fps,
    config: {
      damping: 12,
      stiffness: 100,
      mass: 0.8,
    },
  });

  const cardOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Animated background gradient position
  const bgRotation = interpolate(frame, [0, 150], [0, 45]);

  // Progress bar along the bottom
  const progress = interpolate(frame, [0, 150], [0, 100], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B0F19",
        color: "#ffffff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "60px",
        overflow: "hidden",
      }}
    >
      {/* Dynamic Background Glow */}
      <div
        style={{
          position: "absolute",
          width: "900px",
          height: "900px",
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, rgba(236, 72, 153, 0.15) 50%, transparent 70%)`,
          filter: "blur(80px)",
          transform: `rotate(${bgRotation}deg) scale(${1 + 0.1 * Math.sin(frame / 20)})`,
        }}
      />

      {/* Main Glassmorphism Card */}
      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          padding: "70px 50px",
          borderRadius: "40px",
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          backdropFilter: "blur(30px)",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.5)",
          transform: `scale(${cardScale})`,
          opacity: cardOpacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          zIndex: 10,
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 28px",
            borderRadius: "999px",
            background: "linear-gradient(135deg, #4f46e5 0%, #ec4899 100%)",
            color: "#ffffff",
            fontSize: "26px",
            fontWeight: "bold",
            letterSpacing: "2px",
            textTransform: "uppercase",
            marginBottom: "35px",
            boxShadow: "0 8px 25px rgba(236, 72, 153, 0.35)",
          }}
        >
          ✨ {badge}
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "64px",
            fontWeight: 800,
            lineHeight: 1.25,
            margin: "0 0 24px 0",
            background: "linear-gradient(180deg, #FFFFFF 30%, #A5B4FC 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-1px",
          }}
        >
          {title}
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: "32px",
            color: "#CBD5E1",
            lineHeight: 1.5,
            margin: "0 0 45px 0",
            fontWeight: 400,
          }}
        >
          {subtitle}
        </p>

        {/* Bullet Points with staggered spring entry */}
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            textAlign: "left",
          }}
        >
          {points.map((point, index) => {
            const delay = 20 + index * 12;
            const itemSpring = spring({
              frame: frame - delay,
              fps,
              config: { damping: 14, stiffness: 120 },
            });
            const itemOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "20px",
                  padding: "20px 28px",
                  borderRadius: "20px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  transform: `translateX(${(1 - itemSpring) * -40}px)`,
                  opacity: itemOpacity,
                }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "12px",
                    background: "rgba(99, 102, 241, 0.2)",
                    border: "1px solid rgba(99, 102, 241, 0.4)",
                    color: "#818cf8",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontSize: "22px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </div>
                <div
                  style={{
                    fontSize: "28px",
                    fontWeight: 500,
                    color: "#F1F5F9",
                    lineHeight: 1.4,
                  }}
                >
                  {point}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Bar along bottom */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          left: "60px",
          right: "60px",
          height: "8px",
          borderRadius: "999px",
          background: "rgba(255, 255, 255, 0.1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "linear-gradient(90deg, #6366F1, #EC4899)",
            borderRadius: "999px",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
