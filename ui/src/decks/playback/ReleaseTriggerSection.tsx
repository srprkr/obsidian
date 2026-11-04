import { useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { pluginApi } from "../../bridge/api";
import { Knob } from "../../components/Knob";
import { ParamKnob } from "../../components/ParamKnob";
import { StatusDot } from "../../components/controls";
import { formatPercent, formatSeconds } from "../../lib/format";
import { useParam, useToggleParam } from "../../state/hooks";
import { usePluginStore, useTelemetryStore } from "../../state/pluginStore";
import { drawBackground, drawPeaks, drawPlayhead, syncCanvasSize } from "./drawWaveform";
import { loadDroppedFile } from "./WaveformView";

/** Small view of what the release trigger will play, with its playheads. */
function ReleaseMiniView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabled = usePluginStore((s) => s.params.releaseTrigEnabled >= 0.5);
  const releaseSample = usePluginStore((s) => s.samples.release);
  const mainDuration = usePluginStore((s) => s.samples.main?.durationSec ?? 0);
  const trigger = usePluginStore((s) => s.params.releaseTrigPos);
  const end = usePluginStore((s) => s.params.endPos);

  useEffect(() => {
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const { width, height } = syncCanvasSize(canvas);
      drawBackground(ctx, width, height);

      const { samples, params } = usePluginStore.getState();
      const custom = samples.release;
      const source = custom ?? samples.main;
      if (!source) return;

      // A custom release file plays from the offset to its end; otherwise a slice of the main sample.
      const from = params.releaseTrigPos;
      const to = custom ? 1 : Math.max(from + 0.01, params.endPos);
      const colour = params.releaseTrigEnabled >= 0.5 ? "#52525b" : "#27272a";
      drawPeaks(ctx, source.peaks, from, to, width, height, height * 0.38, 1, colour);

      const playingKind = custom ? 2 : 1;
      for (const [kind, , progress] of useTelemetryStore.getState().voices) {
        if (kind === playingKind) drawPlayhead(ctx, progress * width, height, "#ffffff", height / 2, 2.5);
      }
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);

  const lengthLabel = releaseSample
    ? formatSeconds(releaseSample.durationSec * (1 - trigger))
    : mainDuration > 0
      ? formatSeconds(Math.max(0, end - trigger) * mainDuration)
      : "—";

  return (
    <div
      className={`relative flex h-[76px] w-full flex-col justify-between overflow-hidden rounded-xl border bg-zinc-950 p-1.5 shadow-inner transition ${
        enabled ? "border-zinc-700/80 shadow-md" : "border-zinc-850 opacity-40"
      }`}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="pointer-events-none relative z-10 flex w-full items-center justify-between">
        <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-500">{releaseSample ? "CUSTOM REL" : "SLICE REL"}</span>
        <span className="font-mono text-[8px] font-semibold text-zinc-300">{lengthLabel}</span>
      </div>
      <div className="pointer-events-none relative z-10 flex w-full items-center justify-between">
        <span
          className={`rounded px-1 py-0.5 font-mono text-[7px] font-bold uppercase ${
            enabled ? "border border-zinc-700/60 bg-zinc-800 text-zinc-200" : "bg-zinc-900 text-zinc-600"
          }`}
        >
          {enabled ? "ACTIVE" : "BYPASS"}
        </span>
        {releaseSample && <span className="max-w-[55px] truncate font-mono text-[7px] text-zinc-400" title={releaseSample.name}>{releaseSample.name}</span>}
      </div>
    </div>
  );
}

/** Load / replace / clear the optional separate release-trigger file. Files can also be dropped here. */
function ReleaseSampleSlot() {
  const releaseSample = usePluginStore((s) => s.samples.release);
  const showError = usePluginStore((s) => s.showError);
  const [dropActive, setDropActive] = useState(false);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDropActive(true);
    },
    onDragLeave: () => setDropActive(false),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      setDropActive(false);
      const file = e.dataTransfer.files[0];
      if (file) showError(await loadDroppedFile("release", file));
    },
  };

  if (!releaseSample) {
    return (
      <button
        {...dropProps}
        onClick={() => void pluginApi.browseForSample("release")}
        title="Use a separate audio file for the release trigger (or drop one here)"
        className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-0.5 text-[10px] text-zinc-400 shadow-sm transition hover:bg-zinc-800 hover:text-zinc-200 ${
          dropActive ? "border-zinc-400 bg-zinc-800" : "border-zinc-800 bg-zinc-900/90 hover:border-zinc-700"
        }`}
      >
        <Upload className="h-3 w-3 text-zinc-400" />
        <span className="text-[10px] font-semibold">Load Sample</span>
      </button>
    );
  }

  return (
    <div {...dropProps} className={`flex w-full items-center justify-between gap-1 rounded-lg border bg-zinc-900 px-2 py-1 text-zinc-200 shadow-sm ${dropActive ? "border-zinc-400" : "border-zinc-750"}`}>
      <div className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300" />
        <span className="truncate text-[10px] font-medium" title={releaseSample.path}>{releaseSample.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button onClick={() => void pluginApi.browseForSample("release")} title="Replace with another file" className="flex items-center justify-center rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">
          <Upload className="h-3 w-3" />
        </button>
        <button onClick={() => void pluginApi.clearSample("release")} title="Remove the release sample" className="flex items-center justify-center rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Release trigger: a tail sample played when a key is released. */
export function ReleaseTriggerSection() {
  const [enabled, setEnabled] = useToggleParam("releaseTrigEnabled");
  const position = useParam("releaseTrigPos");
  const releaseSample = usePluginStore((s) => s.samples.release);
  const mainDuration = usePluginStore((s) => s.samples.main?.durationSec ?? 0);
  const snap = usePluginStore((s) => s.ui.snapToGrid);

  // With a custom file the knob is an offset into that file; otherwise a point in the main sample.
  const sourceDuration = releaseSample?.durationSec ?? mainDuration;
  const seconds = position.value * sourceDuration;

  return (
    <div className="flex items-center gap-6 pl-1.5">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <button
          onClick={() => setEnabled(!enabled)}
          className={`flex items-center gap-1.5 rounded border px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider transition ${
            enabled ? "border-zinc-500 bg-zinc-750 text-white shadow-sm" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <StatusDot on={enabled} tone="amber" />
          Rel. Trig.
        </button>

        <div className="flex items-center gap-3">
          <Knob
            label={releaseSample ? "Rel Offset" : "Rel Trigger"}
            value={seconds}
            min={0}
            max={Math.max(sourceDuration, 0.001)}
            step={snap && !releaseSample ? sourceDuration / 16 : 0.001}
            displayValue={formatSeconds(seconds)}
            disabled={!enabled}
            onChange={(s) => position.set(s / Math.max(sourceDuration, 1e-6))}
            onGestureStart={position.beginGesture}
            onGestureEnd={position.endGesture}
          />
          <ParamKnob param="releaseTrigGain" label="Rel Vol" step={0.01} format={formatPercent} disabled={!enabled} />
        </div>
      </div>

      <div className="flex w-32 flex-col items-center gap-1.5">
        <ReleaseSampleSlot />
        <ReleaseMiniView />
      </div>
    </div>
  );
}
