import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "../lib/format";

export interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Snap increment for linear knobs. */
  step?: number;
  /** "log" for frequencies: equal knob travel per octave. */
  scale?: "linear" | "log";
  displayValue?: string;
  disabled?: boolean;
  /** Turns typed text into a value; defaults to parseFloat. Return null to reject. */
  parseInput?: (text: string) => number | null;
  onChange: (value: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

const DRAG_SENSITIVITY = 0.008; // fraction of the range per pixel
const FINE_SENSITIVITY = 0.002; // with Shift held

function toFraction(value: number, min: number, max: number, scale: "linear" | "log") {
  if (scale === "log") return clamp(Math.log(value / min) / Math.log(max / min), 0, 1);
  return clamp((value - min) / (max - min || 1), 0, 1);
}

function fromFraction(fraction: number, min: number, max: number, scale: "linear" | "log") {
  return scale === "log" ? min * Math.pow(max / min, fraction) : min + fraction * (max - min);
}

/** Rotary knob: drag vertically (Shift = fine), double-click the readout to type a value. */
export function Knob({
  label,
  value,
  min,
  max,
  step = 0.01,
  scale = "linear",
  displayValue,
  disabled = false,
  parseInput,
  onChange,
  onGestureStart,
  onGestureEnd,
}: KnobProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ startY: number; startFraction: number } | null>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const fraction = toFraction(value, min, max, scale);
  const angle = -135 + fraction * 270;

  const commit = (next: number) => {
    let v = clamp(next, min, max);
    if (scale === "linear" && step) v = clamp(Math.round(v / step) * step, min, max);
    if (scale === "log") v = Math.round(v);
    onChange(v);
  };

  const commitTypedValue = () => {
    setIsEditing(false);
    const parsed = parseInput ? parseInput(inputText) : parseFloat(inputText);
    if (parsed !== null && Number.isFinite(parsed)) {
      onGestureStart?.();
      commit(parsed);
      onGestureEnd?.();
    }
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || isEditing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startFraction: fraction };
    onGestureStart?.();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || disabled) return;
    const sensitivity = e.shiftKey ? FINE_SENSITIVITY : DRAG_SENSITIVITY;
    const next = clamp(drag.current.startFraction + (drag.current.startY - e.clientY) * sensitivity, 0, 1);
    commit(fromFraction(next, min, max, scale));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.current) {
      drag.current = null;
      onGestureEnd?.();
    }
  };

  return (
    <div
      className={`flex select-none flex-col items-center gap-2 ${disabled ? "cursor-not-allowed opacity-30" : "cursor-ns-resize"}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-850 p-[3px] shadow-inner">
        <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90 p-1">
          <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="1.5" strokeDasharray="100" strokeDashoffset="25" />
        </svg>
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-full border border-zinc-600/80 bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-md will-change-transform"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="h-2.5 w-2.5 rounded-full border border-zinc-600/50 bg-zinc-900" />
          <div className="absolute top-0.5 h-2.5 w-0.5 rounded-full bg-zinc-200 shadow-sm" />
        </div>
      </div>

      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTypedValue();
            if (e.key === "Escape") setIsEditing(false);
          }}
          onBlur={commitTypedValue}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-14 rounded border border-zinc-600 bg-zinc-950 px-1 py-0.5 text-center font-mono text-[10px] text-white outline-none"
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            setInputText(String(Number(value.toFixed(3))));
            setIsEditing(true);
          }}
          title="Double-click to type a value"
          className="cursor-text font-mono text-[10px] font-medium text-zinc-300 hover:text-white hover:underline"
        >
          {displayValue ?? value.toFixed(2)}
        </span>
      )}
    </div>
  );
}
