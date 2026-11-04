import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ParamKnob } from "../../components/ParamKnob";
import { Panel, SegmentedControl } from "../../components/controls";
import {
  designSections,
  emphasisToQ,
  type FilterSettings,
  fractionToFrequency,
  frequencyToFraction,
  magnitudeDb,
} from "../../lib/filterResponse";
import { formatFrequencyAxis, formatHz } from "../../lib/format";
import { useChoiceParam, useToggleParam } from "../../state/hooks";
import { FILTER_SLOPES, type FilterSlope, type ParamId } from "../../state/parameterIds";
import { usePluginStore } from "../../state/pluginStore";

type FilterKind = "hpf" | "lpf";

const W = 800;
const H = 200;
const DB_TOP = 18;
const DB_BOTTOM = -36;
const DB_GRID = [12, 6, 0, -12, -24, -36];
const FREQUENCY_GRID = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
const CURVE_POINTS = 160;

const dbToY = (db: number) => {
  const clamped = Math.max(-42, Math.min(24, db));
  return H - ((clamped - DB_BOTTOM) / (DB_TOP - DB_BOTTOM)) * (H - 16) - 8;
};
const frequencyToX = (hz: number) => frequencyToFraction(hz) * W;

const IDS: Record<FilterKind, { enabled: ParamId; cutoff: ParamId; emphasis: ParamId; slope: ParamId }> = {
  hpf: { enabled: "hpfEnabled", cutoff: "hpfCutoff", emphasis: "hpfResonance", slope: "hpfSlope" },
  lpf: { enabled: "lpfEnabled", cutoff: "lpfCutoff", emphasis: "lpfResonance", slope: "lpfSlope" },
};

function useFilterSettings(kind: FilterKind): FilterSettings {
  const ids = IDS[kind];
  const enabled = usePluginStore((s) => s.params[ids.enabled] >= 0.5);
  const cutoffHz = usePluginStore((s) => s.params[ids.cutoff]);
  const emphasis = usePluginStore((s) => s.params[ids.emphasis]);
  const slopeIndex = usePluginStore((s) => Math.round(s.params[ids.slope]));
  return useMemo(
    () => ({ enabled, cutoffHz, emphasis, slope: FILTER_SLOPES[slopeIndex] ?? 12 }),
    [enabled, cutoffHz, emphasis, slopeIndex]
  );
}

const toPath = (points: [number, number][]) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

/** Combined frequency response with draggable cutoff/emphasis pucks for both filters. */
function FilterResponseGraph() {
  const highPass = useFilterSettings("hpf");
  const lowPass = useFilterSettings("lpf");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<FilterKind | null>(null);
  const [hovered, setHovered] = useState<FilterKind | null>(null);

  const curves = useMemo(() => {
    const hp = designSections("highpass", highPass);
    const lp = designSections("lowpass", lowPass);
    const total: [number, number][] = [], hpPoints: [number, number][] = [], lpPoints: [number, number][] = [];

    for (let i = 0; i <= CURVE_POINTS; i++) {
      const x = (i / CURVE_POINTS) * W;
      const hz = fractionToFrequency(i / CURVE_POINTS);
      const hpDb = magnitudeDb(hp, hz);
      const lpDb = magnitudeDb(lp, hz);
      total.push([x, dbToY(hpDb + lpDb)]);
      hpPoints.push([x, dbToY(hpDb)]);
      lpPoints.push([x, dbToY(lpDb)]);
    }

    const totalPath = toPath(total);
    return { totalPath, area: `${totalPath} L ${W} ${H} L 0 ${H} Z`, highPassPath: toPath(hpPoints), lowPassPath: toPath(lpPoints) };
  }, [highPass, lowPass]);

  const puck = (settings: FilterSettings) => ({
    x: frequencyToX(settings.cutoffHz),
    // Kept below the top edge so the puck's label stays visible at high emphasis.
    y: Math.max(22, dbToY(settings.enabled ? 20 * Math.log10(emphasisToQ(settings.emphasis)) : 0)),
  });
  const hpPuck = puck(highPass);
  const lpPuck = puck(lowPass);

  const applyPointer = (kind: FilterKind, e: ReactPointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const { setParam } = usePluginStore.getState();
    const ids = IDS[kind];
    setParam(ids.enabled, 1);
    setParam(ids.cutoff, Math.round(fractionToFrequency(fx)));
    setParam(ids.emphasis, Number((0.1 + (1 - fy) * 9.9).toFixed(1)));
  };

  const startDrag = (kind: FilterKind, e: ReactPointerEvent) => {
    dragging.current = kind;
    svgRef.current?.setPointerCapture(e.pointerId);
    const ids = IDS[kind];
    [ids.enabled, ids.cutoff, ids.emphasis].forEach(usePluginStore.getState().beginGesture);
  };

  const endDrag = (e: ReactPointerEvent) => {
    const kind = dragging.current;
    if (!kind) return;
    dragging.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    const ids = IDS[kind];
    [ids.enabled, ids.cutoff, ids.emphasis].forEach(usePluginStore.getState().endGesture);
  };

  const resetFilter = (kind: FilterKind) => {
    const { setParam } = usePluginStore.getState();
    setParam(IDS[kind].cutoff, kind === "hpf" ? 20 : 20000);
    setParam(IDS[kind].emphasis, 1);
  };

  const renderPuck = (kind: FilterKind, position: { x: number; y: number }, enabled: boolean) => (
    <g
      transform={`translate(${position.x}, ${position.y})`}
      onPointerDown={(e) => {
        e.stopPropagation();
        startDrag(kind, e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        resetFilter(kind);
      }}
      onMouseEnter={() => setHovered(kind)}
      onMouseLeave={() => setHovered(null)}
      className="cursor-grab active:cursor-grabbing"
      opacity={enabled ? 1 : 0.35}
    >
      <circle r="12" fill="#52525b" fillOpacity={hovered === kind ? 0.45 : 0.25} />
      <circle r="5" fill="#e4e4e7" stroke="#18181b" strokeWidth="1.5" />
      <text y="-10" fill="#e4e4e7" fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
        {kind.toUpperCase()}
      </text>
    </g>
  );

  return (
    <div className="relative h-[220px] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          // Clicking the graph grabs whichever filter's cutoff is closer (in octaves).
          const rect = e.currentTarget.getBoundingClientRect();
          const hz = fractionToFrequency((e.clientX - rect.left) / rect.width);
          const kind: FilterKind =
            Math.abs(Math.log10(hz / highPass.cutoffHz)) <= Math.abs(Math.log10(hz / lowPass.cutoffHz)) ? "hpf" : "lpf";
          startDrag(kind, e);
          applyPointer(kind, e);
        }}
        onPointerMove={(e) => dragging.current && applyPointer(dragging.current, e)}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="h-full w-full cursor-crosshair touch-none select-none"
      >
        <defs>
          <linearGradient id="filterAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#52525b" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#52525b" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="filterCurveStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d4d4d8" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#d4d4d8" />
          </linearGradient>
        </defs>

        {DB_GRID.map((db) => {
          const y = dbToY(db);
          const zero = db === 0;
          const text = `${db > 0 ? `+${db}` : db} dB`;
          const style = { fill: zero ? "#e4e4e7" : "#52525b", fontSize: 8, fontFamily: "monospace", fontWeight: zero ? "bold" : "normal" } as const;
          return (
            <g key={db}>
              <line x1="0" y1={y} x2={W} y2={y} stroke={zero ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"} strokeWidth={zero ? 1.5 : 1} strokeDasharray={zero ? undefined : "3 4"} />
              <text x="8" y={y - 3} {...style}>{text}</text>
              <text x={W - 8} y={y - 3} textAnchor="end" {...style}>{text}</text>
            </g>
          );
        })}

        {FREQUENCY_GRID.map((hz) => {
          const x = frequencyToX(hz);
          return (
            <g key={hz}>
              <line x1={x} y1="0" x2={x} y2={H} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="2 3" />
              <text x={x} y={H - 6} fill="#71717a" fontSize="8" fontFamily="monospace" textAnchor="middle">{formatFrequencyAxis(hz)}</text>
            </g>
          );
        })}

        <path d={curves.area} fill="url(#filterAreaFill)" />
        {highPass.enabled && <path d={curves.highPassPath} fill="none" stroke="#71717a" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.6" />}
        {lowPass.enabled && <path d={curves.lowPassPath} fill="none" stroke="#71717a" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.6" />}
        <path d={curves.totalPath} fill="none" stroke="url(#filterCurveStroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]" />

        {highPass.enabled && <line x1={hpPuck.x} y1="0" x2={hpPuck.x} y2={H} stroke="#71717a" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />}
        {lowPass.enabled && <line x1={lpPuck.x} y1="0" x2={lpPuck.x} y2={H} stroke="#71717a" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />}

        {renderPuck("hpf", hpPuck, highPass.enabled)}
        {renderPuck("lpf", lpPuck, lowPass.enabled)}
      </svg>
    </div>
  );
}

/** Bypass button, slope selector and the two knobs for one filter. */
function FilterPanel({ kind, title }: { kind: FilterKind; title: string }) {
  const ids = IDS[kind];
  const [enabled, setEnabled] = useToggleParam(ids.enabled);
  const [slope, setSlope] = useChoiceParam<FilterSlope>(ids.slope, FILTER_SLOPES);

  return (
    <Panel className="flex flex-col justify-between p-4">
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEnabled(!enabled)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider transition ${
              enabled ? "border-zinc-600 bg-zinc-800 text-white shadow-sm" : "border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
          >
            <span className={`h-2 w-2 rounded-full transition-all ${enabled ? "bg-zinc-200 shadow-[0_0_6px_rgba(255,255,255,0.8)]" : "bg-zinc-600"}`} />
            <span>{enabled ? "Active" : "Bypass"}</span>
          </button>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">{title}</span>
        </div>

        <div className="flex items-center gap-1">
          <span className="px-1 font-mono text-[9px] uppercase text-zinc-500">Slope:</span>
          <SegmentedControl<FilterSlope>
            size="sm"
            value={slope}
            onChange={setSlope}
            options={FILTER_SLOPES.map((s) => ({ value: s, label: `${s} dB`, title: `${s} dB per octave` }))}
          />
        </div>
      </div>

      <div className="flex items-center justify-around py-2">
        <ParamKnob param={ids.cutoff} label="Cutoff" scale="log" disabled={!enabled} format={formatHz} />
        <ParamKnob param={ids.emphasis} label="Emphasis" step={0.1} disabled={!enabled} format={(v) => v.toFixed(1)} />
      </div>
    </Panel>
  );
}

/** The Filters tab: Moog-style dual high-pass / low-pass section. */
export function FiltersDeck() {
  return (
    <div className="flex h-full w-full select-none flex-col justify-between px-6 py-3.5">
      <FilterResponseGraph />
      <div className="mt-2.5 grid h-[190px] grid-cols-2 gap-4">
        <FilterPanel kind="hpf" title="High Pass Filter" />
        <FilterPanel kind="lpf" title="Low Pass Filter" />
      </div>
    </div>
  );
}
