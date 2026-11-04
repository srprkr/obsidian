import { Knob } from "../../components/Knob";
import { ParamKnob } from "../../components/ParamKnob";
import { SectionTitle, VerticalDivider } from "../../components/controls";
import { formatMilliseconds, formatSeconds } from "../../lib/format";
import { midiToNoteName, noteNameToMidi } from "../../lib/notes";
import { usePluginStore } from "../../state/pluginStore";
import { type Marker, MARKER_PARAM, paramsTouchedBy, SNAP_DIVISIONS, useMarkerMover } from "./regionMarkers";

/** Knob showing a marker in seconds; edits go through the same rules as dragging on the waveform. */
function MarkerKnob({ marker, label, duration }: { marker: Marker; label: string; duration: number }) {
  const fraction = usePluginStore((s) => s.params[MARKER_PARAM[marker]]);
  const snap = usePluginStore((s) => s.ui.snapToGrid);
  const moveMarker = useMarkerMover();

  const gestures = (begin: boolean) => () => {
    const { ui, beginGesture, endGesture } = usePluginStore.getState();
    paramsTouchedBy(marker, ui.endLinked).forEach(begin ? beginGesture : endGesture);
  };

  const seconds = fraction * duration;
  return (
    <Knob
      label={label}
      value={seconds}
      min={0}
      max={duration}
      step={snap ? duration / SNAP_DIVISIONS : 0.001}
      displayValue={formatSeconds(seconds)}
      onChange={(s) => moveMarker(marker, s / Math.max(duration, 1e-6))}
      onGestureStart={gestures(true)}
      onGestureEnd={gestures(false)}
    />
  );
}

function RootKnob() {
  return (
    <ParamKnob
      param="rootNote"
      label="Root"
      step={1}
      format={(v) => midiToNoteName(Math.round(v))}
      parseInput={(text) => noteNameToMidi(text) ?? (Number.isNaN(parseFloat(text)) ? null : parseFloat(text))}
    />
  );
}

/** One-shot mode: Start / End / Root. */
export function OneShotRegion({ duration }: { duration: number }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <SectionTitle>One Shot Region</SectionTitle>
      <div className="flex items-center gap-4">
        <MarkerKnob marker="start" label="Start" duration={duration} />
        <MarkerKnob marker="end" label="End" duration={duration} />
        <RootKnob />
      </div>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Loop mode: boundaries, the Link End switch and the loop markers. */
export function LoopRegion({ duration }: { duration: number }) {
  const endLinked = usePluginStore((s) => s.ui.endLinked);

  const toggleLink = () => {
    const { ui, params, updateUi, setParam } = usePluginStore.getState();
    const linking = !ui.endLinked;
    updateUi({ endLinked: linking });
    if (linking) setParam("loopEndPos", Math.max(params.endPos, params.loopStartPos + 0.001));
  };

  return (
    <>
      <div className="flex flex-col items-center gap-2.5">
        <SectionTitle>Boundaries</SectionTitle>
        <div className="flex items-center gap-3">
          <MarkerKnob marker="start" label="Start" duration={duration} />
          <MarkerKnob marker="end" label="End" duration={duration} />
          <RootKnob />
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-1.5 self-center px-1">
        <VerticalDivider className="h-8" />
        <button
          onClick={toggleLink}
          title={endLinked ? "Linked: End and Loop End move together (click to unlink)" : "Link End and Loop End"}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[9px] font-bold uppercase shadow-sm transition ${
            endLinked ? "border-zinc-500 bg-zinc-750 text-white shadow-md" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
          }`}
        >
          <LinkIcon />
          <span>Link End</span>
        </button>
        <VerticalDivider className="h-8" />
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <SectionTitle>Seamless Loop</SectionTitle>
        <div className="flex items-center gap-4">
          <MarkerKnob marker="loopStart" label="Loop Start" duration={duration} />
          <MarkerKnob marker="loopEnd" label="Loop End" duration={duration} />
          <ParamKnob param="loopCrossfade" label="Pre X-Fade" step={0.001} format={formatMilliseconds} />
        </div>
      </div>
    </>
  );
}
