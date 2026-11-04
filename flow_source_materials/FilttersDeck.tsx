import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Zap, Sliders, RotateCcw, Waves, Check } from "lucide-react";

export type FilterSlope = 12 | 18 | 24;

export interface FiltersDeckProps {
  lpfEnabled: boolean;
  setLpfEnabled: (enabled: boolean) => void;
  lpfCutoff: number;
  setLpfCutoff: (cutoff: number) => void;
  lpfResonance: number;
  setLpfResonance: (res: number) => void;
  lpfSlope: FilterSlope;
  setLpfSlope: (slope: FilterSlope) => void;

  hpfEnabled: boolean;
  setHpfEnabled: (enabled: boolean) => void;
  hpfCutoff: number;
  setHpfCutoff: (cutoff: number) => void;
  hpfResonance: number;
  setHpfResonance: (res: number) => void;
  hpfSlope: FilterSlope;
  setHpfSlope: (slope: FilterSlope) => void;
}

// Logarithmic Frequency Mapping: 20 Hz to 20,000 Hz
function freqToX(freq: number, width: number = 400): number {
  const clamped = Math.max(20, Math.min(20000, freq));
  return width * (Math.log10(clamped / 20) / Math.log10(20000 / 20));
}

function xToFreq(x: number, width: number = 400): number {
  const norm = Math.max(0, Math.min(1, x / width));
  return 20 * Math.pow(1000, norm);
}

// Decibel Magnitude Mapping: -36 dB (bottom) to +18 dB (top)
function dbToY(db: number, height: number = 150): number {
  const clamped = Math.max(-42, Math.min(24, db));
  const topDb = 18;
  const bottomDb = -36;
  const range = topDb - bottomDb;
  const norm = (clamped - bottomDb) / range;
  return height - norm * (height - 16) - 8;
}

function yToResonance(y: number, height: number = 150): number {
  const norm = Math.max(0, Math.min(1, 1 - y / height));
  return Math.max(0.1, Math.min(10.0, Number((0.1 + norm * 9.9).toFixed(1))));
}

// Format frequency for display
function formatFreq(f: number): string {
  if (f >= 10000) {
    return `${(f / 1000).toFixed(1)}k`;
  }
  if (f >= 1000) {
    return `${(f / 1000).toFixed(2)}k`;
  }
  return `${Math.round(f)}`;
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  isLog?: boolean;
  displayValue?: string;
  disabled?: boolean;
  onChange: (val: number) => void;
}

function Knob({
  label,
  value,
  min,
  max,
  step = 0.01,
  isLog = false,
  displayValue,
  disabled = false,
  onChange,
}: KnobProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isDragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(value);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commitValue = () => {
    setIsEditing(false);
    const parsed = parseFloat(inputText);
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(clamped);
    }
  };

  // Map value to angle (-135deg to +135deg = 270deg range)
  const norm = isLog
    ? Math.max(0, Math.min(1, Math.log10(value / min) / Math.log10(max / min)))
    : Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const angle = -135 + norm * 270;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || disabled) return;
    const deltaY = startY.current - e.clientY;
    const sensitivity = e.shiftKey ? 0.002 : 0.008;

    if (isLog) {
      const currentLog = Math.log10(startVal.current / min) / Math.log10(max / min);
      const nextLog = Math.max(0, Math.min(1, currentLog + deltaY * sensitivity));
      const nextVal = Math.round(min * Math.pow(max / min, nextLog));
      onChange(Math.max(min, Math.min(max, nextVal)));
    } else {
      const range = max - min;
      let next = startVal.current + deltaY * range * sensitivity;
      if (step) {
        next = Math.round(next / step) * step;
      }
      next = Math.min(max, Math.max(min, next));
      onChange(next);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    isDragging.current = false;
  };

  return (
    <div
      className={`flex flex-col items-center gap-2 select-none ${
        disabled ? "opacity-30 cursor-not-allowed" : "cursor-ns-resize"
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Precision Hardware Dial (Identical to main synth design) */}
      <div className="relative w-12 h-12 rounded-full bg-zinc-850 p-[3px] shadow-inner border border-zinc-700 flex items-center justify-center">
        {/* Subtle Arc Track Ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none p-1">
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="1.5"
            strokeDasharray="100"
            strokeDashoffset="25"
          />
        </svg>

        {/* Brushed Metal Rotor with Dark Grey Hardware Finish */}
        <div
          className="w-8 h-8 rounded-full bg-gradient-to-b from-zinc-700 to-zinc-800 border border-zinc-600/80 shadow-md flex items-center justify-center relative select-none will-change-transform"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          {/* Subtle Rotor Center Notch */}
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-900 border border-zinc-600/50" />
          {/* Indicator Pip in sleek silver-grey */}
          <div className="w-0.5 h-2.5 rounded-full bg-zinc-200 absolute top-0.5 shadow-sm" />
        </div>
      </div>

      <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400">
        {label}
      </span>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitValue();
            if (e.key === "Escape") setIsEditing(false);
          }}
          onBlur={commitValue}
          className="w-14 text-center bg-zinc-950 border border-zinc-600 rounded px-1 py-0.5 text-[10px] font-mono text-white outline-none"
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            setInputText(value.toString());
            setIsEditing(true);
          }}
          title="Double-click to type value"
          className="text-[10px] font-mono font-medium text-zinc-300 hover:text-white hover:underline cursor-text"
        >
          {displayValue ?? value.toFixed(2)}
        </span>
      )}
    </div>
  );
}

export function FiltersDeck({
  lpfEnabled,
  setLpfEnabled,
  lpfCutoff,
  setLpfCutoff,
  lpfResonance,
  setLpfResonance,
  lpfSlope,
  setLpfSlope,

  hpfEnabled,
  setHpfEnabled,
  hpfCutoff,
  setHpfCutoff,
  hpfResonance,
  setHpfResonance,
  hpfSlope,
  setHpfSlope,
}: FiltersDeckProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingTarget = useRef<"hpf" | "lpf" | null>(null);
  const [hoveredPuck, setHoveredPuck] = useState<"hpf" | "lpf" | null>(null);

  // Compute points for unified frequency graph
  const W = 800;
  const H = 200;

  const { pathTotal, areaTotal, pathHpf, pathLpf, hpfPuckX, hpfPuckY, lpfPuckX, lpfPuckY } =
    useMemo(() => {
      const numPoints = 160;
      const qEffHpf = Math.max(0.5, Math.min(16, 0.5 + Math.pow(hpfResonance / 2.6, 1.85)));
      const qStageHpf = Math.sqrt(qEffHpf);
      const qEffLpf = Math.max(0.5, Math.min(16, 0.5 + Math.pow(lpfResonance / 2.6, 1.85)));
      const qStageLpf = Math.sqrt(qEffLpf);

      const totalPoints: Array<[number, number]> = [];
      const hpfPoints: Array<[number, number]> = [];
      const lpfPoints: Array<[number, number]> = [];

      for (let i = 0; i <= numPoints; i++) {
        const x = (i / numPoints) * W;
        const f = xToFreq(x, W);

        // HPF calculation
        let dbHpf = 0;
        if (hpfEnabled) {
          const rH = hpfCutoff / f;
          let magSqH = 1.0;
          if (hpfSlope === 12) {
            magSqH = 1.0 / ((1 - rH * rH) * (1 - rH * rH) + (rH / qEffHpf) * (rH / qEffHpf));
          } else if (hpfSlope === 18) {
            const twoPole = 1.0 / ((1 - rH * rH) * (1 - rH * rH) + (rH / qEffHpf) * (rH / qEffHpf));
            const onePole = 1.0 / (1 + rH * rH);
            magSqH = twoPole * onePole;
          } else {
            const single = 1.0 / ((1 - rH * rH) * (1 - rH * rH) + (rH / qStageHpf) * (rH / qStageHpf));
            magSqH = single * single;
          }
          dbHpf = 10 * Math.log10(Math.max(1e-6, magSqH));
        }

        // LPF calculation
        let dbLpf = 0;
        if (lpfEnabled) {
          const rL = f / lpfCutoff;
          let magSqL = 1.0;
          if (lpfSlope === 12) {
            magSqL = 1.0 / ((1 - rL * rL) * (1 - rL * rL) + (rL / qEffLpf) * (rL / qEffLpf));
          } else if (lpfSlope === 18) {
            const twoPole = 1.0 / ((1 - rL * rL) * (1 - rL * rL) + (rL / qEffLpf) * (rL / qEffLpf));
            const onePole = 1.0 / (1 + rL * rL);
            magSqL = twoPole * onePole;
          } else {
            const single = 1.0 / ((1 - rL * rL) * (1 - rL * rL) + (rL / qStageLpf) * (rL / qStageLpf));
            magSqL = single * single;
          }
          dbLpf = 10 * Math.log10(Math.max(1e-6, magSqL));
        }

        const dbTotal = dbHpf + dbLpf;
        totalPoints.push([x, dbToY(dbTotal, H)]);
        hpfPoints.push([x, dbToY(dbHpf, H)]);
        lpfPoints.push([x, dbToY(dbLpf, H)]);
      }

      const pTotal = totalPoints.reduce(
        (acc, [x, y], idx) => (idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`),
        ""
      );
      const aTotal = `${pTotal} L ${W} ${H} L 0 ${H} Z`;

      const pHpf = hpfPoints.reduce(
        (acc, [x, y], idx) => (idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`),
        ""
      );
      const pLpf = lpfPoints.reduce(
        (acc, [x, y], idx) => (idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${acc} L ${x.toFixed(1)} ${y.toFixed(1)}`),
        ""
      );

      // Puck coordinates
      const hX = freqToX(hpfCutoff, W);
      const hPeakDb = hpfEnabled ? 20 * Math.log10(qEffHpf) : 0;
      const hY = dbToY(hPeakDb, H);

      const lX = freqToX(lpfCutoff, W);
      const lPeakDb = lpfEnabled ? 20 * Math.log10(qEffLpf) : 0;
      const lY = dbToY(lPeakDb, H);

      return {
        pathTotal: pTotal,
        areaTotal: aTotal,
        pathHpf: pHpf,
        pathLpf: pLpf,
        hpfPuckX: hX,
        hpfPuckY: hY,
        lpfPuckX: lX,
        lpfPuckY: lY,
      };
    }, [hpfEnabled, hpfCutoff, hpfResonance, hpfSlope, lpfEnabled, lpfCutoff, lpfResonance, lpfSlope]);

  // Unified Pointer Dragging for both filter pucks
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);

    const rect = svg.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * W;
    const clickFreq = xToFreq(clickX, W);

    // Pick closest filter puck
    const distHpf = Math.abs(Math.log10(clickFreq / hpfCutoff));
    const distLpf = Math.abs(Math.log10(clickFreq / lpfCutoff));

    if (distHpf <= distLpf) {
      draggingTarget.current = "hpf";
      updateFilterFromPointer("hpf", e);
    } else {
      draggingTarget.current = "lpf";
      updateFilterFromPointer("lpf", e);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingTarget.current) return;
    updateFilterFromPointer(draggingTarget.current, e);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (svgRef.current && svgRef.current.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
    draggingTarget.current = null;
  };

  const updateFilterFromPointer = (target: "hpf" | "lpf", e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newCutoff = Math.round(20 * Math.pow(1000, normX));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const newRes = Math.max(0.1, Math.min(10.0, Number((0.1 + (1 - normY) * 9.9).toFixed(1))));

    if (target === "hpf") {
      setHpfEnabled(true);
      setHpfCutoff(Math.min(20000, Math.max(20, newCutoff)));
      setHpfResonance(newRes);
    } else {
      setLpfEnabled(true);
      setLpfCutoff(Math.min(20000, Math.max(20, newCutoff)));
      setLpfResonance(newRes);
    }
  };

  return (
    <div className="w-full h-full px-6 py-3.5 flex flex-col justify-between select-none">
      {/* 1. SINGLE UNIFIED FREQUENCY GRAPH FOR BOTH FILTERS */}
      <div className="relative w-full h-[220px] rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950/95 shadow-2xl flex flex-col justify-between">
        <svg
          ref={svgRef}
          viewBox="0 0 800 200"
          preserveAspectRatio="none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-full select-none touch-none cursor-crosshair"
        >
          <defs>
            <linearGradient id="unifiedTotalGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#52525b" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#52525b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#09090b" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="curveStrokeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#d4d4d8" />
              <stop offset="50%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#d4d4d8" />
            </linearGradient>
          </defs>

          {/* Horizontal dB Grid Lines */}
          {[12, 6, 0, -12, -24, -36].map((db) => {
            const y = dbToY(db, H);
            const isZero = db === 0;
            return (
              <g key={db}>
                <line
                  x1="0"
                  y1={y}
                  x2={W}
                  y2={y}
                  stroke={isZero ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)"}
                  strokeWidth={isZero ? "1.5" : "1"}
                  strokeDasharray={isZero ? "none" : "3 4"}
                />
                <text
                  x="8"
                  y={y - 3}
                  fill={isZero ? "#e4e4e7" : "#52525b"}
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight={isZero ? "bold" : "normal"}
                >
                  {db > 0 ? `+${db}` : db} dB
                </text>
                <text
                  x={W - 8}
                  y={y - 3}
                  fill={isZero ? "#e4e4e7" : "#52525b"}
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight={isZero ? "bold" : "normal"}
                  textAnchor="end"
                >
                  {db > 0 ? `+${db}` : db} dB
                </text>
              </g>
            );
          })}

          {/* Vertical Frequency Logarithmic Grid Lines */}
          {[50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000].map((f) => {
            const x = freqToX(f, W);
            return (
              <g key={f}>
                <line
                  x1={x}
                  y1="0"
                  x2={x}
                  y2={H}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <text
                  x={x}
                  y={H - 6}
                  fill="#71717a"
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {formatFreq(f)}
                </text>
              </g>
            );
          })}

          {/* Shaded Area under Composite Frequency Response */}
          <path d={areaTotal} fill="url(#unifiedTotalGrad)" />

          {/* Individual HPF response line (neutral zinc-500) */}
          {hpfEnabled && (
            <path
              d={pathHpf}
              fill="none"
              stroke="#71717a"
              strokeWidth="1.2"
              strokeDasharray="3 3"
              opacity="0.6"
            />
          )}

          {/* Individual LPF response line (neutral zinc-500) */}
          {lpfEnabled && (
            <path
              d={pathLpf}
              fill="none"
              stroke="#71717a"
              strokeWidth="1.2"
              strokeDasharray="3 3"
              opacity="0.6"
            />
          )}

          {/* Master Composite Response Curve (Solid Glowing White-Gradient Line) */}
          <path
            d={pathTotal}
            fill="none"
            stroke="url(#curveStrokeGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="filter drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]"
          />

          {/* Vertical Cutoff Marker Lines */}
          {hpfEnabled && (
            <line
              x1={hpfPuckX}
              y1="0"
              x2={hpfPuckX}
              y2={H}
              stroke="#71717a"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.6"
            />
          )}
          {lpfEnabled && (
            <line
              x1={lpfPuckX}
              y1="0"
              x2={lpfPuckX}
              y2={H}
              stroke="#71717a"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.6"
            />
          )}

          {/* HPF Interactive Draggable Puck */}
          <g
            transform={`translate(${hpfPuckX}, ${hpfPuckY})`}
            onPointerDown={(e) => {
              e.stopPropagation();
              draggingTarget.current = "hpf";
              if (svgRef.current) svgRef.current.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setHpfCutoff(20);
              setHpfResonance(1.0);
            }}
            onMouseEnter={() => setHoveredPuck("hpf")}
            onMouseLeave={() => setHoveredPuck(null)}
            className="cursor-grab active:cursor-grabbing"
            opacity={hpfEnabled ? 1 : 0.35}
          >
            <circle
              r="12"
              fill="#52525b"
              fillOpacity={hoveredPuck === "hpf" ? 0.45 : 0.25}
              className="transition-all"
            />
            <circle r="5" fill="#e4e4e7" stroke="#18181b" strokeWidth="1.5" />
            <text
              y="-10"
              fill="#e4e4e7"
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              HPF
            </text>
          </g>

          {/* LPF Interactive Draggable Puck */}
          <g
            transform={`translate(${lpfPuckX}, ${lpfPuckY})`}
            onPointerDown={(e) => {
              e.stopPropagation();
              draggingTarget.current = "lpf";
              if (svgRef.current) svgRef.current.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setLpfCutoff(20000);
              setLpfResonance(1.0);
            }}
            onMouseEnter={() => setHoveredPuck("lpf")}
            onMouseLeave={() => setHoveredPuck(null)}
            className="cursor-grab active:cursor-grabbing"
            opacity={lpfEnabled ? 1 : 0.35}
          >
            <circle
              r="12"
              fill="#52525b"
              fillOpacity={hoveredPuck === "lpf" ? 0.45 : 0.25}
              className="transition-all"
            />
            <circle r="5" fill="#e4e4e7" stroke="#18181b" strokeWidth="1.5" />
            <text
              y="-10"
              fill="#e4e4e7"
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              LPF
            </text>
          </g>
        </svg>
      </div>

      {/* 2. DUAL HARDWARE CONTROLS (HIGH PASS ON LEFT, LOW PASS ON RIGHT) */}
      <div className="grid grid-cols-2 gap-4 h-[190px] mt-2.5">
        {/* ================= HIGH PASS FILTER CONTROLS ================= */}
        <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 shadow-xl flex flex-col justify-between">
          {/* Header Row */}
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHpfEnabled(!hpfEnabled)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border transition ${
                  hpfEnabled
                    ? "bg-zinc-800 text-white border-zinc-600 shadow-sm"
                    : "bg-zinc-900 text-zinc-500 border-zinc-800"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full transition-all ${
                    hpfEnabled
                      ? "bg-zinc-200 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
                      : "bg-zinc-600"
                  }`}
                />
                <span>{hpfEnabled ? "Active" : "Bypass"}</span>
              </button>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                High Pass Filter
              </span>
            </div>

            {/* Slope Selector: 12, 18, 24 dB/oct */}
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
              <span className="text-[9px] font-mono text-zinc-500 uppercase px-1">
                Slope:
              </span>
              {([12, 18, 24] as FilterSlope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setHpfSlope(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                    hpfSlope === s
                      ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {s} dB
                </button>
              ))}
            </div>
          </div>

          {/* Knobs Row (Cutoff & Emphasis with synth-consistent knob design) */}
          <div className="flex items-center justify-around py-2">
            <Knob
              label="Cutoff"
              value={hpfCutoff}
              min={20}
              max={20000}
              isLog={true}
              disabled={!hpfEnabled}
              displayValue={
                hpfCutoff >= 1000
                  ? `${(hpfCutoff / 1000).toFixed(2)} kHz`
                  : `${hpfCutoff} Hz`
              }
              onChange={setHpfCutoff}
            />
            <Knob
              label="Emphasis"
              value={hpfResonance}
              min={0.1}
              max={10.0}
              step={0.1}
              disabled={!hpfEnabled}
              displayValue={`${hpfResonance.toFixed(1)}`}
              onChange={setHpfResonance}
            />
          </div>
        </div>

        {/* ================= LOW PASS FILTER CONTROLS ================= */}
        <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 shadow-xl flex flex-col justify-between">
          {/* Header Row */}
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLpfEnabled(!lpfEnabled)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border transition ${
                  lpfEnabled
                    ? "bg-zinc-800 text-white border-zinc-600 shadow-sm"
                    : "bg-zinc-900 text-zinc-500 border-zinc-800"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full transition-all ${
                    lpfEnabled
                      ? "bg-zinc-200 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
                      : "bg-zinc-600"
                  }`}
                />
                <span>{lpfEnabled ? "Active" : "Bypass"}</span>
              </button>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Low Pass Filter
              </span>
            </div>

            {/* Slope Selector: 12, 18, 24 dB/oct */}
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
              <span className="text-[9px] font-mono text-zinc-500 uppercase px-1">
                Slope:
              </span>
              {([12, 18, 24] as FilterSlope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setLpfSlope(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                    lpfSlope === s
                      ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {s} dB
                </button>
              ))}
            </div>
          </div>

          {/* Knobs Row (Cutoff & Emphasis with synth-consistent knob design) */}
          <div className="flex items-center justify-around py-2">
            <Knob
              label="Cutoff"
              value={lpfCutoff}
              min={20}
              max={20000}
              isLog={true}
              disabled={!lpfEnabled}
              displayValue={
                lpfCutoff >= 1000
                  ? `${(lpfCutoff / 1000).toFixed(2)} kHz`
                  : `${lpfCutoff} Hz`
              }
              onChange={setLpfCutoff}
            />
            <Knob
              label="Emphasis"
              value={lpfResonance}
              min={0.1}
              max={10.0}
              step={0.1}
              disabled={!lpfEnabled}
              displayValue={`${lpfResonance.toFixed(1)}`}
              onChange={setLpfResonance}
            />
          </div>
        </div>
      </div>
    </div>
  );
}