// Small shared building blocks used across the decks.

import type { ReactNode } from "react";

type DotTone = "emerald" | "white" | "amber";

const DOT_ON: Record<DotTone, string> = {
  emerald: "bg-emerald-400 shadow-[0_0_6px_#34d399]",
  white: "bg-zinc-200 shadow-[0_0_6px_rgba(255,255,255,0.7)]",
  amber: "bg-amber-400 shadow-[0_0_6px_#fbbf24]",
};

/** The little LED used on toggles and tab enable buttons. */
export function StatusDot({ on, tone = "emerald", size = "sm" }: { on: boolean; tone?: DotTone; size?: "sm" | "md" }) {
  const dimensions = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";
  return <span className={`${dimensions} shrink-0 rounded-full transition-all ${on ? DOT_ON[tone] : "bg-zinc-600"}`} />;
}

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** A row of mutually exclusive buttons (rates, slopes, step counts...). */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <div className="flex items-center rounded-lg border border-zinc-750 bg-zinc-900 p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`rounded font-mono font-bold transition ${padding} ${
            option.value === value
              ? "border border-zinc-600 bg-zinc-750 text-white shadow-sm"
              : "border border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Pill button with an LED, e.g. "Preserve Speed", "Sync DAW". */
export function LedToggle({
  on,
  onToggle,
  children,
  title,
  tone = "white",
  className = "",
}: {
  on: boolean;
  onToggle: () => void;
  children: ReactNode;
  title?: string;
  tone?: DotTone;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={title}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
        on ? "border-zinc-600 bg-zinc-800 text-white shadow-sm" : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
      } ${className}`}
    >
      <StatusDot on={on} tone={tone} />
      <span>{children}</span>
    </button>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] font-bold uppercase text-zinc-500">{children}</span>;
}

/** Rounded dark card used for the lower control panels. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-xl ${className}`}>{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="py-0.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">{children}</span>;
}

export function VerticalDivider({ className = "h-24" }: { className?: string }) {
  return <div className={`w-px self-center bg-zinc-800/80 ${className}`} />;
}
