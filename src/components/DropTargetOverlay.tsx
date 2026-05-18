interface DropTargetOverlayProps {
  state: "idle" | "dragging" | "hovering" | "hidden";
}

export default function DropTargetOverlay({ state }: DropTargetOverlayProps) {
  if (state === "hidden") return null;

  const isHovering = state === "hovering";
  const isDragging = state === "dragging";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div
        className="flex flex-col items-center justify-center rounded-full transition-all duration-300 ease-out"
        style={{
          width: isHovering ? 110 : 100,
          height: isHovering ? 110 : 100,
          border: isHovering
            ? "2px solid rgba(99, 102, 241, 0.5)"
            : isDragging
              ? "2px dashed rgba(165, 180, 252, 0.3)"
              : "2px dashed rgba(165, 180, 252, 0.2)",
          background: isHovering
            ? "rgba(99, 102, 241, 0.06)"
            : "transparent",
          boxShadow: isHovering
            ? "0 0 24px rgba(99, 102, 241, 0.25), inset 0 0 20px rgba(99, 102, 241, 0.06)"
            : "none",
          animation: isHovering
            ? "drop-target-glow 1.5s ease-in-out infinite"
            : isDragging
              ? "none"
              : "drop-target-pulse 3s ease-in-out infinite",
          opacity: isHovering ? 1 : isDragging ? 0.7 : 1,
        }}
      >
        {/* Crosshair / target icon */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 20 20"
          fill="none"
          className="transition-all duration-300"
          style={{
            opacity: isHovering ? 0.9 : isDragging ? 0.6 : 0.55,
            color: isHovering ? "#818cf8" : "#a5b4fc",
            filter: isHovering
              ? "drop-shadow(0 0 6px rgba(129,140,248,0.5))"
              : "drop-shadow(0 0 4px rgba(140,160,255,0.2))",
          }}
        >
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <line x1="10" y1="2" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="10" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="10" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="14" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <span
          className="mt-1.5 text-[10px] font-semibold tracking-widest uppercase transition-all duration-300"
          style={{
            color: isHovering ? "rgba(129, 140, 248, 0.9)" : isDragging ? "rgba(165, 180, 252, 0.6)" : "rgba(165, 180, 252, 0.5)",
            textShadow: isHovering
              ? "0 0 10px rgba(129,140,248,0.4)"
              : "0 0 8px rgba(140,160,255,0.15)",
          }}
        >
          {isHovering ? "release" : isDragging ? "drop here" : "drag here"}
        </span>
      </div>
    </div>
  );
}
