import React from "react";
import { Zap } from "lucide-react";

export interface ArpeggiatorDeckProps {
  arpRate: string;
  setArpRate: (r: string) => void;
  arpPattern: string;
  setArpPattern: (p: string) => void;
  arpOctaves: number;
  setArpOctaves: (o: number) => void;
  arpGate: number;
  setArpGate: (g: number) => void;
  isArpPlaying: boolean;
  setIsArpPlaying: (p: boolean) => void;
  hostBpm: number;
  arpPlayrate?: number;
  setArpPlayrate?: (r: number) => void;
}

const ROOT_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES = ["Minor", "Major", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Pentatonic", "Blues"];
const PATTERNS = [
  { id: "up", label: "UP" },
  { id: "down", label: "DOWN" },
  { id: "upDown", label: "UP/DOWN" },
  { id: "random", label: "RANDOM" },
  { id: "chord", label: "CHORD" },
];
const RATES = ["1/4", "1/8", "1/16", "1/32"];

export function ArpeggiatorDeck({
  arpRate,
  setArpRate,
  arpPattern,
  setArpPattern,
  arpOctaves,
  setArpOctaves,
  hostBpm,
  arpPlayrate = 1,
  setArpPlayrate,
}: ArpeggiatorDeckProps) {
  return (
    <div className="w-full h-full px-6 pt-3.5 pb-3.5 flex flex-col justify-between">
      {/* Top Transport & Setup Strip */}
      <div className="flex items-center justify-between gap-4 bg-zinc-950/80 p-3 rounded-xl border border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-bold text-zinc-500">Div:</span>
            <div className="flex items-center bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
              {RATES.map((r) => (
                <button
                  key={r}
                  onClick={() => setArpRate(r)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition ${
                    arpRate === r
                      ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 pl-3 border-l border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-zinc-500">Octaves:</span>
            <div className="flex items-center bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
              {[1, 2, 3, 4].map((oct) => (
                <button
                  key={oct}
                  onClick={() => setArpOctaves(oct)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition ${
                    arpOctaves === oct
                      ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {oct}
                </button>
              ))}
            </div>
          </div>

          {/* Rate Multiplier: 0.5x, 1x, 2x */}
          <div className="flex items-center gap-1.5 pl-3 border-l border-zinc-800">
            <span className="text-[10px] uppercase font-bold text-zinc-500">Rate:</span>
            <div className="flex items-center bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
              {[0.5, 1, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => setArpPlayrate && setArpPlayrate(rate)}
                  className={`px-2 py-1 rounded text-xs font-mono font-bold transition ${
                    arpPlayrate === rate
                      ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
          <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">SYNC:</span>
          <span className="font-mono text-zinc-100 font-bold text-xs">{hostBpm} BPM</span>
        </div>
      </div>

      {/* Main Arpeggiator Stage */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 shadow-xl flex flex-col gap-3 flex-1 justify-between">
        <div className="flex items-center justify-between text-xs text-zinc-500 font-bold uppercase tracking-wider pb-2 border-b border-zinc-800/60">
          <div className="flex items-center gap-3">
            <span className="text-zinc-300 font-bold">Arpeggiator Engine</span>
            <div className="flex items-center gap-2 pl-3 border-l border-zinc-800">
              <span className="text-[10px] text-zinc-400 font-bold">Key:</span>
              <select className="bg-zinc-900 border border-zinc-750 rounded px-2 py-0.5 text-xs text-white font-mono font-bold outline-none cursor-pointer">
                {ROOT_NOTES.map((n) => (
                  <option key={n} value={n} className="bg-zinc-900 text-white">
                    {n}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-zinc-400 font-bold ml-1">Mode:</span>
              <select className="bg-zinc-900 border border-zinc-750 rounded px-2 py-0.5 text-xs text-white font-bold outline-none cursor-pointer">
                {MODES.map((m) => (
                  <option key={m} value={m} className="bg-zinc-900 text-white">
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <span className="font-mono text-zinc-400">HOLD KEYS BELOW TO DRIVE ARP</span>
        </div>

        {/* Pattern Cards */}
        <div className="grid grid-cols-5 gap-3">
          {PATTERNS.map((p) => (
            <button
              key={p.id}
              onClick={() => setArpPattern(p.id)}
              className={`h-24 rounded-xl flex flex-col items-center justify-center gap-2 transition border ${
                arpPattern === p.id
                  ? "bg-zinc-200 text-zinc-950 font-bold border-white shadow-md scale-[1.02]"
                  : "bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border-zinc-800"
              }`}
            >
              <Zap
                className={`w-4 h-4 ${
                  arpPattern === p.id ? "text-zinc-950 fill-current" : "text-zinc-500"
                }`}
              />
              <span className="text-xs font-bold tracking-wider">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Visualizer Banner */}
        <div className="w-full h-24 rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-3 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
              Arp Pattern Mode
            </span>
            <span className="text-xl font-mono font-bold text-emerald-400 uppercase tracking-widest">
              {arpPattern}
            </span>
          </div>
          <div className="text-right flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
              Timing & Octaves
            </span>
            <span className="text-xs font-mono text-zinc-300">
              {arpRate} Division • {arpOctaves} Octave{arpOctaves > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}