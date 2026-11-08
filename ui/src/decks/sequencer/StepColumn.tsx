import type { PointerEvent as ReactPointerEvent } from "react";
import type { SequencerLane, SequencerStep, StepHalf, StepPattern } from "../../bridge/types";
import { type HalfKey, LANES, laneValue, toggleSplit, updateHalf } from "./patternEditing";

/** Shared drag state so one press can paint across many steps. */
export interface EditSession {
  paintTarget: boolean | null; // dragging over step buttons sets them to this
  drawingLane: boolean;        // dragging over lanes draws values
  lastAuditioned: string;
}

export interface StepColumnProps {
  index: number;
  step: SequencerStep;
  lane: SequencerLane;
  playheadHalf: 0 | 1 | null; // which half the playhead is on, or null if elsewhere
  armed: boolean;             // keys held: the playhead is actually triggering
  session: EditSession;
  edit: (update: (pattern: StepPattern) => StepPattern) => void;
  audition: (half: StepHalf) => void;
}

/** Pads and lane controls share this width so each pad sits exactly above its slider. */
const CONTROL_WIDTH = "w-full max-w-[24px]";

const ACCENT_FILL = {
  neutral: { up: "from-zinc-600 via-zinc-400 to-zinc-200 border-t-2 border-white", down: "", badge: "" },
  amber: { up: "from-zinc-600 via-amber-400 to-amber-200 border-t border-white", down: "from-zinc-600 via-amber-500 to-amber-700 border-b border-amber-300", badge: "border-amber-500/40 bg-amber-400/20 text-amber-300" },
  sky: { up: "from-zinc-600 via-sky-400 to-sky-200 border-t border-white", down: "from-zinc-600 via-sky-500 to-sky-700 border-b border-sky-300", badge: "border-sky-500/40 bg-sky-500/20 text-sky-300" },
};

/** Vertical value lane (velocity, pitch offset or pan) for one half of a step. */
function StepLane({ index, halfKey, half, label, isPlayhead, lane, session, edit, audition }: {
  index: number;
  halfKey: HalfKey;
  half: StepHalf;
  label: string;
  isPlayhead: boolean;
  lane: SequencerLane;
  session: EditSession;
  edit: StepColumnProps["edit"];
  audition: StepColumnProps["audition"];
}) {
  const definition = LANES[lane];
  const value = laneValue(half, lane);
  const accent = ACCENT_FILL[definition.accent];
  const key = `${index}-${halfKey}`;

  const write = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    edit((p) => updateHalf(p, index, halfKey, { [definition.field]: definition.fromFraction(fraction) }));
  };

  const auditionOnce = () => {
    if (session.lastAuditioned === key) return;
    session.lastAuditioned = key;
    audition(half);
  };

  const fillOpacity = half.on ? "opacity-100" : "opacity-45";
  const magnitude = (Math.abs(value) / definition.range) * 50;

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col items-center justify-end pt-1">
      <span
        className={`mb-0.5 max-w-full truncate rounded px-0.5 text-center font-mono text-[7px] font-bold transition-opacity ${half.on ? "opacity-100" : "opacity-60"} ${
          definition.bipolar ? (value !== 0 ? `border ${accent.badge}` : "border border-zinc-800 bg-zinc-900 text-zinc-400") : half.on ? "text-[8px] text-zinc-200" : "text-[8px] text-zinc-500"
        }`}
      >
        {definition.badge(value)}
      </span>

      <div
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          session.drawingLane = true;
          session.lastAuditioned = "";
          write(e);
          auditionOnce();
        }}
        onPointerEnter={(e) => {
          if (session.drawingLane && e.buttons === 1) {
            write(e);
            auditionOnce();
          }
        }}
        onPointerMove={(e) => session.drawingLane && e.buttons === 1 && write(e)}
        onDoubleClick={() => definition.bipolar && edit((p) => updateHalf(p, index, halfKey, { [definition.field]: definition.defaultValue }))}
        title={`Step ${label} ${definition.label}: ${definition.badge(value)}`}
        className={`relative flex ${CONTROL_WIDTH} flex-1 cursor-ns-resize touch-none select-none flex-col justify-end overflow-hidden rounded-md border bg-zinc-900 transition-all ${
          isPlayhead ? "border-white shadow-[0_0_6px_rgba(255,255,255,0.3)]" : half.on ? "border-zinc-400 shadow-sm" : "border-zinc-800 opacity-60 hover:border-zinc-600"
        }`}
      >
        {!definition.bipolar ? (
          <div className={`pointer-events-none w-full bg-gradient-to-t transition-opacity ${accent.up} ${fillOpacity}`} style={{ height: `${(value / 127) * 100}%` }} />
        ) : (
          <>
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 border-b border-white/40" />
            {value > 0 && <div className={`pointer-events-none absolute left-0 right-0 bg-gradient-to-t ${accent.up} ${fillOpacity}`} style={{ bottom: "50%", height: `${magnitude}%` }} />}
            {value < 0 && <div className={`pointer-events-none absolute left-0 right-0 bg-gradient-to-b ${accent.down} ${fillOpacity}`} style={{ top: "50%", height: `${magnitude}%` }} />}
            {value === 0 && (
              <div className={`pointer-events-none absolute left-0.5 right-0.5 top-[46%] h-1 rounded-full ${lane === "arp" ? "bg-amber-400/80" : "bg-zinc-300"} ${fillOpacity}`} />
            )}
          </>
        )}
      </div>

      <span className={`pointer-events-none mt-0.5 font-mono text-[7px] font-semibold uppercase ${half.on ? "text-zinc-400" : "text-zinc-600"}`}>
        {definition.footer(value)}
      </span>
    </div>
  );
}

/** On/off pad for one half of a step; press and drag across pads to paint. */
function StepPad({ label, half, isPlayhead, triggering, compact, onPaint, session }: {
  label: string;
  half: StepHalf;
  isPlayhead: boolean;
  triggering: boolean;
  compact: boolean;
  onPaint: (on: boolean) => void;
  session: EditSession;
}) {
  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        session.paintTarget = !half.on;
        onPaint(!half.on);
      }}
      onPointerEnter={(e) => {
        if (e.buttons === 1 && session.paintTarget !== null) onPaint(session.paintTarget);
      }}
      title={`Step ${label}: click or drag to toggle`}
      className={`flex ${CONTROL_WIDTH} cursor-pointer touch-none select-none flex-col items-center justify-between rounded-lg border py-1.5 transition-all ${
        triggering
          ? "scale-[1.02] border-white bg-emerald-400 font-bold text-zinc-950 shadow-md"
          : half.on
            ? isPlayhead
              ? "border-white bg-zinc-200 font-bold text-zinc-950 shadow-sm"
              : "border-zinc-600 bg-zinc-750 text-white shadow-sm hover:bg-zinc-700"
            : isPlayhead
              ? "border-zinc-700 bg-zinc-800 text-zinc-400"
              : "border-zinc-800/80 bg-zinc-900/60 text-zinc-500 hover:bg-zinc-850 hover:text-zinc-300"
      }`}
    >
      <span className={`pointer-events-none font-mono font-bold leading-none ${compact ? "text-[8px] tracking-tighter" : "text-[10px]"}`}>{label}</span>
      <div
        className={`pointer-events-none my-1 rounded-full transition-all ${compact ? "h-2 w-2" : "h-2.5 w-2.5"} ${
          triggering ? "scale-125 bg-zinc-950" : half.on ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-800"
        }`}
      />
      <span className={`pointer-events-none font-mono font-bold leading-none ${compact ? "text-[7px]" : "text-[9px]"}`}>
        {triggering ? "HIT" : half.on ? "ON" : "—"}
      </span>
    </div>
  );
}

/** One column of the sequencer grid: pad(s), split button and value lane(s). */
export function StepColumn({ index, step, lane, playheadHalf, armed, session, edit, audition }: StepColumnProps) {
  const number = index + 1;
  const onPlayhead = playheadHalf !== null;
  const firstPlaying = playheadHalf === 0;
  const secondPlaying = playheadHalf === 1;

  const paint = (halfKey: HalfKey) => (on: boolean) => {
    edit((p) => updateHalf(p, index, halfKey, { on }));
    if (on) audition(step[halfKey]);
  };

  const triggeringFirst = firstPlaying && step.first.on && armed;
  const triggeringSecond = secondPlaying && step.split && step.second.on && armed;

  return (
    <div
      className={`flex h-full min-h-[255px] flex-col items-center justify-between rounded-xl border p-1.5 transition-all ${
        triggeringFirst || triggeringSecond
          ? "border-emerald-400 bg-zinc-850 shadow-[0_0_16px_rgba(52,211,153,0.35)]"
          : onPlayhead
            ? "border-emerald-500/60 bg-zinc-850/90"
            : index % 4 === 0
              ? "border-zinc-700/80 bg-zinc-900"
              : "border-zinc-800 bg-zinc-950/80"
      }`}
    >
      {/* Pad rows mirror the lane rows below (same slots and divider) so each pad sits over its slider. */}
      {step.split ? (
        <div className="flex w-full items-stretch gap-1">
          <div className="flex min-w-0 flex-1 justify-center">
            <StepPad label={`${number}.1`} half={step.first} isPlayhead={firstPlaying} triggering={triggeringFirst} compact onPaint={paint("first")} session={session} />
          </div>
          <div className="w-px" />
          <div className="flex min-w-0 flex-1 justify-center">
            <StepPad label={`${number}.2`} half={step.second} isPlayhead={secondPlaying} triggering={triggeringSecond} compact onPaint={paint("second")} session={session} />
          </div>
        </div>
      ) : (
        <div className="flex w-full justify-center">
          <StepPad label={`${number}`} half={step.first} isPlayhead={onPlayhead} triggering={triggeringFirst} compact={false} onPaint={paint("first")} session={session} />
        </div>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          edit((p) => toggleSplit(p, index));
        }}
        title={step.split ? "Merge back into one step" : "Split into two half-length steps"}
        className={`mb-1 mt-1.5 w-full rounded border py-0.5 font-mono text-[8px] font-bold transition ${
          step.split
            ? "border-zinc-500 bg-zinc-700 text-white shadow-sm hover:bg-zinc-650"
            : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-850 hover:text-zinc-300"
        }`}
      >
        {step.split ? "1x (MERGE)" : "÷2 SPLIT"}
      </button>

      {step.split ? (
        <div className="flex w-full flex-1 items-stretch gap-1 pt-0.5">
          <StepLane index={index} halfKey="first" half={step.first} label={`${number}.1`} isPlayhead={firstPlaying} lane={lane} session={session} edit={edit} audition={audition} />
          <div className="my-1 w-px self-stretch bg-zinc-800/80" />
          <StepLane index={index} halfKey="second" half={step.second} label={`${number}.2`} isPlayhead={secondPlaying} lane={lane} session={session} edit={edit} audition={audition} />
        </div>
      ) : (
        <StepLane index={index} halfKey="first" half={step.first} label={`${number}`} isPlayhead={onPlayhead} lane={lane} session={session} edit={edit} audition={audition} />
      )}
    </div>
  );
}
