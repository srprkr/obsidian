import { useEffect, useRef } from "react";
import { useTelemetryStore } from "../state/pluginStore";

const SEGMENTS = 12;
const DECAY_PER_FRAME = 0.88;

function segmentColours(index: number) {
  if (index >= SEGMENTS - 2) return { lit: "#ef4444", dim: "rgba(239, 68, 68, 0.12)" }; // clip
  if (index >= SEGMENTS - 5) return { lit: "#eab308", dim: "rgba(234, 179, 8, 0.12)" };
  return { lit: "#22c55e", dim: "rgba(34, 197, 94, 0.12)" };
}

/** Stereo LED peak meter fed by the engine's per-block peak levels. */
export function OutputMeter() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let frame = 0;
    const smoothed = [0, 0];

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const { peak } = useTelemetryStore.getState();
      for (let ch = 0; ch < 2; ch++) {
        smoothed[ch] = peak[ch] > smoothed[ch] ? peak[ch] : smoothed[ch] * DECAY_PER_FRAME;
        if (smoothed[ch] < 0.001) smoothed[ch] = 0;
      }

      const { width, height } = canvas;
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, width, height);

      const gap = 1.5;
      const segmentHeight = (height - (SEGMENTS - 1) * gap - 2) / SEGMENTS;
      const barWidth = (width - 5) / 2;

      for (let ch = 0; ch < 2; ch++) {
        const litCount = Math.round(Math.min(1, smoothed[ch] * 1.15) * SEGMENTS);
        const x = 1.5 + ch * (barWidth + 2);
        for (let s = 0; s < SEGMENTS; s++) {
          const y = height - 1 - (s + 1) * segmentHeight - s * gap;
          const colours = segmentColours(s);
          ctx.fillStyle = s < litCount ? colours.lit : colours.dim;
          ctx.fillRect(x, y, barWidth, segmentHeight);
        }
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex h-16 shrink-0 flex-col items-center justify-between py-0.5">
      <canvas
        ref={canvasRef}
        width={16}
        height={46}
        className="rounded border border-zinc-800 bg-zinc-950 shadow-inner"
        title="Output level"
      />
      <span className="font-mono text-[8px] font-bold tracking-tighter text-zinc-500">METER</span>
    </div>
  );
}
