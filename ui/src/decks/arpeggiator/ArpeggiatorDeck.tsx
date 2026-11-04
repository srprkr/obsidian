import { Zap } from "lucide-react";
import { ParamKnob } from "../../components/ParamKnob";
import { FieldLabel, SegmentedControl, StatusDot } from "../../components/controls";
import { formatPercent } from "../../lib/format";
import { useChoiceParam, useParam } from "../../state/hooks";
import { ARP_DIVISIONS, ARP_PATTERNS, RATE_MULTIPLIERS } from "../../state/parameterIds";
import { useTelemetryStore } from "../../state/pluginStore";

type PatternId = (typeof ARP_PATTERNS)[number]["id"];
const PATTERN_IDS = ARP_PATTERNS.map((p) => p.id);
const OCTAVE_CHOICES = [1, 2, 3, 4];

/** The Arpeggiator tab (one-shot mode): held keys are played one at a time in a pattern. */
export function ArpeggiatorDeck() {
  const [division, setDivision] = useChoiceParam<string>("arpDivision", ARP_DIVISIONS);
  const [rate, setRate] = useChoiceParam<number>("arpRate", RATE_MULTIPLIERS);
  const [pattern, setPattern] = useChoiceParam<PatternId>("arpPattern", PATTERN_IDS);
  const octaves = useParam("arpOctaves");
  const hostBpm = useTelemetryStore((t) => t.hostBpm);
  const running = useTelemetryStore((t) => t.arpRunning);

  const patternLabel = ARP_PATTERNS.find((p) => p.id === pattern)?.label ?? pattern;
  const octaveCount = Math.round(octaves.value);

  return (
    <div className="flex h-full w-full flex-col justify-between gap-3 px-6 py-3.5">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <FieldLabel>Div:</FieldLabel>
            <SegmentedControl<string> value={division} onChange={setDivision} options={ARP_DIVISIONS.map((d) => ({ value: d, label: d }))} />
          </div>
          <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-3">
            <FieldLabel>Octaves:</FieldLabel>
            <SegmentedControl<number> value={octaveCount} onChange={octaves.set} options={OCTAVE_CHOICES.map((o) => ({ value: o, label: o }))} />
          </div>
          <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-3">
            <FieldLabel>Rate:</FieldLabel>
            <SegmentedControl<number> value={rate} onChange={setRate} options={RATE_MULTIPLIERS.map((r) => ({ value: r, label: `${r}x` }))} />
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5" title="The arpeggiator always follows the host tempo">
          <StatusDot on />
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">SYNC:</span>
          <span className="font-mono text-xs font-bold text-zinc-100">{Math.round(hostBpm)} BPM</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          <span className="flex items-center gap-2 font-bold text-zinc-300">
            Arpeggiator Engine <StatusDot on={running} />
          </span>
          <span className="font-mono text-zinc-400">Hold keys to drive the arp</span>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {ARP_PATTERNS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPattern(p.id)}
              className={`flex h-24 flex-col items-center justify-center gap-2 rounded-xl border transition ${
                pattern === p.id
                  ? "scale-[1.02] border-white bg-zinc-200 font-bold text-zinc-950 shadow-md"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200"
              }`}
            >
              <Zap className={`h-4 w-4 ${pattern === p.id ? "fill-current text-zinc-950" : "text-zinc-500"}`} />
              <span className="text-xs font-bold tracking-wider">{p.label}</span>
            </button>
          ))}
        </div>

        <div className="flex h-24 w-full items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">Arp Pattern Mode</span>
            <span className="font-mono text-xl font-bold uppercase tracking-widest text-emerald-400">{patternLabel}</span>
          </div>

          <div className="origin-center scale-90">
            <ParamKnob param="arpGate" label="Gate" step={0.01} format={formatPercent} />
          </div>

          <div className="flex flex-col gap-1 text-right">
            <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">Timing & Octaves</span>
            <span className="font-mono text-xs text-zinc-300">
              {division} Division • {octaveCount} Octave{octaveCount > 1 ? "s" : ""} • {rate}x
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
