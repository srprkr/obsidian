import type { PointerEvent as ReactPointerEvent } from "react";
import { ParamKnob } from "../../components/ParamKnob";
import { Panel } from "../../components/controls";
import { formatPercent, formatSeconds } from "../../lib/format";
import type { ParamId } from "../../state/parameterIds";
import { usePluginStore } from "../../state/pluginStore";

// Graph geometry, in SVG viewBox units.
const VIEW_WIDTH = 600;
const BASELINE_Y = 115;
const PEAK_Y = 20;
const LEVEL_GUIDES = [20, 44, 68, 92];

/** Stage widths grow with the square root of their time, so short and long settings both read well. */
function stageWidths(attack: number, decay: number, release: number) {
  const attackWidth = Math.round(24 + Math.sqrt(Math.max(0.001, attack) / 2) * 115);
  const decayWidth = Math.round(28 + Math.sqrt(Math.max(0.01, decay) / 5) * 135);
  const releaseWidth = Math.round(30 + Math.sqrt(Math.max(0.01, release) / 5) * 145);
  const sustainWidth = Math.max(100, 530 - (attackWidth + decayWidth + releaseWidth));
  return { attackWidth, decayWidth, sustainWidth, releaseWidth };
}

interface DragHandleProps {
  cx: number;
  cy: number;
  cursor: string;
  params: ParamId[];
  onDrag: (dx: number, dy: number) => void;
}

/** A draggable node on the envelope curve; drags are relative (movementX/Y). */
function DragHandle({ cx, cy, cursor, params, onDrag }: DragHandleProps) {
  const { beginGesture, endGesture } = usePluginStore.getState();

  return (
    <circle
      cx={cx}
      cy={cy}
      r={6}
      fill="#52525b"
      stroke="#e4e4e7"
      strokeWidth={2}
      className={`${cursor} transition-transform hover:scale-125`}
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      onPointerDown={(e: ReactPointerEvent<SVGCircleElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        params.forEach(beginGesture);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e.movementX, e.movementY);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        params.forEach(endGesture);
      }}
    />
  );
}

function AdsrGraph() {
  const attack = usePluginStore((s) => s.params.attack);
  const decay = usePluginStore((s) => s.params.decay);
  const sustain = usePluginStore((s) => s.params.sustain);
  const release = usePluginStore((s) => s.params.release);
  const setParam = usePluginStore((s) => s.setParam);

  const { attackWidth, decayWidth, sustainWidth, releaseWidth } = stageWidths(attack, decay, release);
  const x0 = Math.round((VIEW_WIDTH - (attackWidth + decayWidth + sustainWidth + releaseWidth)) / 2);
  const x1 = x0 + attackWidth;
  const x2 = x1 + decayWidth;
  const x3 = x2 + sustainWidth;
  const x4 = x3 + releaseWidth;
  const sustainY = BASELINE_Y - sustain * (BASELINE_Y - PEAK_Y);

  const curve = `M ${x0} ${BASELINE_Y} L ${x1} ${PEAK_Y} L ${x2} ${sustainY} L ${x3} ${sustainY} L ${x4} ${BASELINE_Y}`;
  const area = `${curve} L ${x0} ${BASELINE_Y} Z`;

  const label = (x: number, text: string) => (
    <text x={x} y={BASELINE_Y - 8} fill="#71717a" fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
      {text}
    </text>
  );

  return (
    <div className="relative flex h-[235px] w-full max-w-3xl items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-xl">
      <svg className="h-full w-full" viewBox={`0 0 ${VIEW_WIDTH} 130`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="adsrCurveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#52525b" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#52525b" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="0" />
          </linearGradient>
        </defs>

        {LEVEL_GUIDES.map((y, i) => (
          <line key={y} x1="20" y1={y} x2="580" y2={y} stroke={`rgba(255,255,255,${i === 0 ? 0.06 : 0.04})`} strokeDasharray="3 4" />
        ))}
        <line x1="20" y1={BASELINE_Y} x2="580" y2={BASELINE_Y} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

        <path d={area} fill="url(#adsrCurveFill)" />
        <path d={curve} fill="none" stroke="#e4e4e7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]" />

        <g className="pointer-events-none select-none">
          {label((x0 + x1) / 2, "ATTACK")}
          {label((x1 + x2) / 2, "DECAY")}
          {label((x2 + x3) / 2, `SUSTAIN (${Math.round(sustain * 100)}%)`)}
          {label((x3 + x4) / 2, "RELEASE")}
        </g>

        <DragHandle cx={x1} cy={PEAK_Y} cursor="cursor-ew-resize" params={["attack"]}
          onDrag={(dx) => setParam("attack", attack + (dx / 100) * 1.5)} />
        <DragHandle cx={x2} cy={sustainY} cursor="cursor-move" params={["decay", "sustain"]}
          onDrag={(dx, dy) => {
            setParam("decay", decay + (dx / 100) * 2.5);
            setParam("sustain", sustain - dy / 80);
          }} />
        <DragHandle cx={x4} cy={BASELINE_Y} cursor="cursor-ew-resize" params={["release"]}
          onDrag={(dx) => setParam("release", release + (dx / 100) * 3)} />
      </svg>
    </div>
  );
}

export function EnvelopesDeck() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-between px-6 py-3.5">
      <AdsrGraph />

      <Panel className="flex h-[175px] w-full max-w-3xl flex-col items-center justify-center p-4">
        <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Envelope Generators</span>
        <div className="flex w-full items-center justify-center gap-14">
          <ParamKnob param="attack" label="Attack" step={0.001} format={(v) => (v <= 0.005 ? "1ms" : formatSeconds(v))} />
          <ParamKnob param="decay" label="Decay" step={0.01} format={(v) => formatSeconds(v)} />
          <ParamKnob param="sustain" label="Sustain" step={0.01} format={formatPercent} />
          <ParamKnob param="release" label="Release" step={0.01} format={(v) => formatSeconds(v)} />
        </div>
      </Panel>
    </div>
  );
}
