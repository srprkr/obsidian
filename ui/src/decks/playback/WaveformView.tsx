import { useEffect, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { pluginApi } from "../../bridge/api";
import type { SampleSlot } from "../../bridge/types";
import { fileToBase64, isProbablyAudio } from "../../lib/files";
import { usePluginStore, useTelemetryStore } from "../../state/pluginStore";
import { drawBackground, drawMarker, drawPeaks, drawPlayhead, syncCanvasSize } from "./drawWaveform";
import { type Marker, paramsTouchedBy, readMarkerPositions, useMarkerMover } from "./regionMarkers";

/** Loads a dropped file into a sample slot. Returns an error message or null. */
export async function loadDroppedFile(slot: SampleSlot, file: File): Promise<string | null> {
  if (!isProbablyAudio(file)) return `"${file.name}" doesn't look like an audio file.`;
  const result = await pluginApi.loadDroppedSample(slot, file.name, await fileToBase64(file));
  return result.ok ? null : result.error ?? "The file could not be loaded.";
}

/** Bar lines over the waveform (assumes the sample is a 4-bar loop). */
function WaveformGrid() {
  return (
    <div className="pointer-events-none absolute inset-0 flex">
      {[1, 2, 3, 4].map((bar) => (
        <div key={bar} className={`flex h-full flex-1 flex-col justify-between ${bar > 1 ? "border-l border-white/40" : ""}`}>
          <span className="p-1 font-mono text-[9px] font-bold text-white/80">BAR {bar}</span>
          <div className="flex flex-1">
            {[0, 1, 2, 3].map((beat) => (
              <div key={beat} className={`flex-1 ${beat < 3 ? "border-r border-dashed border-white/15" : ""}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyDropZone({ busy, error }: { busy: boolean; error: string | null }) {
  return (
    <button
      onClick={() => void pluginApi.browseForSample("main")}
      className="group absolute inset-0 flex select-none flex-col items-center justify-center gap-3 text-zinc-400 transition hover:text-zinc-200"
    >
      {busy ? (
        <Loader2 className="h-9 w-9 animate-spin text-zinc-500" />
      ) : (
        <Upload className="h-9 w-9 text-zinc-500 transition-transform group-hover:scale-110 group-hover:text-zinc-300" />
      )}
      <span className="text-base font-semibold text-zinc-200 group-hover:text-white">No Sample Loaded</span>
      <span className="text-xs font-normal text-zinc-500 group-hover:text-zinc-400">Click or drop an audio file here to load</span>
      <span className="mt-1 font-mono text-[10px] text-zinc-600">Supports WAV, MP3, AIFF, OGG, FLAC</span>
      {error && <span className="mt-1 text-xs text-red-400">{error}</span>}
    </button>
  );
}

/** Main sample display: waveform, region markers, live playheads; drag markers to edit. */
export function WaveformView({ heightClass }: { heightClass: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingMarker = useRef<Marker | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sample = usePluginStore((s) => s.samples.main);
  const showGrid = usePluginStore((s) => s.ui.showGrid);
  const moveMarker = useMarkerMover();

  // Redraw every frame: playheads move continuously and the draw is cheap.
  useEffect(() => {
    let frame = 0;

    const render = () => {
      frame = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const { width, height } = syncCanvasSize(canvas);
      drawBackground(ctx, width, height);

      const { samples, params, ui } = usePluginStore.getState();
      const main = samples.main;
      if (!main) return;

      const m = readMarkerPositions(params);
      const isLoop = params.playbackMode >= 0.5;
      const x = (fraction: number) => Math.min(1, Math.max(0, fraction)) * width;

      drawPeaks(ctx, main.peaks, 0, 1, width, height, height / 2, ui.waveformZoom, "#52525b");

      if (isLoop) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(x(m.loopStart), 0, x(m.loopEnd) - x(m.loopStart), height);

        // Crossfade blends the audio just before Loop Start into the loop tail.
        const crossfade = params.loopCrossfade / Math.max(main.durationSec, 1e-3);
        if (crossfade > 0) {
          const from = Math.max(0, m.loopStart - crossfade);
          ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
          ctx.fillRect(x(from), 0, x(m.loopStart) - x(from), height);
        }
      }

      // Darken audio outside the playable region.
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, x(m.start), height);
      ctx.fillRect(x(m.end), 0, width - x(m.end), height);

      drawMarker(ctx, x(m.start), height, "#e4e4e7", "START", true);
      drawMarker(ctx, x(m.end), height, "#71717a", "END", true);
      if (isLoop) {
        drawMarker(ctx, x(m.loopStart), height, "#d4d4d8", "LOOP S", false);
        drawMarker(ctx, x(m.loopEnd), height, "#d4d4d8", "LOOP E", false);
      }
      // With a separate release file the marker is an offset into that file, shown in its own view.
      if (params.releaseTrigEnabled >= 0.5 && !samples.release) {
        drawMarker(ctx, x(m.releaseTrigger), height, "#a1a1aa", "REL TRG", true);
      }

      for (const [kind, position] of useTelemetryStore.getState().voices) {
        if (kind === 0) drawPlayhead(ctx, x(position), height, "#ffffff", 8);
        else if (kind === 1) drawPlayhead(ctx, x(position), height, "#a1a1aa", height - 8);
      }
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);

  const fractionAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!sample || e.button !== 0) return;
    const { params, ui, samples } = usePluginStore.getState();
    const m = readMarkerPositions(params);
    const isLoop = params.playbackMode >= 0.5;
    const target = fractionAt(e);

    const candidates: [Marker, number][] = [["start", m.start], ["end", m.end]];
    if (isLoop) candidates.push(["loopStart", m.loopStart], ["loopEnd", m.loopEnd]);
    if (params.releaseTrigEnabled >= 0.5 && !samples.release) candidates.push(["releaseTrigger", m.releaseTrigger]);

    const [closest] = candidates.reduce((best, c) => (Math.abs(c[1] - target) < Math.abs(best[1] - target) ? c : best));
    draggingMarker.current = closest;
    e.currentTarget.setPointerCapture(e.pointerId);
    paramsTouchedBy(closest, ui.endLinked).forEach((id) => usePluginStore.getState().beginGesture(id));
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingMarker.current) moveMarker(draggingMarker.current, fractionAt(e));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const marker = draggingMarker.current;
    if (!marker) return;
    draggingMarker.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const { ui, endGesture } = usePluginStore.getState();
    paramsTouchedBy(marker, ui.endLinked).forEach((id) => endGesture(id));
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setBusy(true);
    setError(await loadDroppedFile("main", file));
    setBusy(false);
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border shadow-inner transition-all duration-200 ${heightClass} ${
        dropActive ? "border-zinc-400" : "border-zinc-800"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="h-full w-full cursor-crosshair touch-none"
      />
      {sample && showGrid && <WaveformGrid />}
      {!sample && <EmptyDropZone busy={busy} error={error} />}
    </div>
  );
}
