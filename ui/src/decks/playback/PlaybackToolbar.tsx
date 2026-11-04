import { useCallback, useRef, useState } from "react";
import { ChevronDown, Maximize2, Minus, Plus, Trash2, Upload, X, ZoomIn } from "lucide-react";
import { pluginApi } from "../../bridge/api";
import type { SampleInfo } from "../../bridge/types";
import { LedToggle, SegmentedControl, StatusDot } from "../../components/controls";
import { useDismiss } from "../../hooks/useDismiss";
import { midiToNoteName } from "../../lib/notes";
import { useChoiceParam, useParam, useToggleParam } from "../../state/hooks";
import { PLAYBACK_MODES, type PlaybackMode } from "../../state/parameterIds";
import { usePluginStore, useTelemetryStore } from "../../state/pluginStore";

const ROOT_NOTE_RANGE = Array.from({ length: 73 }, (_, i) => 24 + i); // C1..C7

function DetailRow({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${last ? "" : "border-b border-zinc-800/50"}`}>
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-200">{children}</span>
    </div>
  );
}

/** Sample name button with a details popover (load another / eject). */
function SampleInfoMenu({ sample }: { sample: SampleInfo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const rootNote = usePluginStore((s) => s.params.rootNote);
  const start = usePluginStore((s) => s.params.startPos);
  const end = usePluginStore((s) => s.params.endPos);

  return (
    <div className="relative flex flex-1 items-center justify-start" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Sample details and options"
        className="-ml-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800/80 hover:text-white"
      >
        <span className="max-w-[200px] truncate">{sample.name}</span>
        <ChevronDown className="h-3 w-3 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 flex w-64 flex-col gap-2.5 rounded-xl border border-zinc-700 bg-zinc-900 p-3.5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-200">Sample Details</span>
            <button onClick={close} className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-1.5 text-[11px]">
            <DetailRow label="File Name"><span className="block max-w-[130px] truncate font-sans font-medium" title={sample.path}>{sample.name}</span></DetailRow>
            <DetailRow label="Duration">{sample.durationSec.toFixed(3)}s</DetailRow>
            <DetailRow label="Sample Rate">{(sample.sampleRate / 1000).toFixed(1)} kHz</DetailRow>
            <DetailRow label="Channels">{sample.channels >= 2 ? "Stereo (2-ch)" : "Mono (1-ch)"}</DetailRow>
            <DetailRow label="Total Frames">{sample.frames.toLocaleString()}</DetailRow>
            <DetailRow label="Root Note"><b>{midiToNoteName(rootNote)} (MIDI {rootNote})</b></DetailRow>
            <DetailRow label="Active Region" last>
              {(start * sample.durationSec).toFixed(2)}s – {(end * sample.durationSec).toFixed(2)}s
            </DetailRow>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 pt-2">
            <button
              onClick={() => {
                close();
                void pluginApi.browseForSample("main");
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
            >
              <Upload className="h-3.5 w-3.5 text-zinc-300" />
              <span>Load Other Sample</span>
            </button>
            <button
              onClick={() => {
                close();
                void pluginApi.clearSample("main");
                usePluginStore.getState().updateUi({ waveformZoom: 1 });
              }}
              title="Eject sample"
              className="rounded-lg bg-zinc-800 p-1.5 text-zinc-400 transition hover:bg-zinc-700 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mode, Preserve Speed, tempo sync and root note. */
function PlaybackModeStrip() {
  const [mode, setMode] = useChoiceParam<PlaybackMode>("playbackMode", PLAYBACK_MODES);
  const [preserveSpeed, setPreserveSpeed] = useToggleParam("preserveSpeed");
  const [tempoSync, setTempoSync] = useToggleParam("tempoSync");
  const sampleBpm = useParam("sampleBpm");
  const rootNote = useParam("rootNote");
  const hostBpm = useTelemetryStore((t) => t.hostBpm);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1">
      <SegmentedControl<PlaybackMode>
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: "oneshot", label: <span className="uppercase tracking-wider">One Shot</span> },
          {
            value: "loop",
            label: (
              <span className="flex items-center gap-1 uppercase tracking-wider">
                <StatusDot on={mode === "loop"} /> Loop
              </span>
            ),
          },
        ]}
      />

      <LedToggle on={preserveSpeed} onToggle={() => setPreserveSpeed(!preserveSpeed)} title="Keep the playback speed the same on every key; only the pitch changes">
        Preserve Speed
      </LedToggle>

      <div className="flex items-center gap-1 border-l border-zinc-800 pl-2">
        <LedToggle
          on={tempoSync}
          onToggle={() => setTempoSync(!tempoSync)}
          title={`Stretch playback to the host tempo (${Math.round(hostBpm)} BPM) relative to the sample's own tempo`}
        >
          Sync DAW
        </LedToggle>
        <span className="flex items-center gap-1 font-mono text-xs font-bold text-zinc-100" title="The sample's original tempo">
          <input
            type="number"
            min={sampleBpm.info.min}
            max={sampleBpm.info.max}
            value={sampleBpm.value}
            onChange={(e) => {
              const bpm = parseInt(e.target.value, 10);
              if (!Number.isNaN(bpm)) sampleBpm.set(bpm);
            }}
            className="w-12 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-center font-mono text-xs font-bold text-zinc-100 outline-none"
          />
          <span className="text-[10px] font-normal text-zinc-500">BPM</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-2">
        <span className="text-[10px] font-bold uppercase text-zinc-500">Root:</span>
        <select
          value={rootNote.value}
          onChange={(e) => rootNote.set(parseInt(e.target.value, 10))}
          title="Root note: the pitch the sample was recorded at"
          className="cursor-pointer rounded border border-zinc-750 bg-zinc-950 px-2 py-0.5 font-mono text-xs font-bold text-zinc-100 shadow-sm outline-none transition hover:border-zinc-600"
        >
          {ROOT_NOTE_RANGE.map((midi) => (
            <option key={midi} value={midi} className="bg-zinc-900 text-white">
              {midiToNoteName(midi)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SnapIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h5v3.5H4Z" fill="#ffffff" stroke="#ffffff" />
      <path d="M15 4h5v3.5h-5Z" fill="#ffffff" stroke="#ffffff" />
      <path d="M4 7.5h5v4a3 3 0 0 0 6 0V7.5h5v4a8 8 0 0 1-16 0Z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

/** Snap, grid and the zoom popover. */
function WaveformViewTools({ sample }: { sample: SampleInfo | null }) {
  const ui = usePluginStore((s) => s.ui);
  const updateUi = usePluginStore((s) => s.updateUi);
  const [zoomOpen, setZoomOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setZoomOpen(false), []);
  useDismiss(ref, zoomOpen, close);

  const zoom = ui.waveformZoom;
  const setZoom = (value: number) => updateUi({ waveformZoom: Math.min(10, Math.max(1, Number(value.toFixed(1)))) });

  const autoZoom = () => {
    if (!sample) return;
    const loudest = sample.peaks.reduce((max, v) => Math.max(max, Math.abs(v)), 0.001);
    setZoom(0.92 / loudest);
  };

  const toolButton = (active: boolean) =>
    `rounded-lg border p-1.5 text-xs transition ${
      active ? "border-zinc-600 bg-zinc-800 text-zinc-100 shadow-sm" : "border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="relative flex flex-1 items-center justify-end gap-1.5" ref={ref}>
      <button onClick={() => updateUi({ snapToGrid: !ui.snapToGrid })} className={`${toolButton(ui.snapToGrid)} ${ui.snapToGrid ? "!text-emerald-400" : ""}`} title="Snap markers to a 16-step grid">
        <SnapIcon />
      </button>
      <button onClick={() => updateUi({ showGrid: !ui.showGrid })} className={toolButton(ui.showGrid)} title="Show 4-bar grid">
        <GridIcon />
      </button>
      <button
        onClick={() => setZoomOpen((o) => !o)}
        title="Waveform zoom and height"
        className={`flex items-center gap-1.5 ${toolButton(zoomOpen || zoom > 1.05)}`}
      >
        <ZoomIn className="h-3.5 w-3.5 text-zinc-300" />
        {zoom > 1.05 && <span className="font-mono text-[10px] font-bold text-zinc-300">{zoom.toFixed(1)}x</span>}
      </button>

      {zoomOpen && (
        <div className="absolute right-0 top-full z-40 mt-1.5 flex w-64 flex-col gap-2.5 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
              <ZoomIn className="h-3.5 w-3.5 text-zinc-400" /> Waveform Zoom
            </span>
            <button onClick={close} className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setZoom(zoom - 0.5)} disabled={zoom <= 1} className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-30">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center font-mono text-xs font-bold text-white">{zoom.toFixed(1)}x</span>
            <button onClick={() => setZoom(zoom + 0.5)} disabled={zoom >= 10} className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-30">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <input
              type="range"
              min="1"
              max="10"
              step="0.1"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer rounded bg-zinc-800 accent-zinc-200"
            />
          </div>

          <div className="flex items-center justify-between gap-1 border-t border-zinc-800 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Presets:</span>
            <div className="flex items-center gap-1.5">
              {[1, 2, 4].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setZoom(preset)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-medium transition ${
                    Math.abs(zoom - preset) < 0.05 ? "bg-zinc-700 font-bold text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  {preset}x
                </button>
              ))}
              <button onClick={autoZoom} title="Fit the loudest peak to the display" className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 transition hover:bg-zinc-700 hover:text-white">
                Auto
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-800 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Height:</span>
            <button
              onClick={() => updateUi({ expandedWaveform: !ui.expandedWaveform })}
              className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium transition ${
                ui.expandedWaveform ? "bg-zinc-800 font-semibold text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <Maximize2 className="h-3 w-3" />
              <span>{ui.expandedWaveform ? "Expanded" : "Standard"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Row above the waveform: sample menu (left), playback options (centre), view tools (right). */
export function PlaybackToolbar() {
  const sample = usePluginStore((s) => s.samples.main);

  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      {sample ? <SampleInfoMenu sample={sample} /> : <div className="flex-1" />}
      {sample && <PlaybackModeStrip />}
      <WaveformViewTools sample={sample} />
    </div>
  );
}
