import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { pluginApi } from "../../bridge/api";
import type { SequencerLane, StepHalf } from "../../bridge/types";
import { FieldLabel, SegmentedControl, StatusDot } from "../../components/controls";
import { useChoiceParam, useParam, useToggleParam } from "../../state/hooks";
import { RATE_MULTIPLIERS, SEQUENCER_STEP_COUNTS } from "../../state/parameterIds";
import { usePluginStore, useTelemetryStore } from "../../state/pluginStore";
import { LANE_PRESETS, LANES, resetLane } from "./patternEditing";
import { type EditSession, StepColumn } from "./StepColumn";

const RATE_TITLES: Record<number, string> = { 0.5: "1/8 notes", 1: "1/16 notes", 2: "1/32 notes" };

/** Tempo source: follow the host, or a custom BPM typed in. */
function TempoControl() {
  const [synced, setSynced] = useToggleParam("seqSync");
  const bpm = useParam("seqBpm");
  const hostBpm = useTelemetryStore((t) => t.hostBpm);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const commit = () => {
    const value = parseInt(text, 10);
    if (!Number.isNaN(value) && value >= bpm.info.min && value <= bpm.info.max) bpm.set(value);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      <button
        onClick={() => setSynced(!synced)}
        title={synced ? "Following the host tempo" : "Follow the host tempo"}
        className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-bold uppercase tracking-wider transition ${
          synced ? "border-zinc-600 bg-zinc-750 text-white shadow-sm" : "border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <StatusDot on={synced} />
        <span>Sync</span>
      </button>

      <div className="flex items-center px-2">
        {synced ? (
          <span className="flex items-center gap-1 font-mono text-xs font-bold text-zinc-200" title="Host tempo">
            {Math.round(hostBpm)} <span className="text-[10px] font-normal text-zinc-500">BPM</span>
          </span>
        ) : editing ? (
          <input
            autoFocus
            type="number"
            min={bpm.info.min}
            max={bpm.info.max}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commit}
            className="w-14 rounded border border-zinc-600 bg-zinc-950 px-1.5 py-0.5 text-center font-mono text-xs font-bold text-white outline-none"
          />
        ) : (
          <button
            onClick={() => {
              setText(String(bpm.value));
              setEditing(true);
            }}
            title="Click to type a tempo"
            className="flex cursor-text items-center gap-1 rounded border border-dashed border-zinc-700 px-1.5 py-0.5 font-mono text-xs font-bold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 hover:text-white"
          >
            <span>{bpm.value}</span>
            <span className="text-[10px] font-normal text-zinc-500">BPM</span>
          </button>
        )}
      </div>
    </div>
  );
}

function TransportButton() {
  const running = useTelemetryStore((t) => t.sequencerRunning);
  const manualRun = usePluginStore((s) => s.sequencerManualRun);
  const setManualRun = usePluginStore((s) => s.setSequencerManualRun);
  const [enabled, setEnabled] = useToggleParam("seqEnabled");
  const playing = running || manualRun;

  return (
    <button
      onClick={() => {
        if (playing) {
          setManualRun(false);
        } else {
          if (!enabled) setEnabled(true); // Play implies the sequencer is on
          setManualRun(true);
        }
      }}
      title="Run the pattern on the root note without holding keys"
      className={`flex items-center gap-2 rounded-lg border px-5 py-2 text-xs font-bold uppercase tracking-wider transition ${
        playing
          ? "border-emerald-400 bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)]"
          : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-750 hover:text-white"
      }`}
    >
      {playing ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
      <span>{playing ? "Stop" : "Play"}</span>
    </button>
  );
}

/** The Sequencer tab: held keys (or Play) drive a 8/16-step pattern with per-step velocity, pitch and pan. */
export function SequencerDeck() {
  const pattern = usePluginStore((s) => s.pattern);
  const updatePattern = usePluginStore((s) => s.updatePattern);
  const lane = usePluginStore((s) => s.ui.sequencerLane);
  const auditionEnabled = usePluginStore((s) => s.ui.audition);
  const updateUi = usePluginStore((s) => s.updateUi);
  const [stepCount, setStepCount] = useChoiceParam<number>("seqSteps", SEQUENCER_STEP_COUNTS);
  const [rate, setRate] = useChoiceParam<number>("seqRate", RATE_MULTIPLIERS);

  const running = useTelemetryStore((t) => t.sequencerRunning);
  const currentStep = useTelemetryStore((t) => t.sequencerStep);
  const currentHalf = useTelemetryStore((t) => t.sequencerHalf);
  const heldNotes = useTelemetryStore((t) => t.heldNotes);

  const session = useRef<EditSession>({ paintTarget: null, drawingLane: false, lastAuditioned: "" }).current;
  useEffect(() => {
    const end = () => {
      session.paintTarget = null;
      session.drawingLane = false;
      session.lastAuditioned = "";
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [session]);

  const audition = useCallback((half: StepHalf) => {
    const { ui, params } = usePluginStore.getState();
    if (ui.audition) void pluginApi.audition(params.rootNote + half.pitchOffset, half.velocity || 100, half.pan);
  }, []);

  const steps = pattern.slice(0, stepCount);
  const hasAnyStep = steps.some((s) => s.first.on || (s.split && s.second.on));
  const status = !hasAnyStep ? "BLANK" : heldNotes > 0 ? `ARMED (${heldNotes})` : "TRIGGER";

  return (
    <div className="flex h-full w-full flex-col justify-between gap-3 px-6 py-3.5">
      {/* Transport & setup */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => updatePattern((p) => resetLane(p, lane))}
            title={`Reset ${LANES[lane].label.toLowerCase()} on every step`}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-850 hover:text-red-400"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset {LANES[lane].label}</span>
          </button>

          <button
            onClick={() => updateUi({ audition: !auditionEnabled })}
            title={auditionEnabled ? "Audition on: hear steps while editing" : "Audition off: silent editing"}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
              auditionEnabled ? "border-zinc-600 bg-zinc-800 text-white shadow-sm" : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-400"
            }`}
          >
            <Volume2 className={`h-3.5 w-3.5 ${auditionEnabled ? "text-zinc-200" : "text-zinc-600"}`} />
            <span>Audition</span>
            <StatusDot on={auditionEnabled} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <FieldLabel>Steps:</FieldLabel>
          <SegmentedControl<number> value={stepCount} onChange={setStepCount} options={SEQUENCER_STEP_COUNTS.map((n) => ({ value: n, label: n }))} />
        </div>

        <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-3">
          <FieldLabel>Step Rate:</FieldLabel>
          <SegmentedControl<number>
            value={rate}
            onChange={setRate}
            options={RATE_MULTIPLIERS.map((r) => ({ value: r, label: `${r}x`, title: `${r}x tempo (${RATE_TITLES[r]})` }))}
          />
        </div>

        <div className="flex items-center gap-3">
          <TempoControl />
          <TransportButton />
        </div>
      </div>

      {/* Pattern surface */}
      <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 shadow-xl">
        {/* Equal outer columns keep the lane tabs centred whatever the presets on the right contain. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-zinc-800/60 pb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          <div className="flex items-center justify-start gap-2">
            <span className="font-bold text-zinc-300">{stepCount}-Step Pattern</span>
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold transition-all ${
                !hasAnyStep
                  ? "border-zinc-800 bg-zinc-900 text-zinc-500"
                  : heldNotes > 0
                    ? "border-emerald-600 bg-emerald-950/80 text-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
            >
              {status}
            </span>
          </div>

          <SegmentedControl<SequencerLane>
            value={lane}
            onChange={(l) => updateUi({ sequencerLane: l })}
            options={(["velocity", "arp", "pan"] as const).map((l) => ({ value: l, label: <span className="px-1.5 uppercase tracking-wider">{LANES[l].label}</span> }))}
          />

          <div className="flex items-center justify-end gap-1">
            <span className="mr-1 text-[10px] font-semibold text-zinc-500">Presets:</span>
            {LANE_PRESETS[lane].map((preset) => (
              <button
                key={preset.label}
                onClick={() => updatePattern(preset.apply)}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] normal-case text-zinc-300 transition hover:bg-zinc-800"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`grid flex-1 items-stretch gap-2 ${stepCount === 8 ? "grid-cols-[repeat(8,minmax(0,1fr))]" : "grid-cols-[repeat(16,minmax(0,1fr))]"}`}>
          {steps.map((step, index) => (
            <StepColumn
              key={index}
              index={index}
              step={step}
              lane={lane}
              playheadHalf={running && currentStep === index ? (step.split ? (currentHalf as 0 | 1) : 0) : null}
              armed={heldNotes > 0 || running}
              session={session}
              edit={updatePattern}
              audition={audition}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
