import { useRef, useState, useCallback, useEffect } from "react";

export type DragPhase = "idle" | "pending" | "dragging" | "hovering" | "snapping" | "returning";

interface UseDragToCenterOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerSize: number;
  dropRadius: number;
  onDrop: (symbol: string) => void;
}

interface DragState {
  draggedToken: string | null;
  slotIndex: number | null;
  isOverDropZone: boolean;
  isDragging: boolean;
  phase: DragPhase;
  ghostPos: { x: number; y: number } | null;
}

const DRAG_THRESHOLD = 8;
const INITIAL_STATE: DragState = {
  draggedToken: null,
  slotIndex: null,
  isOverDropZone: false,
  isDragging: false,
  phase: "idle",
  ghostPos: null,
};

export function useDragToCenter({
  containerRef,
  containerSize,
  dropRadius,
  onDrop,
}: UseDragToCenterOptions) {
  const ghostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DragState>(INITIAL_STATE);

  const ctx = useRef({
    startPos: null as { x: number; y: number } | null,
    totalMovement: 0,
    pendingToken: null as { symbol: string; slotIndex: number } | null,
    orbitPos: null as { x: number; y: number } | null,
    suppressClick: false,
    listening: false,
  });

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const center = containerSize / 2;

  const getContainerPos = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef],
  );

  const dist = useCallback(
    (x: number, y: number) => Math.sqrt((x - center) ** 2 + (y - center) ** 2),
    [center],
  );

  const resetState = useCallback(() => {
    setState(INITIAL_STATE);
    ctx.current.startPos = null;
    ctx.current.totalMovement = 0;
    ctx.current.pendingToken = null;
    ctx.current.orbitPos = null;
  }, []);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const c = ctx.current;
      const pos = getContainerPos(e.clientX, e.clientY);
      if (!pos || !c.startPos) return;

      const dx = e.clientX - c.startPos.x;
      const dy = e.clientY - c.startPos.y;
      c.totalMovement = Math.sqrt(dx * dx + dy * dy);

      if (c.totalMovement < DRAG_THRESHOLD) return;

      const pending = c.pendingToken;
      if (!pending) return;

      const overZone = dist(pos.x, pos.y) < dropRadius;

      if (ghostRef.current) {
        ghostRef.current.style.left = `${pos.x}px`;
        ghostRef.current.style.top = `${pos.y}px`;
        ghostRef.current.style.transition = "none";
      }

      setState((prev) => {
        const newPhase = overZone ? "hovering" : "dragging";
        if (prev.phase === newPhase && prev.isDragging && prev.isOverDropZone === overZone)
          return prev;
        return {
          draggedToken: pending.symbol,
          slotIndex: pending.slotIndex,
          isOverDropZone: overZone,
          isDragging: true,
          phase: newPhase,
          ghostPos: pos,
        };
      });
    },
    [getContainerPos, dist, dropRadius],
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      ctx.current.listening = false;

      const c = ctx.current;

      if (c.totalMovement < DRAG_THRESHOLD) {
        resetState();
        return;
      }

      c.suppressClick = true;
      setTimeout(() => { c.suppressClick = false; }, 100);

      const pos = getContainerPos(e.clientX, e.clientY);
      if (!pos) { resetState(); return; }

      const overZone = dist(pos.x, pos.y) < dropRadius;
      const token = c.pendingToken;

      if (overZone && token) {
        if (ghostRef.current) {
          ghostRef.current.style.transition =
            "left 200ms cubic-bezier(0.34,1.56,0.64,1), top 200ms cubic-bezier(0.34,1.56,0.64,1), transform 200ms ease";
          ghostRef.current.style.left = `${center}px`;
          ghostRef.current.style.top = `${center}px`;
        }
        setState((prev) => ({ ...prev, phase: "snapping", isOverDropZone: true }));
        setTimeout(() => {
          onDropRef.current(token.symbol);
          resetState();
        }, 220);
      } else if (token && c.orbitPos) {
        const orbit = c.orbitPos;
        if (ghostRef.current) {
          ghostRef.current.style.transition =
            "left 300ms cubic-bezier(0.25,0.46,0.45,0.94), top 300ms cubic-bezier(0.25,0.46,0.45,0.94), opacity 300ms ease";
          ghostRef.current.style.left = `${orbit.x}px`;
          ghostRef.current.style.top = `${orbit.y}px`;
          ghostRef.current.style.opacity = "0";
        }
        setState((prev) => ({ ...prev, phase: "returning" }));
        setTimeout(resetState, 320);
      } else {
        resetState();
      }
    },
    [onMove, getContainerPos, dist, dropRadius, center, resetState],
  );

  const bind = useCallback(
    (symbol: string, slotIndex: number, orbitX: number, orbitY: number) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();

        const c = ctx.current;
        c.startPos = { x: e.clientX, y: e.clientY };
        c.totalMovement = 0;
        c.pendingToken = { symbol, slotIndex };
        c.orbitPos = { x: orbitX, y: orbitY };

        setState((prev) => ({ ...prev, draggedToken: null, phase: "pending" }));

        if (!c.listening) {
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          c.listening = true;
        }
      },
    }),
    [onMove, onUp],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onMove, onUp]);

  return {
    ...state,
    ghostRef,
    bind,
    suppressClick: () => ctx.current.suppressClick,
  };
}
