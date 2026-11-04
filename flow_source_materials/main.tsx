import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Square,
  Upload,
  Volume2,
  FolderOpen,
  RotateCcw,
  Music,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Save,
  Search,
  Star,
  Copy,
  Trash2,
  Sliders,
  Check,
  X,
  ZoomIn,
  Maximize2,
} from "lucide-react";
import { SequencerDeck } from "./SequencerDeck";
import { ArpeggiatorDeck } from "./ArpeggiatorDeck";
import { MasterTabBar, RateSelector } from "./MasterTabBar";
import { FiltersDeck, FilterSlope } from "./FiltersDeck";

interface SampleZone {
  buffer: AudioBuffer | null;
  name: string;
  rootMidi: number;
  duration: number;
}

interface SamplerSettings {
  // Playback Mode: One Shot (plays to end) vs Loop (seamless crossfaded loop)
  playbackMode: "oneshot" | "loop";
  // Waveform markers (in seconds)
  startSec: number;
  endSec: number;
  loopStartSec: number;
  loopEndSec: number;
  loopEnabled: boolean;
  loopCrossfadeSec: number;
  releaseTriggerSec: number;
  releaseTriggerEnabled: boolean;
  releaseTriggerGain: number; // 0.0 - 1.5 (Volume)
  // ADSR
  attack: number; // 0.001 - 2.0s
  decay: number; // 0.01 - 3.0s
  sustain: number; // 0.0 - 1.0 (gain)
  release: number; // 0.01 - 4.0s
  // Master
  gain: number; // 0.0 - 1.5
  filterCutoff: number; // 200 - 20000 Hz
  baseRootMidi: number; // e.g. 60 (C4)
  // Speed Preservation & Host DAW Tempo Sync
  preserveSpeed: boolean;
  tempoSyncEnabled: boolean;
  sampleBpm: number; // 40 - 240 BPM
  hostBpm: number; // 40 - 240 BPM

  // Moog Model D Dual Filter Parameters
  lpfEnabled: boolean;
  lpfCutoff: number; // 20 - 20000 Hz
  lpfResonance: number; // 0.1 - 10.0
  lpfSlope: FilterSlope; // 12 | 18 | 24
  lpfDrive: number; // 0 - 10

  hpfEnabled: boolean;
  hpfCutoff: number; // 20 - 20000 Hz
  hpfResonance: number; // 0.1 - 10.0
  hpfSlope: FilterSlope; // 12 | 18 | 24
  hpfDrive: number; // 0 - 10
}

interface Preset {
  id: string;
  name: string;
  isFavorite?: boolean;
  settings: SamplerSettings;
}

// Clean initial state with zero factory presets
const DEFAULT_PRESETS: Preset[] = [];

function WaveformGrid() {
  const bars = [1, 2, 3, 4];
  return (
    <div className="absolute inset-0 pointer-events-none flex">
      {bars.map((b) => (
        <div key={b} className={"flex-1 h-full flex flex-col justify-between " + (b > 1 ? "border-l border-white/40" : "")}>
          <span className="text-[9px] font-mono font-bold text-white/80 p-1">BAR {b}</span>
          <div className="flex-1 flex">
            <div className="flex-1 border-r border-dashed border-white/15" />
            <div className="flex-1 border-r border-dashed border-white/15" />
            <div className="flex-1 border-r border-dashed border-white/15" />
            <div className="flex-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function noteNameToMidi(name: string): number | null {
  const match = name.trim().match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return null;
  const rawNote = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);
  let noteIndex = NOTE_NAMES.indexOf(rawNote);
  if (noteIndex === -1) {
    const flats: Record<string, string> = {
      DB: "C#",
      EB: "D#",
      GB: "F#",
      AB: "G#",
      BB: "A#",
    };
    const mapped = flats[rawNote];
    if (mapped) noteIndex = NOTE_NAMES.indexOf(mapped);
  }
  if (noteIndex === -1) return null;
  return (octave + 1) * 12 + noteIndex;
}

// High-Quality Waveform Similarity Overlap-Add (WSOLA) Time-Scale Engine
// Preserves sample speed and phase alignment across keys with pristine studio fidelity
function timeStretchWSOLA(
  ctx: AudioContext,
  srcBuffer: AudioBuffer,
  timeRatio: number
): AudioBuffer {
  if (Math.abs(timeRatio - 1.0) < 0.005) {
    return srcBuffer;
  }

  const numChannels = srcBuffer.numberOfChannels;
  const sampleRate = srcBuffer.sampleRate;
  const srcLen = srcBuffer.length;
  const outLen = Math.max(128, Math.round(srcLen * timeRatio));

  const outBuffer = ctx.createBuffer(numChannels, outLen, sampleRate);

  // Grain size: ~32ms (1411-1536 samples), 50% overlap for perfect Hann reconstruction
  const grainSize = Math.min(2048, Math.max(512, Math.round(sampleRate * 0.032)));
  const hopOut = Math.floor(grainSize / 2);
  const searchRange = Math.min(Math.floor(grainSize * 0.4), Math.round(sampleRate * 0.012));

  // Precompute Hann window
  const window = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
  }

  const inChannels: Float32Array[] = [];
  const outChannels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    inChannels.push(srcBuffer.getChannelData(ch));
    outChannels.push(outBuffer.getChannelData(ch));
  }

  const mainIn = inChannels[0];
  const mainOut = outChannels[0];

  // Process first grain
  const initialLen = Math.min(grainSize, srcLen, outLen);
  for (let ch = 0; ch < numChannels; ch++) {
    const inD = inChannels[ch];
    const outD = outChannels[ch];
    for (let i = 0; i < initialLen; i++) {
      outD[i] = inD[i] * window[i];
    }
  }

  let outPos = hopOut;

  while (outPos + grainSize <= outLen) {
    const idealInPos = Math.round(outPos / timeRatio);
    const minSearch = Math.max(0, idealInPos - searchRange);
    const maxSearch = Math.min(srcLen - grainSize, idealInPos + searchRange);

    let bestInPos = idealInPos;
    let bestCorr = -Infinity;

    const overlapLen = hopOut;
    const stride = 2;

    // Fast coarse search for phase alignment
    for (let cand = minSearch; cand <= maxSearch; cand += stride) {
      let corr = 0;
      for (let j = 0; j < overlapLen; j += 4) {
        corr += mainIn[cand + j] * mainOut[outPos + j];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestInPos = cand;
      }
    }

    // Fine refinement
    const fineMin = Math.max(minSearch, bestInPos - (stride - 1));
    const fineMax = Math.min(maxSearch, bestInPos + (stride - 1));
    for (let cand = fineMin; cand <= fineMax; cand++) {
      let corr = 0;
      for (let j = 0; j < overlapLen; j += 2) {
        corr += mainIn[cand + j] * mainOut[outPos + j];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestInPos = cand;
      }
    }

    // Overlap-add grain with Hann window across all channels (preserving stereo phase)
    for (let ch = 0; ch < numChannels; ch++) {
      const inD = inChannels[ch];
      const outD = outChannels[ch];
      for (let i = 0; i < grainSize; i++) {
        outD[outPos + i] += inD[bestInPos + i] * window[i];
      }
    }

    outPos += hopOut;
  }

  return outBuffer;
}

// Equal-Power Seamless Loop Crossfade Engine
// Eliminates boundary pops, clicks, and discontinuities when audio loops
function applySeamlessLoopCrossfade(
  ctx: AudioContext,
  srcBuffer: AudioBuffer,
  loopStartSec: number,
  loopEndSec: number,
  crossfadeSec: number
): AudioBuffer {
  const numChannels = srcBuffer.numberOfChannels;
  const sampleRate = srcBuffer.sampleRate;
  const srcLen = srcBuffer.length;

  const startIdx = Math.max(0, Math.min(srcLen - 2, Math.floor(loopStartSec * sampleRate)));
  const endIdx = Math.max(startIdx + 16, Math.min(srcLen, Math.floor(loopEndSec * sampleRate)));
  const loopLen = endIdx - startIdx;

  if (loopLen < 32) return srcBuffer;

  const maxAllowedSec = (loopLen / sampleRate) * 0.45;
  const actualXfadeSec = Math.max(
    0.005,
    Math.min(crossfadeSec > 0 ? crossfadeSec : 0.05, maxAllowedSec)
  );
  const xfadeSamples = Math.floor(actualXfadeSec * sampleRate);

  if (xfadeSamples < 8) return srcBuffer;

  const outBuffer = ctx.createBuffer(numChannels, srcLen, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const inD = srcBuffer.getChannelData(ch);
    const outD = outBuffer.getChannelData(ch);
    outD.set(inD);

    if (startIdx >= xfadeSamples) {
      // Equal-power crossfade of pre-loop audio onto the loop tail
      for (let i = 0; i < xfadeSamples; i++) {
        const t = (i + 1) / (xfadeSamples + 1);
        const wOut = Math.cos(t * Math.PI * 0.5);
        const wIn = Math.sin(t * Math.PI * 0.5);
        const tailIdx = endIdx - xfadeSamples + i;
        const preIdx = startIdx - xfadeSamples + i;
        outD[tailIdx] = inD[tailIdx] * wOut + inD[preIdx] * wIn;
      }
    } else {
      // In-loop circular crossfade
      for (let i = 0; i < xfadeSamples; i++) {
        const t = (i + 1) / (xfadeSamples + 1);
        const wOut = Math.cos(t * Math.PI * 0.5);
        const wIn = Math.sin(t * Math.PI * 0.5);
        const tailIdx = endIdx - xfadeSamples + i;
        const headIdx = startIdx + i;
        outD[tailIdx] = inD[tailIdx] * wOut + inD[headIdx] * wIn;
      }
      const smoothWindow = Math.min(64, Math.floor(xfadeSamples * 0.25));
      const targetVal = outD[startIdx];
      for (let i = 0; i < smoothWindow; i++) {
        const frac = (i + 1) / smoothWindow;
        const sIdx = endIdx - smoothWindow + i;
        outD[sIdx] = outD[sIdx] * (1 - frac) + targetVal * frac;
      }
    }
  }

  return outBuffer;
}

interface VoicePlayback {
  midiNote: number;
  startTime: number;
  startSec: number;
  speedFactor: number;
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  endSec: number;
  duration: number;
  lpfFilters?: BiquadFilterNode[];
  hpfFilters?: BiquadFilterNode[];
  stop: (skipReleaseTrigger?: boolean) => void;
}

// Moog Model D Filter Stage Builder supporting 12, 18, and 24 dB/oct slopes
function buildMoogFilterStage(
  ctx: AudioContext,
  type: "lowpass" | "highpass",
  cutoff: number,
  resonance: number,
  slope: FilterSlope,
  now: number
): { input: AudioNode; output: AudioNode; filters: BiquadFilterNode[] } {
  const clampedCutoff = Math.max(20, Math.min(20000, cutoff));
  // Moog emphasis (0.1 to 10) mapped to Web Audio Q
  const qVal = Math.max(0.5, Math.min(16, 0.5 + Math.pow(resonance / 2.6, 1.85)));

  if (slope === 12) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(clampedCutoff, now);
    f.Q.setValueAtTime(qVal, now);
    return { input: f, output: f, filters: [f] };
  } else if (slope === 18) {
    // 3-pole: 2-pole resonant biquad + 1-pole low-Q biquad
    const f1 = ctx.createBiquadFilter();
    f1.type = type;
    f1.frequency.setValueAtTime(clampedCutoff, now);
    f1.Q.setValueAtTime(qVal, now);

    const f2 = ctx.createBiquadFilter();
    f2.type = type;
    f2.frequency.setValueAtTime(clampedCutoff, now);
    f2.Q.setValueAtTime(0.5, now);

    f1.connect(f2);
    return { input: f1, output: f2, filters: [f1, f2] };
  } else {
    // 24 dB/oct: 4-pole cascaded Moog ladder topology
    const f1 = ctx.createBiquadFilter();
    f1.type = type;
    f1.frequency.setValueAtTime(clampedCutoff, now);
    f1.Q.setValueAtTime(Math.sqrt(qVal), now);

    const f2 = ctx.createBiquadFilter();
    f2.type = type;
    f2.frequency.setValueAtTime(clampedCutoff, now);
    f2.Q.setValueAtTime(Math.sqrt(qVal) * 1.15, now);

    f1.connect(f2);
    return { input: f1, output: f2, filters: [f1, f2] };
  }
}

// Reusable Precision Minimalist Rotary Knob Component
interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue?: string;
  color?: string;
  disabled?: boolean;
  onChange: (val: number) => void;
}

function Knob({
  label,
  value,
  min,
  max,
  step = 0.01,
  displayValue,
  color = "#d4d4d8",
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
    } else {
      const noteMidi = noteNameToMidi(inputText);
      if (noteMidi !== null) {
        const clamped = Math.min(max, Math.max(min, noteMidi));
        onChange(clamped);
      }
    }
  };

  // Map value to angle (-135deg to +135deg = 270deg range)
  const norm = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
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
    const range = max - min;
    const sensitivity = e.shiftKey ? 0.002 : 0.008;
    let next = startVal.current + deltaY * range * sensitivity;
    if (step) {
      next = Math.round(next / step) * step;
    }
    next = Math.min(max, Math.max(min, next));
    onChange(next);
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
      {/* Precision Hardware Dial */}
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

export default function Component() {
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [settings, setSettings] = useState<SamplerSettings>({
    playbackMode: "oneshot",
    startSec: 0.0,
    endSec: 2.5,
    loopStartSec: 0.35,
    loopEndSec: 1.7,
    loopEnabled: false,
    loopCrossfadeSec: 0.2,
    releaseTriggerSec: 1.8,
    releaseTriggerEnabled: false,
    releaseTriggerGain: 1.0,
    attack: 0.001,
    decay: 0.8,
    sustain: 0.8,
    release: 0.5,
    gain: 1.0,
    filterCutoff: 20000,
    baseRootMidi: 60,
    preserveSpeed: true,
    tempoSyncEnabled: true,
    sampleBpm: 120,
    hostBpm: 124,

    // Moog Model D Dual Filters (Off / Bypassed by default)
    lpfEnabled: false,
    lpfCutoff: 20000,
    lpfResonance: 1.0,
    lpfSlope: 24,
    lpfDrive: 1.0,

    hpfEnabled: false,
    hpfCutoff: 20,
    hpfResonance: 1.0,
    hpfSlope: 12,
    hpfDrive: 1.0,
  });
  const [masterTab, setMasterTab] = useState<
    "playback" | "envelopes" | "filters" | "sequencer" | "arpeggiator"
  >("playback");
  const [heldKeysCount, setHeldKeysCount] = useState<number>(0);
  const isManualPlayRunningRef = useRef<boolean>(false);
  const [sequencerEnabled, setSequencerEnabled] = useState<boolean>(false);
  const [arpeggiatorEnabled, setArpeggiatorEnabled] = useState<boolean>(false);
  const sequencerEnabledRef = useRef<boolean>(false);
  sequencerEnabledRef.current = sequencerEnabled;
  const arpeggiatorEnabledRef = useRef<boolean>(false);
  arpeggiatorEnabledRef.current = arpeggiatorEnabled;
  const [arpRate, setArpRate] = useState<string>("1/16");
  const [arpPattern, setArpPattern] = useState<string>("up");
  const [arpOctaves, setArpOctaves] = useState<number>(2);
  const [arpGate, setArpGate] = useState<number>(0.8);
  const [isArpPlaying, setIsArpPlaying] = useState<boolean>(false);
  const [playbackSubTab, setPlaybackSubTab] = useState<"sample" | "sync">("sample");
  const [sampleBuffer, setSampleBuffer] = useState<AudioBuffer | null>(null);
  const [isSeqPlaying, setIsSeqPlaying] = useState<boolean>(false);
  const [totalSteps, setTotalSteps] = useState<number>(8);
  const [seqMode, setSeqMode] = useState<"step" | "melodic">("step");
  const [seqPitches, setSeqPitches] = useState<number[]>(() => {
    const scale = [60, 60, 63, 63, 65, 65, 67, 67, 70, 70, 67, 65, 63, 63, 60, 60];
    const arr = new Array(32).fill(60);
    for (let i = 0; i < 32; i++) arr[i] = scale[i % 16];
    return arr;
  });
  const [seqSteps, setSeqSteps] = useState<boolean[]>(() => new Array(32).fill(false));
  const [seqSplitSteps, setSeqSplitSteps] = useState<boolean[]>(() => new Array(32).fill(false));
  const seqSplitStepsRef = useRef<boolean[]>(seqSplitSteps);
  seqSplitStepsRef.current = seqSplitSteps;

  const [seqSubSteps, setSeqSubSteps] = useState<boolean[]>(() => new Array(32).fill(false));
  const seqSubStepsRef = useRef<boolean[]>(seqSubSteps);
  seqSubStepsRef.current = seqSubSteps;

  const [seqVelocities, setSeqVelocities] = useState<number[]>(() => new Array(32).fill(100));
  const seqVelocitiesRef = useRef<number[]>(seqVelocities);
  seqVelocitiesRef.current = seqVelocities;

  const [seqSubVelocities, setSeqSubVelocities] = useState<number[]>(() => new Array(32).fill(100));
  const seqSubVelocitiesRef = useRef<number[]>(seqSubVelocities);
  seqSubVelocitiesRef.current = seqSubVelocities;

  const [seqArpOffsets, setSeqArpOffsets] = useState<number[]>(() => new Array(32).fill(0));
  const seqArpOffsetsRef = useRef<number[]>(seqArpOffsets);
  seqArpOffsetsRef.current = seqArpOffsets;

  const [seqSubArpOffsets, setSeqSubArpOffsets] = useState<number[]>(() => new Array(32).fill(0));
  const seqSubArpOffsetsRef = useRef<number[]>(seqSubArpOffsets);
  seqSubArpOffsetsRef.current = seqSubArpOffsets;

  const [seqPans, setSeqPans] = useState<number[]>(() => new Array(32).fill(0));
  const seqPansRef = useRef<number[]>(seqPans);
  seqPansRef.current = seqPans;

  const [seqSubPans, setSeqSubPans] = useState<number[]>(() => new Array(32).fill(0));
  const seqSubPansRef = useRef<number[]>(seqSubPans);
  seqSubPansRef.current = seqSubPans;

  const [currentSeqSubStep, setCurrentSeqSubStep] = useState<0 | 1>(0);
  const [seqSubTab, setSeqSubTab] = useState<"velocity" | "arp" | "pan">("velocity");
  const [currentSeqStep, setCurrentSeqStep] = useState<number>(0);
  const [seqBpm, setSeqBpm] = useState<number>(120);
  const [isSeqDawSync, setIsSeqDawSync] = useState<boolean>(true);
  const [customSeqBpm, setCustomSeqBpm] = useState<number>(120);
  const [keyTranspose, setKeyTranspose] = useState<number>(0);
  const keyTransposeRef = useRef<number>(0);
  keyTransposeRef.current = keyTranspose;
  const [seqPlayrate, setSeqPlayrate] = useState<number>(1);
  const seqPlayrateRef = useRef<number>(1);
  seqPlayrateRef.current = seqPlayrate;
  const [arpPlayrate, setArpPlayrate] = useState<number>(1);
  const arpPlayrateRef = useRef<number>(1);
  arpPlayrateRef.current = arpPlayrate;
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const playbackRateRef = useRef<number>(1.0);
  playbackRateRef.current = playbackRate;
  const [isEditingBpm, setIsEditingBpm] = useState<boolean>(false);
  const [bpmInputText, setBpmInputText] = useState<string>("120");
  const [fxDelayEnabled, setFxDelayEnabled] = useState<boolean>(false);
  const [fxDelayTime, setFxDelayTime] = useState<number>(0.25);
  const [fxDelayFeedback, setFxDelayFeedback] = useState<number>(0.4);
  const [fxDelayMix, setFxDelayMix] = useState<number>(0.35);
  const [sampleName, setSampleName] = useState<string>("No Sample Loaded");
  const [releaseSampleBuffer, setReleaseSampleBuffer] = useState<AudioBuffer | null>(null);
  const [releaseSampleName, setReleaseSampleName] = useState<string | null>(null);
  const releaseSampleBufferRef = useRef<AudioBuffer | null>(null);
  releaseSampleBufferRef.current = releaseSampleBuffer;
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [isPresetMenuOpen, setIsPresetMenuOpen] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Waveform Visualizer Scaling & Display Controls
  const [showWaveformGrid, setShowWaveformGrid] = useState<boolean>(false);
  const showWaveformGridRef = useRef<boolean>(false);
  showWaveformGridRef.current = showWaveformGrid;
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
  const snapToGridRef = useRef<boolean>(false);
  snapToGridRef.current = snapToGrid;
  const [waveformScale, setWaveformScale] = useState<number>(1.0);
  const [isExpandedView, setIsExpandedView] = useState<boolean>(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState<boolean>(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const infoMenuRef = useRef<HTMLDivElement | null>(null);
  const waveformScaleRef = useRef<number>(1.0);
  waveformScaleRef.current = waveformScale;

  // Master Audio Bus & Output Meter Refs
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const masterAnalyserRef = useRef<AnalyserNode | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserDataRef = useRef<Uint8Array>(new Uint8Array(256));
  const smoothedPeakRef = useRef<number>(0);
  const fxDelayNodeRef = useRef<DelayNode | null>(null);
  const fxDelayFeedbackRef = useRef<GainNode | null>(null);
  const fxDelayWetRef = useRef<GainNode | null>(null);
  const fxInputRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        isZoomMenuOpen &&
        zoomMenuRef.current &&
        !zoomMenuRef.current.contains(target)
      ) {
        setIsZoomMenuOpen(false);
      }
      if (
        isInfoOpen &&
        infoMenuRef.current &&
        !infoMenuRef.current.contains(target)
      ) {
        setIsInfoOpen(false);
      }
    };
    window.addEventListener("pointerdown", handleOutsideClick);
    return () => window.removeEventListener("pointerdown", handleOutsideClick);
  }, [isZoomMenuOpen, isInfoOpen]);

  const handleAutoScale = useCallback(() => {
    if (!sampleBuffer) return;
    const data = sampleBuffer.getChannelData(0);
    let maxAmp = 0.001;
    const step = Math.max(1, Math.floor(data.length / 5000));
    for (let i = 0; i < data.length; i += step) {
      const abs = Math.abs(data[i]);
      if (abs > maxAmp) maxAmp = abs;
    }
    const targetScale = Math.min(10, Math.max(1, Number((0.92 / maxAmp).toFixed(1))));
    setWaveformScale(targetScale);
  }, [sampleBuffer]);

  const [isEditingRoot, setIsEditingRoot] = useState(false);
  const [rootInputText, setRootInputText] = useState("");
  const rootInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditingRoot && rootInputRef.current) {
      rootInputRef.current.focus();
      rootInputRef.current.select();
    }
  }, [isEditingRoot]);

  const commitRootNote = () => {
    setIsEditingRoot(false);
    const parsed = noteNameToMidi(rootInputText);
    if (parsed !== null) {
      const clamped = Math.min(96, Math.max(24, parsed));
      setSettings((p) => ({ ...p, baseRootMidi: clamped }));
    }
  };

  // A/B Comparison States (Classic Alloy Channel Feature)
  const [abState, setAbState] = useState<"A" | "B">("A");
  const [slotA, setSlotA] = useState<SamplerSettings>(settings);
  const [slotB, setSlotB] = useState<SamplerSettings>(settings);

  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(new Set());
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [isEndLinked, setIsEndLinked] = useState<boolean>(false);
  const isEndLinkedRef = useRef<boolean>(false);
  isEndLinkedRef.current = isEndLinked;

  // Active voices map: midiNote -> VoicePlayback
  const activeVoicesRef = useRef<Map<number, VoicePlayback>>(new Map());
  const releaseVoicesRef = useRef<Array<{ startTime: number; startSec: number; duration: number }>>([]);
  const wsolaCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  // Clear WSOLA cache on sample buffer change
  useEffect(() => {
    wsolaCacheRef.current.clear();
  }, [sampleBuffer]);

  const getWsolaBuffer = useCallback(
    (ctx: AudioContext, srcBuffer: AudioBuffer, timeRatio: number): AudioBuffer => {
      if (Math.abs(timeRatio - 1.0) < 0.005) {
        return srcBuffer;
      }
      const key = `${srcBuffer.length}_${timeRatio.toFixed(4)}`;
      if (wsolaCacheRef.current.has(key)) {
        return wsolaCacheRef.current.get(key)!;
      }
      const stretched = timeStretchWSOLA(ctx, srcBuffer, timeRatio);
      wsolaCacheRef.current.set(key, stretched);
      return stretched;
    },
    []
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const releaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const settingsRef = useRef<SamplerSettings>(settings);
  settingsRef.current = settings;
  const bufferRef = useRef<AudioBuffer | null>(null);
  bufferRef.current = sampleBuffer;

  // Initialize AudioContext
  const getOrCreateAudioCtx = useCallback(() => {
    let ctx = audioCtx;
    if (ctx && ctx.state !== "closed") {
      if (ctx.state === "suspended") {
        ctx.resume();
      }
    } else {
      ctx = new AudioContext();
      setAudioCtx(ctx);
    }

    if (!masterGainNodeRef.current && ctx) {
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(settingsRef.current.gain, ctx.currentTime);

      const masterAnalyser = ctx.createAnalyser();
      masterAnalyser.fftSize = 256;
      masterAnalyser.smoothingTimeConstant = 0.5;

      const delayNode = ctx.createDelay();
      delayNode.delayTime.setValueAtTime(fxDelayTime, ctx.currentTime);

      const delayFeedback = ctx.createGain();
      delayFeedback.gain.setValueAtTime(fxDelayFeedback, ctx.currentTime);

      const delayWet = ctx.createGain();
      delayWet.gain.setValueAtTime(fxDelayEnabled ? fxDelayMix : 0, ctx.currentTime);

      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);
      delayNode.connect(delayWet);
      delayWet.connect(masterGain);

      masterGain.connect(masterAnalyser);
      masterAnalyser.connect(ctx.destination);

      masterGainNodeRef.current = masterGain;
      masterAnalyserRef.current = masterAnalyser;
      fxDelayNodeRef.current = delayNode;
      fxDelayFeedbackRef.current = delayFeedback;
      fxDelayWetRef.current = delayWet;
    }

    return ctx;
  }, [audioCtx, fxDelayTime, fxDelayFeedback, fxDelayMix, fxDelayEnabled]);

  // Initialize AudioContext on mount without default sample
  useEffect(() => {
    const ctx = new AudioContext();
    setAudioCtx(ctx);
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(settings.gain, ctx.currentTime);
    const masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 256;
    masterAnalyser.smoothingTimeConstant = 0.5;
    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);
    masterGainNodeRef.current = masterGain;
    masterAnalyserRef.current = masterAnalyser;

    return () => {
      ctx.close();
    };
  }, []);

  // Reset to playback tab if sample is cleared/ejected or mode changes
  useEffect(() => {
    if (!sampleBuffer && (masterTab === "sequencer" || masterTab === "arpeggiator")) {
      setMasterTab("playback");
    }
    if (masterTab === "arpeggiator" && settings.playbackMode !== "oneshot") {
      setMasterTab("playback");
    }
  }, [sampleBuffer, masterTab, settings.playbackMode]);

  // Adjust markers and reset waveform scale if buffer changes
  useEffect(() => {
    if (!sampleBuffer) return;
    setWaveformScale(1.0);
    const dur = sampleBuffer.duration;
    setSettings((prev) => {
      const endSec = Math.min(prev.endSec, dur);
      const loopEndSec = Math.min(prev.loopEndSec, dur);
      const loopStartSec = Math.min(prev.loopStartSec, loopEndSec - 0.05);
      return {
        ...prev,
        endSec: endSec > 0.05 ? endSec : dur,
        loopEndSec: loopEndSec > 0.1 ? loopEndSec : dur * 0.85,
        loopStartSec: loopStartSec >= 0 ? loopStartSec : 0.05,
        releaseTriggerSec: Math.min(prev.releaseTriggerSec, dur * 0.95),
      };
    });
  }, [sampleBuffer]);

  // Handle external audio upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ctx = getOrCreateAudioCtx();
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      setSampleBuffer(decoded);
      setSampleName(file.name.replace(/\.[^/.]+$/, ""));
      setWaveformScale(1.0);

      // Set default loop and boundary markers to full sample duration
      const dur = decoded.duration;
      setSettings((prev) => ({
        ...prev,
        startSec: 0,
        endSec: dur,
        loopStartSec: 0,
        loopEndSec: dur,
        loopCrossfadeSec: 0.02,
        releaseTriggerSec: Number((dur * 0.8).toFixed(2)),
        preserveSpeed: true,
        tempoSyncEnabled: true,
      }));
    } catch (err) {
      console.error("Failed to decode audio file:", err);
    }
  };

  // Handle separate release trigger audio upload
  const handleReleaseFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ctx = getOrCreateAudioCtx();
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      setReleaseSampleBuffer(decoded);
      setReleaseSampleName(file.name.replace(/\.[^/.]+$/, ""));
      setSettings((prev) => ({
        ...prev,
        releaseTriggerEnabled: true,
        releaseTriggerSec: 0,
      }));
    } catch (err) {
      console.error("Failed to decode release audio file:", err);
    }
    e.target.value = "";
  };

  const handleClearReleaseSample = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setReleaseSampleBuffer(null);
    setReleaseSampleName(null);
    releaseSampleBufferRef.current = null;
  };

  // Build a multisampled crossfaded looped voice playback with pristine studio-grade audio quality
  const triggerVoice = useCallback(
    (
      midiNote: number,
      gateDurationSec?: number,
      scheduleTime?: number,
      velocity: number = 127,
      pan: number = 0
    ) => {
      const ctx = getOrCreateAudioCtx();
      let buf = bufferRef.current;
      if (!buf) return;

      const currentSettings = settingsRef.current;
      const now = scheduleTime !== undefined ? scheduleTime : ctx.currentTime;

      // Stop previous voice on this note if active
      if (activeVoicesRef.current.has(midiNote)) {
        activeVoicesRef.current.get(midiNote)?.stop(true);
      }

      // Calculate chromatic semitone distance from root
      const semitones = midiNote - currentSettings.baseRootMidi;
      const pitchRatio = Math.pow(2, semitones / 12);

      // Base speed factor: if DAW sync is active, speed is scaled to match hostBpm
      const tempoSyncFactor =
        currentSettings.tempoSyncEnabled &&
        currentSettings.sampleBpm > 0 &&
        currentSettings.hostBpm > 0
          ? currentSettings.hostBpm / currentSettings.sampleBpm
          : 1.0;

      // If preserveSpeed is active, scale buffer duration so playback speed remains constant across all keys
      const timeRatio = currentSettings.preserveSpeed
        ? pitchRatio / tempoSyncFactor
        : 1.0 / tempoSyncFactor;

      // Obtain high-quality phase-aligned WSOLA buffer
      const effectiveBuffer = getWsolaBuffer(ctx, buf, timeRatio);

      // Web Audio native resampling handles the clean pitch shift
      const effectivePlaybackRate = pitchRatio;

      const isOneShot = currentSettings.playbackMode === "oneshot";
      const isLoop = currentSettings.playbackMode === "loop" || currentSettings.loopEnabled;

      // Calculate marker positions mapped to the time-scaled buffer
      const scaledStartSec = Math.max(
        0,
        Math.min(currentSettings.startSec * timeRatio, effectiveBuffer.duration)
      );
      const scaledEndSec = Math.min(
        effectiveBuffer.duration,
        Math.max(scaledStartSec + 0.01, currentSettings.endSec * timeRatio)
      );
      const scaledLoopStartSec = Math.max(
        0,
        Math.min(currentSettings.loopStartSec * timeRatio, effectiveBuffer.duration)
      );
      const scaledLoopEndSec = Math.min(
        effectiveBuffer.duration,
        Math.max(scaledLoopStartSec + 0.01, currentSettings.loopEndSec * timeRatio)
      );
      const bufferPlayDuration = Math.max(0.01, scaledEndSec - scaledStartSec);
      const playDurationCtx = bufferPlayDuration / effectivePlaybackRate;

      // Dedicated Voice Bus: multiple overlapping crossfaded loop sources connect here
      const voiceBus = ctx.createGain();
      voiceBus.gain.setValueAtTime(1.0, now);

      // Filter Node Chain: Highpass -> Lowpass with Moog Ladder slope modeling
      let lastNode: AudioNode = voiceBus;
      const voiceLpfFilters: BiquadFilterNode[] = [];
      const voiceHpfFilters: BiquadFilterNode[] = [];

      if (currentSettings.hpfEnabled && currentSettings.hpfCutoff > 20) {
        const hStage = buildMoogFilterStage(
          ctx,
          "highpass",
          currentSettings.hpfCutoff,
          currentSettings.hpfResonance,
          currentSettings.hpfSlope,
          now
        );
        lastNode.connect(hStage.input);
        lastNode = hStage.output;
        voiceHpfFilters.push(...hStage.filters);
      }

      if (currentSettings.lpfEnabled && (currentSettings.lpfCutoff < 20000 || currentSettings.lpfResonance > 1.0)) {
        const lStage = buildMoogFilterStage(
          ctx,
          "lowpass",
          currentSettings.lpfCutoff,
          currentSettings.lpfResonance,
          currentSettings.lpfSlope,
          now
        );
        lastNode.connect(lStage.input);
        lastNode = lStage.output;
        voiceLpfFilters.push(...lStage.filters);
      }

      // MIDI Velocity Scaling (0 - 127)
      const clampedVel = Math.min(127, Math.max(0, velocity));
      const velGainFactor = Math.pow(clampedVel / 127, 1.25);
      const targetGain = Math.max(0.0001, currentSettings.gain * velGainFactor);

      // Standard Linear ADSR Gain Envelope
      const gainNode = ctx.createGain();
      const attackTime = Math.max(0.001, currentSettings.attack);
      const decayTime = Math.max(0.01, currentSettings.decay);
      const sustainLevel = Math.max(0.0001, targetGain * currentSettings.sustain);

      // Note ON Stage:
      // 1. Attack: Ramp from 0 to peak targetGain
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + attackTime);

      // Dedicated Voice Bus connects through Filter Chain to gainNode
      lastNode.connect(gainNode);

      // Stereo Panner Node for Per-Step Panning
      let panner: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1.0, Math.min(1.0, pan)), now);
        gainNode.connect(panner);
      }
      const voiceOut = panner || gainNode;

      if (fxInputRef.current) {
        voiceOut.connect(fxInputRef.current);
      } else if (masterGainNodeRef.current) {
        voiceOut.connect(masterGainNodeRef.current);
      } else {
        voiceOut.connect(ctx.destination);
      }

      let naturalEndTimer: number | null = null;
      let loopTimer: number | null = null;
      const activeSources: Array<{ source: AudioBufferSourceNode; gain: GainNode }> = [];

      if (isLoop && !gateDurationSec) {
        // 3. Continuous Seamless Loop: Real-time dual-voice overlapping crossfade with anti-click micro-fades
        const loopDurationBuf = Math.max(0.02, scaledLoopEndSec - scaledLoopStartSec);
        const loopDurationCtx = loopDurationBuf / effectivePlaybackRate;
        const xfadeSec = Math.max(0.005, currentSettings.loopCrossfadeSec || 0.08);
        const xfadeCtx = Math.min(loopDurationCtx * 0.45, xfadeSec);

        const firstBufferLen = Math.max(0.01, scaledLoopEndSec - scaledStartSec);
        const firstDurationCtx = firstBufferLen / effectivePlaybackRate;

        // Anti-click micro-fade (3ms) to guarantee zero pops/clicks at loop boundary
        const microFadeSec = Math.min(0.003, loopDurationCtx * 0.05);

        const scheduleLoopSource = (
          startTime: number,
          bufferOffset: number,
          isFirst: boolean,
          durationCtx: number
        ) => {
          const src = ctx.createBufferSource();
          src.buffer = effectiveBuffer;
          src.playbackRate.setValueAtTime(effectivePlaybackRate, startTime);

          const srcGain = ctx.createGain();
          src.connect(srcGain);
          srcGain.connect(voiceBus);

          if (isFirst) {
            srcGain.gain.setValueAtTime(0.0001, startTime);
            srcGain.gain.linearRampToValueAtTime(1.0, startTime + microFadeSec);
          } else {
            srcGain.gain.setValueAtTime(0.0001, startTime);
            srcGain.gain.linearRampToValueAtTime(1.0, startTime + xfadeCtx);
          }

          const fadeOutTime = startTime + durationCtx - xfadeCtx;
          srcGain.gain.setValueAtTime(1.0, Math.max(startTime, fadeOutTime));
          srcGain.gain.linearRampToValueAtTime(0.0001, fadeOutTime + xfadeCtx);

          try {
            const playBufSec = (durationCtx + xfadeCtx) * effectivePlaybackRate + 0.005;
            src.start(startTime, bufferOffset, playBufSec);
            src.stop(fadeOutTime + xfadeCtx + 0.02);
          } catch (err) {
            console.error("Loop source start error:", err);
          }

          activeSources.push({ source: src, gain: srcGain });
        };

        // First source starts at now
        scheduleLoopSource(now, scaledStartSec, true, firstDurationCtx);

        let nextScheduleTime = now + firstDurationCtx - xfadeCtx;

        const scheduleAhead = () => {
          while (nextScheduleTime < ctx.currentTime + 0.4) {
            scheduleLoopSource(nextScheduleTime, scaledLoopStartSec, false, loopDurationCtx);
            nextScheduleTime += (loopDurationCtx - xfadeCtx);
          }

          // Prune stopped sources from tracking array
          for (let i = activeSources.length - 1; i >= 0; i--) {
            if (i < activeSources.length - 4) {
              try {
                activeSources[i].source.disconnect();
                activeSources[i].gain.disconnect();
              } catch {}
              activeSources.splice(i, 1);
            }
          }
        };

        scheduleAhead();
        loopTimer = window.setInterval(scheduleAhead, 35);
      } else {
        // Standard playback strictly bounded between scaledStartSec and scaledEndSec
        const src = ctx.createBufferSource();
        src.buffer = effectiveBuffer;
        src.playbackRate.setValueAtTime(effectivePlaybackRate, now);
        src.connect(voiceBus);

        const bufferPlayDuration = Math.max(0.01, scaledEndSec - scaledStartSec);
        const playDurationCtx = bufferPlayDuration / effectivePlaybackRate;

        // If step-gated in sequencer and not in one-shot mode, clamp to gateDurationSec
        const playDuration =
          gateDurationSec && !isOneShot
            ? Math.min(gateDurationSec, playDurationCtx)
            : playDurationCtx;

        // Anti-click micro-fade at the End node (3.5ms ramp to absolute zero to prevent pops)
        const endMicroFade = Math.min(0.0035, playDuration * 0.08);
        const stopTime = now + playDuration;

        try {
          // Allow buffer tail margin (5ms) so the gain node micro-ramp finishes cleanly at zero without buffer chop
          const actualBufferDuration = playDuration * effectivePlaybackRate + 0.005;
          src.start(now, scaledStartSec, actualBufferDuration);
          src.stop(stopTime + 0.01);
        } catch (err) {
          console.error("Source start error:", err);
        }
        activeSources.push({ source: src, gain: voiceBus });

        // Clean envelope scheduling with dedicated anti-click ramp at the end node
        const decayEndTime = now + attackTime + decayTime;
        const fadeStartTime = Math.max(now + attackTime, stopTime - endMicroFade);

        if (decayEndTime < fadeStartTime) {
          gainNode.gain.linearRampToValueAtTime(sustainLevel, decayEndTime);
          gainNode.gain.setValueAtTime(sustainLevel, fadeStartTime);
          gainNode.gain.linearRampToValueAtTime(0.0001, stopTime);
        } else {
          gainNode.gain.setValueAtTime(sustainLevel, fadeStartTime);
          gainNode.gain.linearRampToValueAtTime(0.0001, stopTime);
        }

        // Remove from active voices the moment it reaches the end marker
        naturalEndTimer = window.setTimeout(() => {
          if (activeVoicesRef.current.get(midiNote) === voicePlayback) {
            if (!settingsRef.current.releaseTriggerEnabled) {
              activeVoicesRef.current.delete(midiNote);
              setActiveMidiNotes((prev) => {
                const next = new Set(prev);
                next.delete(midiNote);
                return next;
              });
            }
          }
        }, (playDuration + 0.05) * 1000);
      }

      // Track active voice release function
      const voiceStop = (skipReleaseTrigger = false) => {
        if (naturalEndTimer) {
          clearTimeout(naturalEndTimer);
          naturalEndTimer = null;
        }
        if (loopTimer) {
          clearInterval(loopTimer);
          loopTimer = null;
        }

        const liveSettings = settingsRef.current;
        const releaseTime = ctx.currentTime;
        const currentRel = Math.max(0.01, Math.min(5.0, liveSettings.release));
        const currentGain = Math.max(0.0001, gainNode.gain.value);

        // 3. Release Stage: Ramp from current level down to 0 over release seconds
        gainNode.gain.cancelScheduledValues(releaseTime);
        gainNode.gain.setValueAtTime(currentGain, releaseTime);
        gainNode.gain.linearRampToValueAtTime(0.0001, releaseTime + currentRel);

        // Release trigger execution for both Loop and One-Shot modes
        const customRelBuf = releaseSampleBufferRef.current;
        const targetRelBuf = customRelBuf || buf;

        if (!skipReleaseTrigger && liveSettings.releaseTriggerEnabled && targetRelBuf) {
          const isCustomSample = !!customRelBuf;
          const relStartSec = Math.max(0, Math.min(liveSettings.releaseTriggerSec, targetRelBuf.duration));
          const relEndSec = isCustomSample
            ? targetRelBuf.duration
            : Math.min(targetRelBuf.duration, Math.max(relStartSec + 0.01, liveSettings.endSec));
          const relBufDuration = Math.max(0.01, relEndSec - relStartSec);

          const semitones = midiNote - liveSettings.baseRootMidi;
          const pitchRatio = Math.pow(2, semitones / 12);
          const tempoSyncFactor =
            liveSettings.tempoSyncEnabled && liveSettings.sampleBpm > 0 && liveSettings.hostBpm > 0
              ? liveSettings.hostBpm / liveSettings.sampleBpm
              : 1.0;
          const timeRatio = liveSettings.preserveSpeed ? pitchRatio / tempoSyncFactor : 1.0 / tempoSyncFactor;
          const relEffectiveBuf = getWsolaBuffer(ctx, targetRelBuf, timeRatio);

          const relSrc = ctx.createBufferSource();
          relSrc.buffer = relEffectiveBuf;
          relSrc.playbackRate.setValueAtTime(pitchRatio, releaseTime);

          const relFilter = ctx.createBiquadFilter();
          relFilter.type = "lowpass";
          relFilter.frequency.setValueAtTime(
            Math.min(20000, Math.max(20, liveSettings.filterCutoff)),
            releaseTime
          );

          const relGain = ctx.createGain();
          const relPlayDuration = relBufDuration / pitchRatio;
          const relFade = Math.min(0.02, relPlayDuration * 0.2);
          const relEffectiveGain = targetGain * (liveSettings.releaseTriggerGain ?? 1.0);

          relGain.gain.setValueAtTime(relEffectiveGain, releaseTime);
          if (relPlayDuration > relFade) {
            relGain.gain.setValueAtTime(relEffectiveGain, releaseTime + relPlayDuration - relFade);
            relGain.gain.linearRampToValueAtTime(0.0001, releaseTime + relPlayDuration);
          } else {
            relGain.gain.linearRampToValueAtTime(0.0001, releaseTime + relPlayDuration);
          }

          relSrc.connect(relFilter);
          relFilter.connect(relGain);
          if (masterGainNodeRef.current) {
            relGain.connect(masterGainNodeRef.current);
          } else {
            relGain.connect(ctx.destination);
          }

          try {
            relSrc.start(releaseTime, relStartSec * timeRatio, relBufDuration * timeRatio);
            relSrc.stop(releaseTime + relPlayDuration + 0.01);
          } catch (e) {
            console.error("Release trigger error:", e);
          }

          releaseVoicesRef.current.push({
            startTime: releaseTime,
            startSec: relStartSec,
            duration: relPlayDuration,
          });
        }

        // Stop all active sources when release finishes
        setTimeout(() => {
          try {
            activeSources.forEach(({ source: s, gain: g }) => {
              try {
                s.stop();
                s.disconnect();
                g.disconnect();
              } catch {}
            });
            voiceBus.disconnect();
            voiceLpfFilters.forEach((f) => { try { f.disconnect(); } catch {} });
            voiceHpfFilters.forEach((f) => { try { f.disconnect(); } catch {} });
            gainNode.disconnect();
            if (panner) panner.disconnect();
          } catch {}
        }, currentRel * 1000 + 50);
      };

      const voicePlayback: VoicePlayback = {
        midiNote,
        startTime: now,
        startSec: currentSettings.startSec,
        speedFactor: currentSettings.preserveSpeed ? tempoSyncFactor : pitchRatio * tempoSyncFactor,
        loopEnabled: currentSettings.loopEnabled && !gateDurationSec,
        loopStartSec: currentSettings.loopStartSec,
        loopEndSec: currentSettings.loopEndSec,
        endSec: currentSettings.endSec,
        duration: buf.duration,
        lpfFilters: voiceLpfFilters,
        hpfFilters: voiceHpfFilters,
        stop: voiceStop,
      };

      activeVoicesRef.current.set(midiNote, voicePlayback);
      setActiveMidiNotes((prev) => new Set(prev).add(midiNote));
    },
    [getOrCreateAudioCtx, getWsolaBuffer]
  );

  const releaseVoice = useCallback((midiNote: number, skipReleaseTrigger = false) => {
    const voice = activeVoicesRef.current.get(midiNote);
    if (voice) {
      voice.stop(skipReleaseTrigger);
      activeVoicesRef.current.delete(midiNote);
    }
    setActiveMidiNotes((prev) => {
      const updated = new Set(prev);
      updated.delete(midiNote);
      return updated;
    });
  }, []);

  const releaseAllVoices = useCallback((skipReleaseTrigger = false) => {
    activeVoicesRef.current.forEach((voice) => voice.stop(skipReleaseTrigger));
    activeVoicesRef.current.clear();
    setActiveMidiNotes(new Set());
  }, []);

  const heldKeysRef = useRef<Set<number>>(new Set());

  // Toggle Sequencer playback manually via the transport Play/Stop button
  const toggleSeqPlaying = useCallback(() => {
    const ctx = getOrCreateAudioCtx();
    setIsSeqPlaying((prev) => {
      const next = !prev;
      isManualPlayRunningRef.current = next;
      isSeqPlayingRef.current = next;
      if (!next) {
        // Explicit Stop clicked: stop all voices cleanly
        activeVoicesRef.current.forEach((voice) => voice.stop(true));
        activeVoicesRef.current.clear();
        setActiveMidiNotes(new Set());
        setCurrentSeqStep(0);
        currentStepIdxRef.current = 0;
      } else {
        nextStepTimeRef.current = ctx.currentTime;
      }
      return next;
    });
  }, [getOrCreateAudioCtx]);

  // Global pointer up listener to ensure keys and voices release cleanly
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (heldKeysRef.current.size > 0) {
        heldKeysRef.current.clear();
        setHeldKeysCount(0);
        setActiveMidiNotes(new Set());
        releaseAllVoices();
        const isSequencerActive = masterTab === "sequencer" || sequencerEnabledRef.current;
        if (isSequencerActive && !isManualPlayRunningRef.current) {
          setIsSeqPlaying(false);
          isSeqPlayingRef.current = false;
          setCurrentSeqStep(0);
          currentStepIdxRef.current = 0;
        }
      }
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    return () => window.removeEventListener("pointerup", handleGlobalPointerUp);
  }, [masterTab, releaseAllVoices]);

  // Keyboard pointer handlers: holding a key arms/drives the sequencer
  const handleKeyPointerDown = useCallback((midi: number) => {
    const ctx = getOrCreateAudioCtx();
    heldKeysRef.current.add(midi);
    setHeldKeysCount(heldKeysRef.current.size);
    setActiveMidiNotes(new Set(heldKeysRef.current));

    const isSequencerActive = masterTab === "sequencer" || sequencerEnabledRef.current;

    if (isSequencerActive) {
      const transpose = midi - settingsRef.current.baseRootMidi;
      setKeyTranspose(transpose);
      keyTransposeRef.current = transpose;

      const effectiveBpm = isSeqDawSyncRef.current
        ? settingsRef.current.hostBpm || 120
        : customSeqBpmRef.current || 120;
      const stepDuration = (60 / effectiveBpm / 4) / (seqPlayrateRef.current || 1);
      const stepsCount = totalStepsRef.current;
      const hasAnyEnabledStep = seqStepsRef.current.slice(0, stepsCount).some(Boolean);

      // Start the sequencer clock if it wasn't already running
      if (!isSeqPlayingRef.current) {
        isManualPlayRunningRef.current = false;
        setIsSeqPlaying(true);
        isSeqPlayingRef.current = true;
        setCurrentSeqStep(0);

        const startTime = ctx.currentTime;

        // If step 0 is enabled, trigger it IMMEDIATELY at startTime with zero latency!
        const isStep0Split = seqSplitStepsRef.current[0] || false;
        if (hasAnyEnabledStep) {
          if (isStep0Split) {
            const subDur = stepDuration / 2;
            if (seqStepsRef.current[0]) {
              const velA = seqVelocitiesRef.current[0] ?? 100;
              const panA = seqPansRef.current[0] ?? 0;
              const arpA = seqArpOffsetsRef.current[0] ?? 0;
              const noteToPlayA =
                seqModeRef.current === "melodic"
                  ? (seqPitchesRef.current[0] || settingsRef.current.baseRootMidi) + transpose + arpA
                  : midi + arpA;
              triggerVoice(noteToPlayA, subDur, startTime, velA, panA);
            }
            if (seqSubStepsRef.current[0]) {
              const velB = seqSubVelocitiesRef.current[0] ?? 100;
              const panB = seqSubPansRef.current[0] ?? 0;
              const arpB = seqSubArpOffsetsRef.current[0] ?? 0;
              const noteToPlayB =
                seqModeRef.current === "melodic"
                  ? (seqPitchesRef.current[0] || settingsRef.current.baseRootMidi) + transpose + arpB
                  : midi + arpB;
              triggerVoice(noteToPlayB, subDur, startTime + subDur, velB, panB);
            }
          } else if (seqStepsRef.current[0]) {
            const step0Vel = seqVelocitiesRef.current[0] ?? 100;
            const step0Pan = seqPansRef.current[0] ?? 0;
            const step0ArpOffset = seqArpOffsetsRef.current[0] ?? 0;
            const noteToPlay =
              seqModeRef.current === "melodic"
                ? (seqPitchesRef.current[0] || settingsRef.current.baseRootMidi) + transpose + step0ArpOffset
                : midi + step0ArpOffset;
            triggerVoice(noteToPlay, stepDuration, startTime, step0Vel, step0Pan);
          }
          currentStepIdxRef.current = 1;
          nextStepTimeRef.current = startTime + stepDuration;
        } else {
          currentStepIdxRef.current = 1;
          nextStepTimeRef.current = startTime + stepDuration;
        }
      }
      return;
    }

    triggerVoice(midi);
  }, [getOrCreateAudioCtx, masterTab, triggerVoice]);

  const handleKeyPointerUp = useCallback((midi: number) => {
    heldKeysRef.current.delete(midi);
    setHeldKeysCount(heldKeysRef.current.size);
    setActiveMidiNotes(new Set(heldKeysRef.current));

    const isSequencerActive = masterTab === "sequencer" || sequencerEnabledRef.current;

    if (isSequencerActive) {
      releaseVoice(midi);
      if (heldKeysRef.current.size === 0) {
        // Only stop all voices and stop sequence if NOT running manually via Play button!
        if (!isManualPlayRunningRef.current) {
          releaseAllVoices();
          setIsSeqPlaying(false);
          isSeqPlayingRef.current = false;
          setCurrentSeqStep(0);
          currentStepIdxRef.current = 0;
        }
      } else {
        const remaining = Array.from(heldKeysRef.current);
        const lastKey = remaining[remaining.length - 1];
        const transpose = lastKey - settingsRef.current.baseRootMidi;
        setKeyTranspose(transpose);
        keyTransposeRef.current = transpose;
      }
      return;
    }

    releaseVoice(midi);
  }, [masterTab, releaseVoice, releaseAllVoices]);

  // QWERTY Computer Keyboard Listener (A=C4, W=C#4, S=D4... or Spacebar=Root)
  useEffect(() => {
    const QWERTY_MAP: Record<string, number> = {
      a: 60,
      w: 61,
      s: 62,
      e: 63,
      d: 64,
      f: 65,
      t: 66,
      g: 67,
      y: 68,
      h: 69,
      u: 70,
      j: 71,
      k: 72,
      z: 48,
      x: 50,
      c: 52,
      v: 53,
      b: 55,
      " ": settings.baseRootMidi,
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      const midi = QWERTY_MAP[key];
      if (midi !== undefined) {
        if (key === " ") e.preventDefault();
        handleKeyPointerDown(midi);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      const midi = QWERTY_MAP[key];
      if (midi !== undefined) {
        if (key === " ") e.preventDefault();
        handleKeyPointerUp(midi);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyPointerDown, handleKeyPointerUp, settings.baseRootMidi]);

  // Real-time Sequencer Lookahead Engine
  const isSeqPlayingRef = useRef<boolean>(false);
  isSeqPlayingRef.current = isSeqPlaying;
  const isSeqDawSyncRef = useRef<boolean>(true);
  isSeqDawSyncRef.current = isSeqDawSync;
  const customSeqBpmRef = useRef<number>(120);
  customSeqBpmRef.current = customSeqBpm;
  const seqModeRef = useRef<"step" | "melodic">("step");
  seqModeRef.current = seqMode;
  const seqPitchesRef = useRef<number[]>(seqPitches);
  seqPitchesRef.current = seqPitches;
  const totalStepsRef = useRef<number>(8);
  totalStepsRef.current = totalSteps;
  const seqStepsRef = useRef<boolean[]>(seqSteps);
  seqStepsRef.current = seqSteps;
  const seqBpmRef = useRef<number>(120);
  seqBpmRef.current = seqBpm;
  const nextStepTimeRef = useRef<number>(0);
  const currentStepIdxRef = useRef<number>(0);
  const seqTimerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isSeqPlaying) {
      if (seqTimerIdRef.current) {
        clearInterval(seqTimerIdRef.current);
        seqTimerIdRef.current = null;
      }
      setCurrentSeqStep(0);
      currentStepIdxRef.current = 0;
      return;
    }

    const ctx = getOrCreateAudioCtx();

    // Only set nextStepTimeRef to now if it was not already scheduled by key down
    if (!nextStepTimeRef.current || nextStepTimeRef.current <= ctx.currentTime) {
      nextStepTimeRef.current = ctx.currentTime;
    }

    const interval = setInterval(() => {
      const effectiveBpm = isSeqDawSyncRef.current
        ? settingsRef.current.hostBpm || 120
        : customSeqBpmRef.current || 120;
      const stepDuration = (60 / effectiveBpm / 4) / (seqPlayrateRef.current || 1);
      const stepsCount = totalStepsRef.current;
      const hasAnyEnabledStep = seqStepsRef.current.slice(0, stepsCount).some(Boolean);

      // If pattern is completely blank or no keys are held, keep silent
      if (!hasAnyEnabledStep) {
        releaseAllVoices(true);
        return;
      }

      while (nextStepTimeRef.current < ctx.currentTime + 0.08) {
        const step = currentStepIdxRef.current % stepsCount;
        const isSplit = seqSplitStepsRef.current[step] || false;
        const schedTime = Math.max(ctx.currentTime, nextStepTimeRef.current);

        if (isSplit) {
          const subDuration = stepDuration / 2;

          // Sub-step 1 (first half)
          if (seqStepsRef.current[step]) {
            const rawVelA = seqVelocitiesRef.current[step];
            const velA = rawVelA !== undefined && rawVelA > 0 ? rawVelA : 100;
            const arpA = seqArpOffsetsRef.current[step] || 0;
            const panA = seqPansRef.current[step] || 0;
            const timeA = schedTime;

            if (heldKeysRef.current.size > 0) {
              heldKeysRef.current.forEach((heldMidi) => {
                const transpose = heldMidi - settingsRef.current.baseRootMidi;
                const noteToPlay =
                  seqModeRef.current === "melodic"
                    ? (seqPitchesRef.current[step] || settingsRef.current.baseRootMidi) + transpose + arpA
                    : heldMidi + arpA;
                triggerVoice(noteToPlay, subDuration, timeA, velA, panA);
              });
            } else {
              const noteToPlay =
                seqModeRef.current === "melodic"
                  ? (seqPitchesRef.current[step] || settingsRef.current.baseRootMidi) + arpA
                  : settingsRef.current.baseRootMidi + arpA;
              triggerVoice(noteToPlay, subDuration, timeA, velA, panA);
            }
          }

          // Sub-step 2 (second half)
          if (seqSubStepsRef.current[step]) {
            const rawVelB = seqSubVelocitiesRef.current[step];
            const velB = rawVelB !== undefined && rawVelB > 0 ? rawVelB : 100;
            const arpB = seqSubArpOffsetsRef.current[step] || 0;
            const panB = seqSubPansRef.current[step] || 0;
            const timeB = schedTime + subDuration;

            if (heldKeysRef.current.size > 0) {
              heldKeysRef.current.forEach((heldMidi) => {
                const transpose = heldMidi - settingsRef.current.baseRootMidi;
                const noteToPlay =
                  seqModeRef.current === "melodic"
                    ? (seqPitchesRef.current[step] || settingsRef.current.baseRootMidi) + transpose + arpB
                    : heldMidi + arpB;
                triggerVoice(noteToPlay, subDuration, timeB, velB, panB);
              });
            } else {
              const noteToPlay =
                seqModeRef.current === "melodic"
                  ? (seqPitchesRef.current[step] || settingsRef.current.baseRootMidi) + arpB
                  : settingsRef.current.baseRootMidi + arpB;
              triggerVoice(noteToPlay, subDuration, timeB, velB, panB);
            }
          }
        } else {
          // Normal Step (Unsplit)
          const isStepEnabled = seqStepsRef.current[step];
          if (isStepEnabled) {
            const rawVel = seqVelocitiesRef.current[step];
            const stepVel = rawVel !== undefined && rawVel > 0 ? rawVel : 100;
            const stepPan = seqPansRef.current[step] !== undefined ? seqPansRef.current[step] : 0;
            const stepArpOffset = seqArpOffsetsRef.current[step] !== undefined ? seqArpOffsetsRef.current[step] : 0;

            if (heldKeysRef.current.size > 0) {
              heldKeysRef.current.forEach((heldMidi) => {
                const transpose = heldMidi - settingsRef.current.baseRootMidi;
                const noteToPlay =
                  seqModeRef.current === "melodic"
                    ? (seqPitchesRef.current[step] || settingsRef.current.baseRootMidi) + transpose + stepArpOffset
                    : heldMidi + stepArpOffset;
                triggerVoice(noteToPlay, stepDuration, schedTime, stepVel, stepPan);
              });
            } else {
              const noteToPlay =
                seqModeRef.current === "melodic"
                  ? (seqPitchesRef.current[step] || settingsRef.current.baseRootMidi) + stepArpOffset
                  : settingsRef.current.baseRootMidi + stepArpOffset;
              triggerVoice(noteToPlay, stepDuration, schedTime, stepVel, stepPan);
            }
          }
        }

        // Synchronize visual playhead to step and sub-step
        setCurrentSeqStep(step);
        setCurrentSeqSubStep(0);
        if (isSplit) {
          const delayMs = (stepDuration / 2) * 1000;
          setTimeout(() => {
            setCurrentSeqSubStep(1);
          }, Math.max(10, delayMs));
        }

        currentStepIdxRef.current = (step + 1) % stepsCount;
        nextStepTimeRef.current += stepDuration;
      }
    }, 20);

    seqTimerIdRef.current = interval as unknown as number;
    return () => {
      clearInterval(interval);
    };
  }, [isSeqPlaying, getOrCreateAudioCtx, triggerVoice]);

  // Real-time Arpeggiator Clock Engine (runs for One-Shot mode)
  const arpTimerRef = useRef<number | null>(null);
  const arpStepIdxRef = useRef<number>(0);
  const arpNextTimeRef = useRef<number>(0);
  const arpRateRef = useRef<string>(arpRate);
  arpRateRef.current = arpRate;
  const arpPatternRef = useRef<string>(arpPattern);
  arpPatternRef.current = arpPattern;
  const arpOctavesRef = useRef<number>(arpOctaves);
  arpOctavesRef.current = arpOctaves;
  const arpGateRef = useRef<number>(arpGate);
  arpGateRef.current = arpGate;

  useEffect(() => {
    const isArpActive =
      (masterTab === "arpeggiator" || arpeggiatorEnabledRef.current) &&
      settings.playbackMode === "oneshot";

    if (!isArpActive || heldKeysCount === 0) {
      if (arpTimerRef.current) {
        clearInterval(arpTimerRef.current);
        arpTimerRef.current = null;
      }
      setIsArpPlaying(false);
      arpStepIdxRef.current = 0;
      return;
    }

    const ctx = getOrCreateAudioCtx();
    setIsArpPlaying(true);
    arpNextTimeRef.current = ctx.currentTime;

    const interval = setInterval(() => {
      if (heldKeysRef.current.size === 0) {
        setIsArpPlaying(false);
        return;
      }

      const bpm = settingsRef.current.hostBpm || 120;
      let beatsPerStep = 0.25;
      if (arpRateRef.current === "1/4") beatsPerStep = 1.0;
      else if (arpRateRef.current === "1/8") beatsPerStep = 0.5;
      else if (arpRateRef.current === "1/16") beatsPerStep = 0.25;
      else if (arpRateRef.current === "1/32") beatsPerStep = 0.125;

      const stepDuration = ((60 / bpm) * beatsPerStep) / (arpPlayrateRef.current || 1);
      const gateDuration = stepDuration * (arpGateRef.current || 0.8);

      const baseNotes = Array.from(heldKeysRef.current).sort((a, b) => a - b);
      if (baseNotes.length === 0) return;

      const allNotes: number[] = [];
      const octs = arpOctavesRef.current || 1;
      for (let oct = 0; oct < octs; oct++) {
        for (const n of baseNotes) {
          allNotes.push(n + oct * 12);
        }
      }

      let patternNotes = [...allNotes];
      if (arpPatternRef.current === "down") {
        patternNotes.reverse();
      } else if (arpPatternRef.current === "upDown") {
        const copy = [...allNotes];
        const downPart = allNotes.slice(1, -1).reverse();
        patternNotes = [...copy, ...downPart];
      }

      while (arpNextTimeRef.current < ctx.currentTime + 0.08) {
        const schedTime = Math.max(ctx.currentTime, arpNextTimeRef.current);

        if (arpPatternRef.current === "chord") {
          patternNotes.forEach((note) => {
            triggerVoice(note, gateDuration, schedTime, 105);
          });
        } else if (arpPatternRef.current === "random") {
          const randNote = patternNotes[Math.floor(Math.random() * patternNotes.length)];
          triggerVoice(randNote, gateDuration, schedTime, 105);
        } else {
          const note = patternNotes[arpStepIdxRef.current % patternNotes.length];
          triggerVoice(note, gateDuration, schedTime, 105);
        }

        arpStepIdxRef.current = (arpStepIdxRef.current + 1) % patternNotes.length;
        arpNextTimeRef.current += stepDuration;
      }
    }, 20);

    arpTimerRef.current = interval as unknown as number;
    return () => clearInterval(interval);
  }, [
    masterTab,
    arpeggiatorEnabled,
    settings.playbackMode,
    heldKeysCount,
    getOrCreateAudioCtx,
    triggerVoice,
  ]);

  // Draw Waveform, Markers, and Animated Real-Time Playheads
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, "#09090b");
      bgGrad.addColorStop(1, "#040405");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Center line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const currentBuffer = bufferRef.current;
      const currentSettings = settingsRef.current;

      if (!currentBuffer) {
        animId = requestAnimationFrame(render);
        return;
      }

      const duration = currentBuffer.duration;
      const leftData = currentBuffer.getChannelData(0);
      const step = Math.ceil(leftData.length / width);
      const amp = height / 2;
      const currentScale = waveformScaleRef.current;

      // Draw Waveform in sleek neutral muted grey with scaling
      ctx.fillStyle = "#52525b";
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
          const val = leftData[x * step + j] || 0;
          if (val < min) min = val;
          if (val > max) max = val;
        }
        const scaledMin = Math.max(-1, Math.min(1, min * currentScale));
        const scaledMax = Math.max(-1, Math.min(1, max * currentScale));
        const yMin = (1 + scaledMin) * amp;
        const yMax = (1 + scaledMax) * amp;
        ctx.fillRect(x, yMin, 1, Math.max(1, yMax - yMin));
      }

      // Helper to convert seconds to Canvas X
      const secToX = (sec: number) => (Math.max(0, Math.min(sec, duration)) / duration) * width;

      // Highlight Active Loop Region
      if (currentSettings.loopEnabled) {
        const lx1 = secToX(currentSettings.loopStartSec);
        const lx2 = secToX(currentSettings.loopEndSec);
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(lx1, 0, lx2 - lx1, height);

        // Pre Loop Crossfade Region
        if (currentSettings.loopCrossfadeSec > 0) {
          const xfWidth = (currentSettings.loopCrossfadeSec / duration) * width;
          const preXf1 = Math.max(0, lx1 - xfWidth);
          ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
          ctx.fillRect(preXf1, 0, lx1 - preXf1, height);
        }
      }

      // Non-active start/end darkened overlay
      const startX = secToX(currentSettings.startSec);
      const endX = secToX(currentSettings.endSec);
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, startX, height);
      ctx.fillRect(endX, 0, width - endX, height);

      // Marker drawing helper
      const drawMarker = (
        sec: number,
        color: string,
        label: string,
        topAlign: boolean = true
      ) => {
        const x = secToX(sec);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Flag / Handle
        ctx.fillStyle = color;
        const badgeY = topAlign ? 16 : height - 16;
        ctx.beginPath();
        ctx.roundRect(x - 22, badgeY - 10, 44, 20, 3);
        ctx.fill();

        ctx.fillStyle = "#09090b";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, badgeY);
      };

      // Draw Minimal Markers
      drawMarker(currentSettings.startSec, "#e4e4e7", "START", true);
      drawMarker(currentSettings.endSec, "#71717a", "END", true);

      if (currentSettings.loopEnabled) {
        drawMarker(currentSettings.loopStartSec, "#d4d4d8", "LOOP S", false);
        drawMarker(currentSettings.loopEndSec, "#d4d4d8", "LOOP E", false);
      }

      if (currentSettings.releaseTriggerEnabled) {
        drawMarker(
          currentSettings.releaseTriggerSec,
          "#a1a1aa",
          releaseSampleBufferRef.current ? "REL FILE" : "REL TRG",
          true
        );
      }

      // Draw Real-Time Animated Playheads for all active voices
      if (audioCtx && activeVoicesRef.current.size > 0) {
        const now = audioCtx.currentTime;

        activeVoicesRef.current.forEach((voice) => {
          const elapsedSec = (now - voice.startTime) * voice.speedFactor;
          let currentPosSec = voice.startSec + elapsedSec;

          if (voice.loopEnabled) {
            const loopLen = voice.loopEndSec - voice.loopStartSec;
            if (loopLen > 0 && currentPosSec >= voice.loopStartSec) {
              const loopOffset = (currentPosSec - voice.loopStartSec) % loopLen;
              currentPosSec = voice.loopStartSec + loopOffset;
            }
          } else {
            // Strictly clamp playhead to endSec
            if (currentPosSec >= voice.endSec) {
              currentPosSec = voice.endSec;
            }
          }

          currentPosSec = Math.max(0, Math.min(currentPosSec, duration));
          const playheadX = secToX(currentPosSec);

          ctx.save();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(playheadX, 0);
          ctx.lineTo(playheadX, height);
          ctx.stroke();

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(playheadX, 8, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      // Draw Animated Playheads for active Release Triggers
      if (audioCtx && releaseVoicesRef.current.length > 0) {
        const now = audioCtx.currentTime;
        releaseVoicesRef.current = releaseVoicesRef.current.filter((rv) => {
          const elapsed = now - rv.startTime;
          if (elapsed > rv.duration) return false;
          const currentPosSec = Math.max(0, Math.min(rv.startSec + elapsed, duration));
          const playheadX = secToX(currentPosSec);

          ctx.save();
          ctx.strokeStyle = "#a1a1aa";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(playheadX, 0);
          ctx.lineTo(playheadX, height);
          ctx.stroke();

          ctx.fillStyle = "#a1a1aa";
          ctx.beginPath();
          ctx.arc(playheadX, height - 8, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return true;
        });
      }

      // Render Dedicated Release Trigger Mini Visualizer
      const relCanvas = releaseCanvasRef.current;
      if (relCanvas) {
        const rCtx = relCanvas.getContext("2d");
        if (rCtx) {
          const rW = relCanvas.width;
          const rH = relCanvas.height;
          rCtx.clearRect(0, 0, rW, rH);
          const rGrad = rCtx.createLinearGradient(0, 0, 0, rH);
          rGrad.addColorStop(0, "#09090b");
          rGrad.addColorStop(1, "#040405");
          rCtx.fillStyle = rGrad;
          rCtx.fillRect(0, 0, rW, rH);
          rCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          rCtx.beginPath();
          rCtx.moveTo(0, rH / 2);
          rCtx.lineTo(rW, rH / 2);
          rCtx.stroke();

          const customBuf = releaseSampleBufferRef.current;
          const activeBuf = customBuf || currentBuffer;

          if (activeBuf) {
            const data = activeBuf.getChannelData(0);
            const totalLen = data.length;
            const rAmp = rH * 0.38;

            let startSample = 0;
            let endSample = totalLen;

            if (!customBuf && currentBuffer) {
              const trigFrac = Math.max(0, Math.min(1, currentSettings.releaseTriggerSec / currentBuffer.duration));
              const endFrac = Math.max(trigFrac + 0.01, Math.min(1, currentSettings.endSec / currentBuffer.duration));
              startSample = Math.floor(trigFrac * totalLen);
              endSample = Math.floor(endFrac * totalLen);
            } else if (customBuf && currentSettings.releaseTriggerSec > 0) {
              const offFrac = Math.max(0, Math.min(1, currentSettings.releaseTriggerSec / customBuf.duration));
              startSample = Math.floor(offFrac * totalLen);
            }

            const sliceLen = Math.max(16, endSample - startSample);
            const rStep = Math.ceil(sliceLen / rW);

            rCtx.fillStyle = currentSettings.releaseTriggerEnabled ? "#52525b" : "#27272a";

            for (let x = 0; x < rW; x++) {
              let min = 1.0;
              let max = -1.0;
              for (let j = 0; j < rStep; j++) {
                const sIdx = startSample + x * rStep + j;
                const v = sIdx < endSample ? data[sIdx] || 0 : 0;
                if (v < min) min = v;
                if (v > max) max = v;
              }
              const yMin = rH / 2 + min * rAmp;
              const yMax = rH / 2 + max * rAmp;
              rCtx.fillRect(x, yMin, 1, Math.max(1, yMax - yMin));
            }

            if (audioCtx && releaseVoicesRef.current.length > 0) {
              const now = audioCtx.currentTime;
              for (const rv of releaseVoicesRef.current) {
                const elapsed = now - rv.startTime;
                if (elapsed >= 0 && elapsed <= rv.duration) {
                  const playRatio = Math.max(0, Math.min(1, elapsed / rv.duration));
                  const playX = playRatio * rW;

                  rCtx.save();
                  rCtx.strokeStyle = "#ffffff";
                  rCtx.lineWidth = 2;
                  rCtx.beginPath();
                  rCtx.moveTo(playX, 0);
                  rCtx.lineTo(playX, rH);
                  rCtx.stroke();

                  rCtx.fillStyle = "#ffffff";
                  rCtx.beginPath();
                  rCtx.arc(playX, rH / 2, 2.5, 0, Math.PI * 2);
                  rCtx.fill();
                  rCtx.restore();
                }
              }
            }
          }
        }
      }

      // Render Master Output LED Meter
      const meterCanvas = meterCanvasRef.current;
      if (meterCanvas) {
        const mCtx = meterCanvas.getContext("2d");
        if (mCtx) {
          const mW = meterCanvas.width;
          const mH = meterCanvas.height;
          mCtx.clearRect(0, 0, mW, mH);
          mCtx.fillStyle = "#09090b";
          mCtx.fillRect(0, 0, mW, mH);

          let currentPeak = 0;
          if (masterAnalyserRef.current) {
            masterAnalyserRef.current.getByteTimeDomainData(analyserDataRef.current as any);
            const data = analyserDataRef.current;
            for (let i = 0; i < data.length; i++) {
              const val = Math.abs((data[i] - 128) / 128);
              if (val > currentPeak) currentPeak = val;
            }
          }

          const prevSmoothed = smoothedPeakRef.current;
          let newSmoothed = currentPeak > prevSmoothed ? currentPeak : prevSmoothed * 0.88;
          if (newSmoothed < 0.001) newSmoothed = 0;
          smoothedPeakRef.current = newSmoothed;

          const numSegments = 12;
          const segGap = 1.5;
          const segH = (mH - (numSegments - 1) * segGap - 2) / numSegments;
          const barW = (mW - 5) / 2;

          const normPeak = Math.min(1, newSmoothed * 1.15);
          const activeSegments = Math.round(normPeak * numSegments);

          for (let s = 0; s < numSegments; s++) {
            const segIndex = s;
            const y = mH - 1 - (s + 1) * segH - s * segGap;
            const isLit = segIndex < activeSegments;

            let litColor = "#22c55e"; // green
            let dimColor = "rgba(34, 197, 94, 0.12)";
            if (segIndex >= numSegments - 2) {
              litColor = "#ef4444"; // red clip
              dimColor = "rgba(239, 68, 68, 0.12)";
            } else if (segIndex >= numSegments - 5) {
              litColor = "#eab308"; // yellow
              dimColor = "rgba(234, 179, 8, 0.12)";
            }

            mCtx.fillStyle = isLit ? litColor : dimColor;
            mCtx.fillRect(1.5, y, barW, segH);

            const isRightLit =
              isLit && (segIndex === activeSegments - 1 ? s % 2 === 0 || normPeak > 0.9 : true);
            mCtx.fillStyle = isRightLit ? litColor : dimColor;
            mCtx.fillRect(1.5 + barW + 2, y, barW, segH);
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [audioCtx]);

  // Pointer interactions on Waveform canvas for dragging markers
  const handleCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sampleBuffer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clientX / rect.width));
    const gridStep = sampleBuffer.duration / 16;
    let targetSec = ratio * sampleBuffer.duration;
    if (snapToGridRef.current) {
      targetSec = Math.round(targetSec / gridStep) * gridStep;
    }

    if (e.type === "pointerdown") {
      canvas.setPointerCapture(e.pointerId);

      // Determine closest marker
      const markers = [
        { id: "startSec", sec: settings.startSec },
        { id: "endSec", sec: settings.endSec },
        ...(settings.loopEnabled
          ? [
              { id: "loopStartSec", sec: settings.loopStartSec },
              { id: "loopEndSec", sec: settings.loopEndSec },
            ]
          : []),
        ...(settings.releaseTriggerEnabled
          ? [{ id: "releaseTriggerSec", sec: settings.releaseTriggerSec }]
          : []),
      ];

      let closest = markers[0];
      let minDiff = Math.abs(closest.sec - targetSec);
      for (const m of markers) {
        const diff = Math.abs(m.sec - targetSec);
        if (diff < minDiff) {
          minDiff = diff;
          closest = m;
        }
      }

      setActiveMarker(closest.id);
    } else if (e.type === "pointermove" && activeMarker) {
      setSettings((prev) => {
        const next = { ...prev };
        const gap = snapToGridRef.current ? gridStep : 0.01;
        if (activeMarker === "startSec") {
          next.startSec = Math.max(0, Math.min(targetSec, next.endSec - gap));
        } else if (activeMarker === "endSec") {
          const newEnd = Math.min(sampleBuffer.duration, Math.max(targetSec, next.startSec + gap));
          next.endSec = newEnd;
          if (isEndLinkedRef.current) {
            next.loopEndSec = Math.max(next.loopStartSec + gap, newEnd);
          }
        } else if (activeMarker === "loopStartSec") {
          next.loopStartSec = Math.max(0, Math.min(targetSec, next.loopEndSec - gap));
        } else if (activeMarker === "loopEndSec") {
          const newLoopEnd = Math.min(sampleBuffer.duration, Math.max(targetSec, next.loopStartSec + gap));
          next.loopEndSec = newLoopEnd;
          if (isEndLinkedRef.current) {
            next.endSec = Math.max(next.startSec + gap, newLoopEnd);
          }
        } else if (activeMarker === "releaseTriggerSec") {
          next.releaseTriggerSec = Math.max(0, Math.min(targetSec, sampleBuffer.duration));
        }
        return next;
      });
    } else if (e.type === "pointerup") {
      canvas.releasePointerCapture(e.pointerId);
      setActiveMarker(null);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-zinc-950 p-4 md:p-8 font-sans text-zinc-100 select-none">
      {/* Sampler Rack Chassis */}
      <div className="w-full max-w-5xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Top Header Bar with Centered Preset Strip */}
        <div className="px-6 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between gap-4 min-h-[64px]">
          {/* Obsidian Player Branding (Left) */}
          <div className="flex items-center justify-start shrink-0 gap-2">
            <img
              src="https://storage.googleapis.com/producer-app-public/producer/conversation/images/81be9ca7-ae20-4198-bed2-b755b0b14523/6f36c50a-b3db-42ba-ab69-77625dd09e57"
              alt="Obsidian Player"
              className="h-8 md:h-10 w-auto object-contain mix-blend-screen select-none pointer-events-none"
            />
          </div>

          {/* Alloy Channel Full Preset Navigator & A/B System - Centered at Top */}
          <div className="relative flex items-center gap-2">
            <button
              onClick={() => {
                const idx = presets.findIndex((p) => p.id === activePresetId);
                const prevIdx = (idx - 1 + presets.length) % presets.length;
                const p = presets[prevIdx];
                if (p) {
                  setActivePresetId(p.id);
                  setSettings(p.settings);
                }
              }}
              title="Previous Preset"
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* Current Preset Selector Pill */}
            <div className="relative">
              <button
                onClick={() => setIsPresetMenuOpen((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-1 rounded bg-zinc-800/90 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 text-xs font-medium transition min-w-[170px] justify-between"
              >
                <span className="truncate">
                  {presets.find((p) => p.id === activePresetId)?.name ?? (presets.length > 0 ? "Select Preset" : "No Presets")}
                </span>
                <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
              </button>

              {/* Dropdown Menu */}
              {isPresetMenuOpen && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-2">
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search presets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none"
                    />
                  </div>

                  {/* Preset Items List */}
                  <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5">
                    {presets.length === 0 ? (
                      <div className="py-4 text-center text-xs text-zinc-500">
                        No presets saved yet.
                      </div>
                    ) : (
                      presets
                        .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map((p) => (
                          <div
                            key={p.id}
                            className={`w-full px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition cursor-pointer ${
                              p.id === activePresetId
                                ? "bg-zinc-800 text-white font-medium"
                                : "text-zinc-300 hover:bg-zinc-800/60"
                            }`}
                            onClick={() => {
                              setActivePresetId(p.id);
                              setSettings(p.settings);
                              setIsPresetMenuOpen(false);
                            }}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPresets((prev) =>
                                    prev.map((item) =>
                                      item.id === p.id
                                        ? { ...item, isFavorite: !item.isFavorite }
                                        : item
                                    )
                                  );
                                }}
                                className="text-zinc-500 hover:text-yellow-400"
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    p.isFavorite ? "fill-yellow-400 text-yellow-400" : ""
                                  }`}
                                />
                              </button>
                              <span className="truncate">{p.name}</span>
                            </div>
                          </div>
                        ))
                    )}
                  </div>

                  {/* Footer Actions */}
                  <div className="border-t border-zinc-800 pt-2 flex items-center justify-between">
                    <button
                      onClick={() => {
                        setIsPresetMenuOpen(false);
                        setIsSavingPreset(true);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Save New Preset</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              disabled={presets.length === 0}
              onClick={() => {
                if (presets.length === 0) return;
                const idx = presets.findIndex((p) => p.id === activePresetId);
                const nextIdx = (idx + 1) % presets.length;
                const p = presets[nextIdx];
                if (p) {
                  setActivePresetId(p.id);
                  setSettings(p.settings);
                }
              }}
              title="Next Preset"
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition disabled:opacity-40"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Master Output Section (Right) - Top-aligned and matched height from top to bottom */}
          <div className="flex items-start gap-3 pt-1">
            {/* Stereo VU Meter */}
            <div className="flex flex-col items-center justify-between h-16 shrink-0 py-0.5">
              <canvas
                ref={meterCanvasRef}
                width={16}
                height={46}
                className="rounded bg-zinc-950 border border-zinc-800 shadow-inner"
                title="Master Stereo VU Meter"
              />
              <span className="text-[8px] font-mono text-zinc-500 font-bold tracking-tighter">
                METER
              </span>
            </div>

            {/* Master Output Knob */}
            <div className="h-16 flex items-start shrink-0 scale-90 origin-top">
              <Knob
                label="Master"
                value={settings.gain}
                min={0.0}
                max={2.0}
                step={0.01}
                displayValue={`${Math.round(settings.gain * 100)}%`}
                onChange={(val) => {
                  setSettings((p) => ({ ...p, gain: val }));
                  if (masterGainNodeRef.current && audioCtx) {
                    masterGainNodeRef.current.gain.setTargetAtTime(val, audioCtx.currentTime, 0.01);
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Main Master Navigation Bar on the Divider Line */}
        <MasterTabBar
          masterTab={masterTab}
          setMasterTab={setMasterTab}
          playbackMode={settings.playbackMode}
          hasSample={!!sampleBuffer}
          filtersActive={settings.lpfEnabled || settings.hpfEnabled}
          onToggleFilters={() => {
            setSettings((p) => {
              const currentlyActive = p.lpfEnabled || p.hpfEnabled;
              if (currentlyActive) {
                return { ...p, lpfEnabled: false, hpfEnabled: false };
              } else {
                return { ...p, lpfEnabled: true };
              }
            });
          }}
          sequencerEnabled={sequencerEnabled}
          setSequencerEnabled={setSequencerEnabled}
          arpeggiatorEnabled={arpeggiatorEnabled}
          setArpeggiatorEnabled={setArpeggiatorEnabled}
          onDisableSequencer={() => {
            isManualPlayRunningRef.current = false;
            setIsSeqPlaying(false);
            isSeqPlayingRef.current = false;
            activeVoicesRef.current.forEach((voice) => voice.stop(true));
            activeVoicesRef.current.clear();
            setActiveMidiNotes(new Set());
            setCurrentSeqStep(0);
            currentStepIdxRef.current = 0;
          }}
        />
        {false && (
        <div className="w-full bg-zinc-950/90 border-b border-zinc-800 px-6 py-2.5 flex items-center justify-center">
          <div className="flex items-center gap-2 p-1 bg-zinc-900/90 rounded-xl border border-zinc-800 shadow-sm">
            <button
              onClick={() => setMasterTab("playback")}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                masterTab === "playback"
                  ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              PLAYBACK
            </button>
            <button
              onClick={() => setMasterTab("envelopes")}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                masterTab === "envelopes"
                  ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ENVELOPES
            </button>
            <div
              className={`flex items-center rounded-lg transition border ${
                masterTab === "sequencer"
                  ? "bg-zinc-800 text-white border-zinc-700 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-850"
              }`}
            >
              <button
                onClick={() => setMasterTab("sequencer")}
                className="pl-3.5 pr-1.5 py-2 text-xs font-bold uppercase tracking-wider"
              >
                SEQUENCER
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSequencerEnabled((prev) => {
                    const next = !prev;
                    if (!next) {
                      setIsSeqPlaying(false);
                      releaseAllVoices();
                    }
                    return next;
                  });
                }}
                title={sequencerEnabled ? "Disable Sequencer" : "Enable Sequencer"}
                className="pr-2.5 pl-1 py-2 flex items-center justify-center"
              >
                <span
                  className={`w-2 h-2 rounded-full transition-all ${
                    sequencerEnabled ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-zinc-600"
                  }`}
                />
              </button>
            </div>
            <button
              onClick={() => setMasterTab("arpeggiator")}
              className={`px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                masterTab === "arpeggiator"
                  ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ARPEGGIATOR
            </button>
            <button
              onClick={() => setMasterTab("envelopes")}
              className={`px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                masterTab === "envelopes"
                  ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ENVELOPES
            </button>
          </div>
        </div>
        )}

        {/* Modal: Save New Preset */}
        {isSavingPreset && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl p-5 shadow-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-zinc-100">Save Custom Preset</span>
                <button
                  onClick={() => setIsSavingPreset(false)}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-zinc-400">Preset Name</label>
                <input
                  type="text"
                  placeholder="My New Preset"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsSavingPreset(false)}
                  className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newPresetName.trim()) {
                      const newP: Preset = {
                        id: `user-${Date.now()}`,
                        name: newPresetName.trim(),
                        settings: { ...settings },
                      };
                      setPresets((prev) => [...prev, newP]);
                      setActivePresetId(newP.id);
                      setNewPresetName("");
                      setIsSavingPreset(false);
                    }
                  }}
                  className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white font-medium text-xs transition"
                >
                  Save Preset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unified Fixed-Height Master Workspace (Identical Dimensions Across All Tabs) */}
        <div className="w-full h-[465px] overflow-hidden flex flex-col">
          {/* 1. PLAYBACK MASTER TAB (Only tab with Waveform Visualizer) */}
          {masterTab === "playback" && (
            <div className="w-full h-full px-6 pt-3.5 pb-3.5 flex flex-col justify-between">
              {/* Header Bar Above Visualizer: Sample Details (Left) | 3 Section Buttons (Center) | Zoom (Right) */}
              <div className="flex items-center justify-between gap-3 text-xs">
                {/* Left: Source file name & integrated sample loader with info popover */}
                <div className="relative flex-1 flex justify-start items-center" ref={infoMenuRef}>
                  {sampleBuffer ? (
                    <>
                      <button
                        onClick={() => setIsInfoOpen((prev) => !prev)}
                        title="Click for sample details and options"
                        className="flex items-center gap-1.5 px-2.5 py-1 -ml-2 rounded-md hover:bg-zinc-800/80 text-zinc-200 hover:text-white font-semibold text-xs transition cursor-pointer"
                      >
                        <span className="truncate max-w-[200px]">{sampleName}</span>
                        <ChevronDown className="w-3 h-3 text-zinc-500" />
                      </button>

                      {/* Sample Details Popover with Load / Eject options */}
                      {isInfoOpen && (
                        <div className="absolute left-0 top-full mt-1.5 z-40 bg-zinc-900 border border-zinc-700 rounded-xl p-3.5 shadow-2xl flex flex-col gap-2.5 w-64 backdrop-blur-md">
                          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-200">
                              Sample Details
                            </span>
                            <button
                              onClick={() => setIsInfoOpen(false)}
                              className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded hover:bg-zinc-800 transition"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex flex-col gap-1.5 text-[11px]">
                            <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/50">
                              <span className="text-zinc-400">File Name</span>
                              <span
                                className="font-medium text-zinc-200 truncate max-w-[130px]"
                                title={sampleName}
                              >
                                {sampleName}
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/50">
                              <span className="text-zinc-400">Duration</span>
                              <span className="font-mono text-zinc-200">
                                {sampleBuffer.duration.toFixed(3)}s
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/50">
                              <span className="text-zinc-400">Sample Rate</span>
                              <span className="font-mono text-zinc-200">
                                {(sampleBuffer.sampleRate / 1000).toFixed(1)} kHz (
                                {sampleBuffer.sampleRate.toLocaleString()} Hz)
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/50">
                              <span className="text-zinc-400">Channels</span>
                              <span className="font-medium text-zinc-200">
                                {sampleBuffer.numberOfChannels === 2 ? "Stereo (2-ch)" : "Mono (1-ch)"}
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/50">
                              <span className="text-zinc-400">Total Frames</span>
                              <span className="font-mono text-zinc-200">
                                {sampleBuffer.length.toLocaleString()}
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/50">
                              <span className="text-zinc-400">Root Note</span>
                              <span className="font-mono text-zinc-200 font-bold">
                                {midiToNoteName(settings.baseRootMidi)} (MIDI {settings.baseRootMidi})
                              </span>
                            </div>

                            <div className="flex justify-between items-center py-0.5">
                              <span className="text-zinc-400">Active Region</span>
                              <span className="font-mono text-zinc-200">
                                {settings.startSec.toFixed(2)}s – {settings.endSec.toFixed(2)}s
                              </span>
                            </div>
                          </div>

                          {/* Integrated Load Other Sample & Eject Options */}
                          <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-2">
                            <label className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium cursor-pointer transition">
                              <Upload className="w-3.5 h-3.5 text-zinc-300" />
                              <span>Load Other Sample</span>
                              <input
                                type="file"
                                accept="audio/*"
                                onChange={(e) => {
                                  handleFileUpload(e);
                                  setIsInfoOpen(false);
                                }}
                                className="hidden"
                              />
                            </label>
                            <button
                              onClick={() => {
                                releaseAllVoices();
                                setSampleBuffer(null);
                                setSampleName("No Sample Loaded");
                                setWaveformScale(1.0);
                                setIsInfoOpen(false);
                              }}
                              title="Eject / Clear Sample"
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-red-400 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>

                {/* Center: Playback Sub-tabs (SAMPLE & LOOP / TEMPO SYNC) */}
                {/* Playback Mode Selector, Preserve Speed, & DAW Sync */}
                {sampleBuffer && (
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1">
                    {/* Mode Selector: ONE SHOT vs LOOP */}
                    <div className="flex items-center bg-zinc-950 border border-zinc-750 rounded-lg p-0.5">
                      <button
                        onClick={() =>
                          setSettings((p) => ({ ...p, playbackMode: "oneshot", loopEnabled: false }))
                        }
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition ${
                          settings.playbackMode === "oneshot"
                            ? "bg-zinc-750 text-white shadow-sm border border-zinc-500"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        One Shot
                      </button>
                      <button
                        onClick={() =>
                          setSettings((p) => ({ ...p, playbackMode: "loop", loopEnabled: true }))
                        }
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition flex items-center gap-1 ${
                          settings.playbackMode === "loop"
                            ? "bg-zinc-750 text-white shadow-sm border border-zinc-500"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            settings.playbackMode === "loop"
                              ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                              : "bg-zinc-600"
                          }`}
                        />
                        <span>Loop</span>
                      </button>
                    </div>

                    {/* Preserve Speed Toggle */}
                    <button
                      onClick={() =>
                        setSettings((p) => ({ ...p, preserveSpeed: !p.preserveSpeed }))
                      }
                      title="Keep sample playback speed/tempo constant across all keys"
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition ${
                        settings.preserveSpeed
                          ? "bg-zinc-800 text-white border-zinc-600 shadow-sm"
                          : "bg-zinc-950 text-zinc-400 hover:text-zinc-200 border-zinc-800"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-all ${
                          settings.preserveSpeed
                            ? "bg-zinc-200 shadow-sm"
                            : "bg-zinc-700"
                        }`}
                      />
                      <span>Preserve Speed</span>
                    </button>

                    {/* Sync DAW Toggle with DAW BPM input */}
                    <div className="flex items-center gap-1 pl-2 border-l border-zinc-800">
                      <button
                        onClick={() =>
                          setSettings((p) => ({ ...p, tempoSyncEnabled: !p.tempoSyncEnabled }))
                        }
                        title="Adjust sample playback speed to match host DAW tempo"
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition ${
                          settings.tempoSyncEnabled
                            ? "bg-zinc-800 text-white border-zinc-600 shadow-sm"
                            : "bg-zinc-950 text-zinc-400 hover:text-zinc-200 border-zinc-800"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full transition-all ${
                            settings.tempoSyncEnabled
                              ? "bg-zinc-200 shadow-sm"
                              : "bg-zinc-700"
                          }`}
                        />
                        <span>Sync DAW</span>
                      </button>

                      <span className="font-mono text-zinc-100 font-bold text-xs flex items-center gap-1">
                        <input
                          type="number"
                          min={40}
                          max={260}
                          value={settings.hostBpm}
                          onChange={(e) =>
                            setSettings((p) => ({
                              ...p,
                              hostBpm: parseInt(e.target.value) || 120,
                            }))
                          }
                          className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-xs font-mono font-bold text-zinc-100 text-center outline-none"
                        />
                        <span className="text-[10px] text-zinc-500 font-normal">BPM</span>
                      </span>
                    </div>

                    {/* Root Note Selector (Transposition Pivot) */}
                    <div className="flex items-center gap-1.5 pl-2 border-l border-zinc-800">
                      <span className="text-[10px] uppercase font-bold text-zinc-500">Root:</span>
                      <select
                        value={settings.baseRootMidi}
                        onChange={(e) =>
                          setSettings((p) => ({
                            ...p,
                            baseRootMidi: parseInt(e.target.value, 10),
                          }))
                        }
                        className="bg-zinc-950 border border-zinc-750 hover:border-zinc-600 rounded px-2 py-0.5 text-xs font-mono font-bold text-zinc-100 outline-none cursor-pointer transition shadow-sm"
                        title="Root Note: The original pitch of the imported sample"
                      >
                        {Array.from({ length: 73 }).map((_, i) => {
                          const midi = 24 + i; // C1 to C7
                          const name = midiToNoteName(midi);
                          return (
                            <option key={midi} value={midi} className="bg-zinc-900 text-white">
                              {name} {midi === 60 ? "(C4)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                )}
                {false && sampleBuffer ? (
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                    <span className="font-mono text-zinc-100 font-bold text-xs">Detected: {settings.sampleBpm} BPM</span>
                    <span className="text-[10px] text-zinc-400 font-mono">• Loop: {settings.loopEndSec.toFixed(2)}s</span>
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                {false ? (
                  <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800 shadow-sm shrink-0">
                    <button
                      onClick={() => setPlaybackSubTab("sample")}
                      className={`px-3.5 py-1 rounded-lg text-xs font-semibold tracking-wider transition ${
                        playbackSubTab === "sample"
                          ? "bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      SAMPLE & LOOP
                    </button>
                    <button
                      onClick={() => setPlaybackSubTab("sync")}
                      className={`px-3.5 py-1 rounded-lg text-xs font-semibold tracking-wider transition ${
                        playbackSubTab === "sync"
                          ? "bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      TEMPO SYNC
                    </button>
                  </div>
                ) : (
                  <div className="flex-1" />
                )}

                {/* Right: Waveform Magnifying Glass Popover */}
                <div className="relative flex-1 flex items-center justify-end gap-1.5" ref={zoomMenuRef}>
                  <button
                    onClick={() => setSnapToGrid((s) => !s)}
                    className={`p-1.5 rounded-lg border text-xs transition ${
                      snapToGrid
                        ? "bg-zinc-800 text-emerald-400 border-zinc-600 shadow-sm"
                        : "bg-zinc-950/90 text-zinc-400 hover:text-zinc-200 border-zinc-800"
                    }`}
                    title="Snap to Grid"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 4h5v3.5H4Z" fill="#ffffff" stroke="#ffffff" />
                      <path d="M15 4h5v3.5h-5Z" fill="#ffffff" stroke="#ffffff" />
                      <path d="M4 7.5h5v4a3 3 0 0 0 6 0V7.5h5v4a8 8 0 0 1-16 0Z" />
                    </svg>
                  </button>
                  <button onClick={() => setShowWaveformGrid((g) => !g)} className={`p-1.5 rounded-lg border text-xs ${showWaveformGrid ? "bg-zinc-800 text-zinc-100 border-zinc-600 shadow-sm" : "bg-zinc-950/90 text-zinc-400 border-zinc-800 hover:text-zinc-200"}`} title="Toggle 4-Bar Grid">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                  </button>
                  <button
                    onClick={() => setIsZoomMenuOpen((prev) => !prev)}
                    title="Waveform Zoom & Scale"
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition text-xs ${
                      isZoomMenuOpen || waveformScale > 1.05
                        ? "bg-zinc-800 border-zinc-600 text-white shadow-sm"
                        : "bg-zinc-950/90 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <ZoomIn className="w-3.5 h-3.5 text-zinc-300" />
                    {waveformScale > 1.05 && (
                      <span className="text-[10px] font-mono font-bold text-zinc-300">
                        {waveformScale.toFixed(1)}x
                      </span>
                    )}
                  </button>

                  {/* Magnifying Glass Popover Panel */}
                  {isZoomMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-40 bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-2xl flex flex-col gap-2.5 w-64 backdrop-blur-md">
                      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                          <ZoomIn className="w-3.5 h-3.5 text-zinc-400" />
                          Waveform Zoom
                        </span>
                        <button
                          onClick={() => setIsZoomMenuOpen(false)}
                          className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded hover:bg-zinc-800 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Amplitude Scale Stepper & Slider */}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() =>
                            setWaveformScale((s) => Math.max(1, Number((s - 0.5).toFixed(1))))
                          }
                          disabled={waveformScale <= 1}
                          title="Decrease scale"
                          className="w-6 h-6 rounded flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        <span className="w-12 text-center font-mono font-bold text-xs text-white">
                          {waveformScale.toFixed(1)}x
                        </span>

                        <button
                          onClick={() =>
                            setWaveformScale((s) => Math.min(10, Number((s + 0.5).toFixed(1))))
                          }
                          disabled={waveformScale >= 10}
                          title="Increase scale"
                          className="w-6 h-6 rounded flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="0.1"
                          value={waveformScale}
                          onChange={(e) => setWaveformScale(parseFloat(e.target.value))}
                          className="flex-1 accent-zinc-200 h-1.5 bg-zinc-800 rounded cursor-pointer"
                        />
                      </div>

                      {/* Presets: 1x, 2x, 4x, Auto */}
                      <div className="flex items-center justify-between gap-1 pt-1 border-t border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                          Presets:
                        </span>
                        <div className="flex items-center gap-1.5">
                          {[1, 2, 4].map((s) => (
                            <button
                              key={s}
                              onClick={() => setWaveformScale(s)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition ${
                                Math.abs(waveformScale - s) < 0.05
                                  ? "bg-zinc-700 text-white font-bold"
                                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                              }`}
                            >
                              {s}x
                            </button>
                          ))}
                          <button
                            onClick={handleAutoScale}
                            title="Auto-scale waveform to fit visualizer height"
                            className="px-2 py-0.5 rounded text-[10px] font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition"
                          >
                            Auto
                          </button>
                        </div>
                      </div>

                      {/* Visualizer Height Expand / Compact Toggle */}
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                          Height:
                        </span>
                        <button
                          onClick={() => setIsExpandedView((prev) => !prev)}
                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium transition ${
                            isExpandedView
                              ? "bg-zinc-800 text-white font-semibold"
                              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                          }`}
                        >
                          <Maximize2 className="w-3 h-3" />
                          <span>{isExpandedView ? "Expanded (256px)" : "Standard (176px)"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Canvas Container */}
              <div
                className={`relative w-full rounded-xl overflow-hidden border border-zinc-800 shadow-inner transition-all duration-200 ${
                  !sampleBuffer ? "flex-1 min-h-[380px]" : isExpandedView ? "h-64" : "h-44"
                }`}
              >
                <canvas
                  ref={canvasRef}
                  width={960}
                  height={!sampleBuffer ? 380 : isExpandedView ? 256 : 176}
                  onPointerDown={handleCanvasPointer}
                  onPointerMove={handleCanvasPointer}
                  onPointerUp={handleCanvasPointer}
                  className="w-full h-full cursor-crosshair touch-none"
                />
                {showWaveformGrid && <WaveformGrid />}

                {/* Clickable load option in visualizer text space */}
                {!sampleBuffer && (
                  <label className="absolute inset-0 flex flex-col items-center justify-center gap-3 cursor-pointer text-zinc-400 hover:text-zinc-200 transition group select-none">
                    <Upload className="w-9 h-9 text-zinc-500 group-hover:text-zinc-300 group-hover:scale-110 transition-transform" />
                    <span className="text-base font-semibold text-zinc-200 group-hover:text-white">
                      No Sample Loaded
                    </span>
                    <span className="text-xs text-zinc-500 group-hover:text-zinc-400 font-normal">
                      Click or drop an audio file here to load
                    </span>
                    <span className="text-[10px] text-zinc-600 mt-1 font-mono">
                      Supports WAV, MP3, AIFF, OGG, FLAC
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* Central Master Module Viewport - ONLY shown when audio file is loaded */}
              {sampleBuffer && (
                <div className="px-6 pb-6 flex flex-col items-center">
                  <div className="w-full max-w-3xl h-[175px] bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 shadow-xl flex items-center justify-center">
                    <div className="w-full h-full flex items-center justify-center">
                      {settings.playbackMode === "oneshot" ? (
                      <div className="flex items-start justify-center h-full gap-8 pt-1">
                        {(() => {
                          const kStep = snapToGrid && sampleBuffer ? sampleBuffer.duration / 16 : 0.001;
                          return (
                            <>
                              {/* One Shot Boundaries */}
                              <div className="flex flex-col items-center gap-2.5">
                                <span className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase py-0.5">
                                  One Shot Region
                                </span>
                                <div className="flex items-center gap-4">
                                  <Knob
                                    label="Start"
                                    value={settings.startSec}
                                    min={0}
                                    max={sampleBuffer ? sampleBuffer.duration : 2}
                                    step={kStep}
                                    displayValue={`${settings.startSec.toFixed(2)}s`}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        startSec: Math.min(val, p.endSec - kStep),
                                      }))
                                    }
                                  />
                                  <Knob
                                    label="End"
                                    value={settings.endSec}
                                    min={kStep}
                                    max={sampleBuffer ? sampleBuffer.duration : 2}
                                    step={kStep}
                                    displayValue={`${settings.endSec.toFixed(2)}s`}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        endSec: Math.max(val, p.startSec + kStep),
                                      }))
                                    }
                                  />
                                  <Knob
                                    label="Root"
                                    value={settings.baseRootMidi}
                                    min={24}
                                    max={96}
                                    step={1}
                                    displayValue={midiToNoteName(settings.baseRootMidi)}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        baseRootMidi: Math.round(val),
                                      }))
                                    }
                                  />
                                </div>
                              </div>

                              <div className="w-[1px] h-24 bg-zinc-800/80 self-center" />

                              {/* Release Trigger Section with Right-Side Mini Visualizer */}
                              <div className="flex items-center gap-5 md:gap-6 pl-1.5">
                                {/* Left Controls: Button and Knobs */}
                                <div className="flex flex-col items-center gap-2 shrink-0">
                                  <button
                                    onClick={() =>
                                      setSettings((prev) => ({
                                        ...prev,
                                        releaseTriggerEnabled: !prev.releaseTriggerEnabled,
                                      }))
                                    }
                                    className={`flex items-center gap-1.5 px-3 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border transition ${
                                      settings.releaseTriggerEnabled
                                        ? "bg-zinc-750 text-white border-zinc-500 shadow-sm"
                                        : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800"
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        settings.releaseTriggerEnabled
                                          ? "bg-amber-400 shadow-[0_0_6px_#fbbf24]"
                                          : "bg-zinc-600"
                                      }`}
                                    />
                                    Rel. Trig.
                                  </button>

                                  <div className="flex items-center gap-3">
                                    <Knob
                                      label={releaseSampleBuffer ? "Rel Offset" : "Rel Trigger"}
                                      value={settings.releaseTriggerSec}
                                      min={0}
                                      max={
                                        releaseSampleBuffer
                                          ? releaseSampleBuffer.duration
                                          : sampleBuffer
                                          ? sampleBuffer.duration
                                          : 2
                                      }
                                      step={kStep}
                                      displayValue={`${settings.releaseTriggerSec.toFixed(2)}s`}
                                      disabled={!settings.releaseTriggerEnabled}
                                      onChange={(val) =>
                                        setSettings((p) => ({
                                          ...p,
                                          releaseTriggerSec: val,
                                        }))
                                      }
                                    />

                                    <Knob
                                      label="Rel Vol"
                                      value={settings.releaseTriggerGain}
                                      min={0.0}
                                      max={1.5}
                                      step={0.01}
                                      displayValue={`${Math.round(settings.releaseTriggerGain * 100)}%`}
                                      disabled={!settings.releaseTriggerEnabled}
                                      onChange={(val) =>
                                        setSettings((p) => ({
                                          ...p,
                                          releaseTriggerGain: val,
                                        }))
                                      }
                                    />
                                  </div>
                                </div>

                                {/* Right: Button to enable new sample ABOVE the little visualizer */}
                                <div className="flex flex-col items-center gap-1.5 w-32">
                                  {releaseSampleBuffer ? (
                                    <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-750 text-zinc-200 shadow-sm w-full">
                                      <div className="flex items-center gap-1.5 truncate min-w-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 shrink-0" />
                                        <span
                                          className="truncate font-medium text-[10px]"
                                          title={releaseSampleName || "Custom Release Audio"}
                                        >
                                          {releaseSampleName || "Rel Audio"}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-0.5 shrink-0">
                                        <label
                                          title="Replace with another audio file"
                                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer transition flex items-center justify-center"
                                        >
                                          <Upload className="w-3 h-3" />
                                          <input
                                            type="file"
                                            accept="audio/*"
                                            onChange={handleReleaseFileUpload}
                                            className="hidden"
                                          />
                                        </label>
                                        <button
                                          onClick={handleClearReleaseSample}
                                          title="Clear and remove release trigger sample"
                                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition flex items-center justify-center"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <label
                                      title="Insert a separate audio file for the release trigger"
                                      className="flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-md bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition select-none shadow-sm w-full"
                                    >
                                      <Upload className="w-3 h-3 text-zinc-400" />
                                      <span className="text-[10px] font-semibold">Load Sample</span>
                                      <input
                                        type="file"
                                        accept="audio/*"
                                        onChange={handleReleaseFileUpload}
                                        className="hidden"
                                      />
                                    </label>
                                  )}

                                  {/* The Mini Visualizer */}
                                  <div
                                    className={`relative w-full h-[76px] rounded-xl overflow-hidden bg-zinc-950 border transition shadow-inner flex flex-col justify-between p-1.5 ${
                                      settings.releaseTriggerEnabled
                                        ? "border-zinc-700/80 shadow-md"
                                        : "border-zinc-850 opacity-40"
                                    }`}
                                  >
                                    <canvas
                                      ref={releaseCanvasRef}
                                      width={128}
                                      height={76}
                                      className="absolute inset-0 w-full h-full pointer-events-none"
                                    />
                                    <div className="relative z-10 flex items-center justify-between w-full pointer-events-none">
                                      <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                                        {releaseSampleBuffer ? "CUSTOM REL" : "SLICE REL"}
                                      </span>
                                      <span className="text-[8px] font-mono text-zinc-300 font-semibold">
                                        {releaseSampleBuffer
                                          ? `${releaseSampleBuffer.duration.toFixed(2)}s`
                                          : sampleBuffer
                                          ? `${Math.max(0, settings.endSec - settings.releaseTriggerSec).toFixed(2)}s`
                                          : "—"}
                                      </span>
                                    </div>

                                    <div className="relative z-10 flex items-center justify-between w-full pointer-events-none">
                                      <span
                                        className={`text-[7px] font-mono font-bold uppercase px-1 py-0.5 rounded ${
                                          settings.releaseTriggerEnabled
                                            ? "text-zinc-200 bg-zinc-800 border border-zinc-700/60"
                                            : "text-zinc-600 bg-zinc-900"
                                        }`}
                                      >
                                        {settings.releaseTriggerEnabled ? "ACTIVE" : "BYPASS"}
                                      </span>
                                      {releaseSampleBuffer && (
                                        <span
                                          className="text-[7px] font-mono text-zinc-400 truncate max-w-[55px]"
                                          title={releaseSampleName || ""}
                                        >
                                          {releaseSampleName}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex items-start justify-center h-full gap-5 pt-1">
                        {(() => {
                          const kStep = snapToGrid && sampleBuffer ? sampleBuffer.duration / 16 : 0.001;
                          return (
                            <>
                              {/* Playback Boundaries */}
                              <div className="flex flex-col items-center gap-2.5">
                                <span className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase py-0.5">
                                  Boundaries
                                </span>
                                <div className="flex items-center gap-3">
                                  <Knob
                                    label="Start"
                                    value={settings.startSec}
                                    min={0}
                                    max={sampleBuffer ? sampleBuffer.duration : 2}
                                    step={kStep}
                                    displayValue={`${settings.startSec.toFixed(2)}s`}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        startSec: Math.min(val, p.endSec - kStep),
                                      }))
                                    }
                                  />
                                  <Knob
                                    label="End"
                                    value={settings.endSec}
                                    min={kStep}
                                    max={sampleBuffer ? sampleBuffer.duration : 2}
                                    step={kStep}
                                    displayValue={`${settings.endSec.toFixed(2)}s`}
                                    onChange={(val) =>
                                      setSettings((p) => {
                                        const newEnd = Math.max(val, p.startSec + kStep);
                                        if (isEndLinkedRef.current) {
                                          return {
                                            ...p,
                                            endSec: newEnd,
                                            loopEndSec: Math.max(p.loopStartSec + kStep, newEnd),
                                          };
                                        }
                                        return { ...p, endSec: newEnd };
                                      })
                                    }
                                  />
                                  <Knob
                                    label="Root"
                                    value={settings.baseRootMidi}
                                    min={24}
                                    max={96}
                                    step={1}
                                    displayValue={midiToNoteName(settings.baseRootMidi)}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        baseRootMidi: Math.round(val),
                                      }))
                                    }
                                  />
                                </div>
                              </div>

                              {/* Link End Divider Button */}
                              <div className="flex flex-col items-center justify-center self-center gap-1.5 px-1">
                                <div className="w-[1px] h-8 bg-zinc-800/80" />
                                <button
                                  onClick={() => {
                                    setIsEndLinked((prev) => {
                                      const next = !prev;
                                      if (next) {
                                        setSettings((p) => ({
                                          ...p,
                                          loopEndSec: Math.min(p.endSec, sampleBuffer ? sampleBuffer.duration : p.endSec),
                                        }));
                                      }
                                      return next;
                                    });
                                  }}
                                  title={
                                    isEndLinked
                                      ? "Linked: Main End & Loop End move together in lockstep (Click to unlink)"
                                      : "Click to link Main End & Loop End together"
                                  }
                                  className={`px-2 py-1 rounded-md text-[9px] font-mono font-bold uppercase transition flex items-center gap-1 border shadow-sm ${
                                    isEndLinked
                                      ? "bg-zinc-750 text-white border-zinc-500 shadow-md"
                                      : "bg-zinc-900 text-zinc-500 hover:text-zinc-300 border-zinc-800 hover:border-zinc-700"
                                  }`}
                                >
                                  <svg
                                    className="w-3 h-3"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                  </svg>
                                  <span>Link End</span>
                                </button>
                                <div className="w-[1px] h-8 bg-zinc-800/80" />
                              </div>

                              {/* Loop Section */}
                              <div className="flex flex-col items-center gap-2.5">
                                <span className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase py-0.5">
                                  Seamless Loop
                                </span>

                                <div className="flex items-center gap-4">
                                  <Knob
                                    label="Loop Start"
                                    value={settings.loopStartSec}
                                    min={0}
                                    max={sampleBuffer ? sampleBuffer.duration : 2}
                                    step={kStep}
                                    displayValue={`${settings.loopStartSec.toFixed(2)}s`}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        loopStartSec: Math.min(val, p.loopEndSec - kStep),
                                      }))
                                    }
                                  />
                                  <Knob
                                    label="Loop End"
                                    value={settings.loopEndSec}
                                    min={kStep}
                                    max={sampleBuffer ? sampleBuffer.duration : 2}
                                    step={kStep}
                                    displayValue={`${settings.loopEndSec.toFixed(2)}s`}
                                    onChange={(val) =>
                                      setSettings((p) => {
                                        const newLoopEnd = Math.max(val, p.loopStartSec + kStep);
                                        if (isEndLinkedRef.current) {
                                          return {
                                            ...p,
                                            loopEndSec: newLoopEnd,
                                            endSec: Math.max(p.startSec + kStep, newLoopEnd),
                                          };
                                        }
                                        return { ...p, loopEndSec: newLoopEnd };
                                      })
                                    }
                                  />
                                  <Knob
                                    label="Pre X-Fade"
                                    value={settings.loopCrossfadeSec}
                                    min={0}
                                    max={0.5}
                                    step={0.001}
                                    displayValue={`${Math.round(settings.loopCrossfadeSec * 1000)}ms`}
                                    onChange={(val) =>
                                      setSettings((p) => ({
                                        ...p,
                                        loopCrossfadeSec: val,
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            </>
                          );
                        })()}

                        <div className="w-[1px] h-24 bg-zinc-800/80 self-center" />

                        {/* Release Trigger Section with Right-Side Mini Visualizer */}
                        <div className="flex items-center gap-5 md:gap-6 pl-1.5">
                          {/* Left Controls: Button and Knobs */}
                          <div className="flex flex-col items-center gap-2 shrink-0">
                            <button
                              onClick={() =>
                                setSettings((prev) => ({
                                  ...prev,
                                  releaseTriggerEnabled: !prev.releaseTriggerEnabled,
                                }))
                              }
                              className={`flex items-center gap-1.5 px-3 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border transition ${
                                settings.releaseTriggerEnabled
                                  ? "bg-zinc-750 text-white border-zinc-500 shadow-sm"
                                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  settings.releaseTriggerEnabled
                                    ? "bg-zinc-200 shadow-[0_0_6px_rgba(255,255,255,0.6)]"
                                    : "bg-zinc-600"
                                }`}
                              />
                              Rel. Trig.
                            </button>

                            <div className="flex items-center gap-3">
                              <Knob
                                label={releaseSampleBuffer ? "Rel Offset" : "Rel Trigger"}
                                value={settings.releaseTriggerSec}
                                min={0}
                                max={
                                  releaseSampleBuffer
                                    ? releaseSampleBuffer.duration
                                    : sampleBuffer
                                    ? sampleBuffer.duration
                                    : 2
                                }
                                step={0.001}
                                displayValue={`${settings.releaseTriggerSec.toFixed(2)}s`}
                                disabled={!settings.releaseTriggerEnabled}
                                onChange={(val) =>
                                  setSettings((p) => ({
                                    ...p,
                                    releaseTriggerSec: val,
                                  }))
                                }
                              />

                              <Knob
                                label="Rel Vol"
                                value={settings.releaseTriggerGain}
                                min={0.0}
                                max={1.5}
                                step={0.01}
                                displayValue={`${Math.round(settings.releaseTriggerGain * 100)}%`}
                                disabled={!settings.releaseTriggerEnabled}
                                onChange={(val) =>
                                  setSettings((p) => ({
                                    ...p,
                                    releaseTriggerGain: val,
                                  }))
                                }
                              />
                            </div>
                          </div>

                          {/* Right: Button to enable new sample ABOVE the little visualizer */}
                          <div className="flex flex-col items-center gap-1.5 w-32">
                            {releaseSampleBuffer ? (
                              <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-750 text-zinc-200 shadow-sm w-full">
                                <div className="flex items-center gap-1.5 truncate min-w-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 shrink-0" />
                                  <span
                                    className="truncate font-medium text-[10px]"
                                    title={releaseSampleName || "Custom Release Audio"}
                                  >
                                    {releaseSampleName || "Rel Audio"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <label
                                    title="Replace with another audio file"
                                    className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer transition flex items-center justify-center"
                                  >
                                    <Upload className="w-3 h-3" />
                                    <input
                                      type="file"
                                      accept="audio/*"
                                      onChange={handleReleaseFileUpload}
                                      className="hidden"
                                    />
                                  </label>
                                  <button
                                    onClick={handleClearReleaseSample}
                                    title="Clear and remove release trigger sample"
                                    className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition flex items-center justify-center"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label
                                title="Insert a separate audio file for the release trigger"
                                className="flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-md bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer transition select-none shadow-sm w-full"
                              >
                                <Upload className="w-3 h-3 text-zinc-400" />
                                <span className="text-[10px] font-semibold">Load Sample</span>
                                <input
                                  type="file"
                                  accept="audio/*"
                                  onChange={handleReleaseFileUpload}
                                  className="hidden"
                                />
                              </label>
                            )}

                            {/* The Mini Visualizer */}
                            <div
                              className={`relative w-full h-[76px] rounded-xl overflow-hidden bg-zinc-950 border transition shadow-inner flex flex-col justify-between p-1.5 ${
                                settings.releaseTriggerEnabled
                                  ? "border-zinc-700/80 shadow-md"
                                  : "border-zinc-850 opacity-40"
                              }`}
                            >
                              <canvas
                                ref={releaseCanvasRef}
                                width={128}
                                height={76}
                                className="absolute inset-0 w-full h-full pointer-events-none"
                              />
                              <div className="relative z-10 flex items-center justify-between w-full pointer-events-none">
                                <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-zinc-500">
                                  {releaseSampleBuffer ? "CUSTOM REL" : "SLICE REL"}
                                </span>
                                <span className="text-[8px] font-mono text-zinc-300 font-semibold">
                                  {releaseSampleBuffer
                                    ? `${releaseSampleBuffer.duration.toFixed(2)}s`
                                    : sampleBuffer
                                    ? `${Math.max(0, settings.endSec - settings.releaseTriggerSec).toFixed(2)}s`
                                    : "—"}
                                </span>
                              </div>

                              <div className="relative z-10 flex items-center justify-between w-full pointer-events-none">
                                <span
                                  className={`text-[7px] font-mono font-bold uppercase px-1 py-0.5 rounded ${
                                    settings.releaseTriggerEnabled
                                      ? "text-zinc-200 bg-zinc-800 border border-zinc-700/60"
                                      : "text-zinc-600 bg-zinc-900"
                                  }`}
                                >
                                  {settings.releaseTriggerEnabled ? "ACTIVE" : "BYPASS"}
                                </span>
                                {releaseSampleBuffer && (
                                  <span
                                    className="text-[7px] font-mono text-zinc-400 truncate max-w-[55px]"
                                    title={releaseSampleName || ""}
                                  >
                                    {releaseSampleName}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
          </div>
        )}

        {/* 2. SEQUENCER MASTER TAB (Full Deck) */}
        {masterTab === "sequencer" && (
          <SequencerDeck
            isSeqPlaying={isSeqPlaying}
            setIsSeqPlaying={setIsSeqPlaying}
            totalSteps={totalSteps}
            setTotalSteps={setTotalSteps}
            seqMode={seqMode}
            setSeqMode={setSeqMode}
            seqSteps={seqSteps}
            setSeqSteps={setSeqSteps}
            seqSplitSteps={seqSplitSteps}
            setSeqSplitSteps={setSeqSplitSteps}
            seqSubSteps={seqSubSteps}
            setSeqSubSteps={setSeqSubSteps}
            seqVelocities={seqVelocities}
            setSeqVelocities={setSeqVelocities}
            seqSubVelocities={seqSubVelocities}
            setSeqSubVelocities={setSeqSubVelocities}
            seqPitches={seqPitches}
            setSeqPitches={setSeqPitches}
            seqArpOffsets={seqArpOffsets}
            setSeqArpOffsets={setSeqArpOffsets}
            seqSubArpOffsets={seqSubArpOffsets}
            setSeqSubArpOffsets={setSeqSubArpOffsets}
            seqPans={seqPans}
            setSeqPans={setSeqPans}
            seqSubPans={seqSubPans}
            setSeqSubPans={setSeqSubPans}
            currentSeqSubStep={currentSeqSubStep}
            seqSubTab={seqSubTab}
            setSeqSubTab={setSeqSubTab}
            currentSeqStep={currentSeqStep}
            setCurrentSeqStep={setCurrentSeqStep}
            isSeqDawSync={isSeqDawSync}
            setIsSeqDawSync={setIsSeqDawSync}
            customSeqBpm={customSeqBpm}
            setCustomSeqBpm={setCustomSeqBpm}
            isEditingBpm={isEditingBpm}
            setIsEditingBpm={setIsEditingBpm}
            bpmInputText={bpmInputText}
            setBpmInputText={setBpmInputText}
            hostBpm={settings.hostBpm}
            seqPlayrate={seqPlayrate}
            setSeqPlayrate={setSeqPlayrate}
            midiToNoteName={midiToNoteName}
            triggerVoice={triggerVoice}
            releaseVoice={releaseVoice}
            heldKeysCount={heldKeysCount}
            onTogglePlay={toggleSeqPlaying}
          />
        )}

        {/* 3. ARPEGGIATOR MASTER TAB (Full Deck - only in One-Shot mode) */}
        {masterTab === "arpeggiator" && settings.playbackMode === "oneshot" && (
          <ArpeggiatorDeck
            arpRate={arpRate}
            setArpRate={setArpRate}
            arpPattern={arpPattern}
            setArpPattern={setArpPattern}
            arpOctaves={arpOctaves}
            setArpOctaves={setArpOctaves}
            arpGate={arpGate}
            setArpGate={setArpGate}
            isArpPlaying={isArpPlaying}
            setIsArpPlaying={setIsArpPlaying}
            hostBpm={settings.hostBpm}
          />
        )}

        {/* 4. ENVELOPES MASTER TAB (Full Deck) */}
        {masterTab === "envelopes" && (
          <div className="w-full h-full px-6 pt-3.5 pb-3.5 flex flex-col justify-between items-center">
            {/* Precision Neatly Framed ADSR Visual Curve Canvas (Matches lower knobs card width) */}
            <div className="relative w-full max-w-3xl h-[235px] rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-xl flex items-center justify-center">
              <svg className="w-full h-full" viewBox="0 0 600 130" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="adsrCurveGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#52525b" stopOpacity="0.55" />
                    <stop offset="60%" stopColor="#52525b" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#09090b" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Level Guides */}
                <line x1="20" y1="20" x2="580" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 4" />
                <line x1="20" y1="44" x2="580" y2="44" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 4" />
                <line x1="20" y1="68" x2="580" y2="68" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 4" />
                <line x1="20" y1="92" x2="580" y2="92" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 4" />
                <line x1="20" y1="115" x2="580" y2="115" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

                {/* ADSR Coordinates Mapping - Neatly Framed & Centered */}
                {(() => {
                  const baselineY = 115;
                  const peakY = 20;
                  const totalH = baselineY - peakY;

                  // Normalized stage widths neatly proportioned across the frame
                  const attackNorm = Math.pow(Math.max(0.001, settings.attack) / 2.0, 0.5);
                  const attackW = Math.max(24, Math.round(24 + attackNorm * 115));

                  const decayNorm = Math.pow(Math.max(0.01, settings.decay) / 5.0, 0.5);
                  const decayW = Math.max(28, Math.round(28 + decayNorm * 135));

                  const releaseNorm = Math.pow(Math.max(0.01, settings.release) / 5.0, 0.5);
                  const releaseW = Math.max(30, Math.round(30 + releaseNorm * 145));

                  // Sustain width fills remaining zone with neat ~35px margins on each side
                  const sustainW = Math.max(100, 530 - (attackW + decayW + releaseW));

                  const totalW = attackW + decayW + sustainW + releaseW;
                  const x0 = Math.round((600 - totalW) / 2); // Exact centering!
                  const x1 = x0 + attackW;
                  const x2 = x1 + decayW;
                  const x3 = x2 + sustainW;
                  const x4 = x3 + releaseW;

                  const sustainY = baselineY - settings.sustain * totalH;

                  const pathD = `M ${x0} ${baselineY} L ${x1} ${peakY} L ${x2} ${sustainY} L ${x3} ${sustainY} L ${x4} ${baselineY}`;
                  const areaD = `${pathD} L ${x4} ${baselineY} L ${x0} ${baselineY} Z`;

                  return (
                    <>
                      {/* Under-fill Gradient matching waveform visualizer palette */}
                      <path d={areaD} fill="url(#adsrCurveGrad)" />

                      {/* Main Stroke */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke="#e4e4e7"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="filter drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]"
                      />

                      {/* Stage Labels & Live Readouts Centered under each stage */}
                      <g className="select-none pointer-events-none">
                        <text x={(x0 + x1) / 2} y={baselineY - 8} fill="#71717a" fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                          ATTACK
                        </text>
                        <text x={(x1 + x2) / 2} y={baselineY - 8} fill="#71717a" fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                          DECAY
                        </text>
                        <text x={(x2 + x3) / 2} y={baselineY - 8} fill="#71717a" fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                          SUSTAIN ({Math.round(settings.sustain * 100)}%)
                        </text>
                        <text x={(x3 + x4) / 2} y={baselineY - 8} fill="#71717a" fontSize="8" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                          RELEASE
                        </text>
                      </g>

                      {/* Node 1: Attack Peak */}
                      <circle
                        cx={x1}
                        cy={peakY}
                        r={6}
                        fill="#52525b"
                        stroke="#e4e4e7"
                        strokeWidth={2}
                        className="cursor-ew-resize hover:scale-125 transition-transform"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          e.stopPropagation();
                        }}
                        onPointerMove={(e) => {
                          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                          setSettings((p) => ({
                            ...p,
                            attack: Math.max(0.001, Math.min(2.0, Number((p.attack + (e.movementX / 100) * 1.5).toFixed(3)))),
                          }));
                        }}
                        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                      />

                      {/* Node 2: Decay / Sustain */}
                      <circle
                        cx={x2}
                        cy={sustainY}
                        r={6.5}
                        fill="#52525b"
                        stroke="#e4e4e7"
                        strokeWidth={2}
                        className="cursor-move hover:scale-125 transition-transform"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          e.stopPropagation();
                        }}
                        onPointerMove={(e) => {
                          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                          setSettings((p) => ({
                            ...p,
                            decay: Math.max(0.01, Math.min(5.0, Number((p.decay + (e.movementX / 100) * 2.5).toFixed(2)))),
                            sustain: Math.max(0, Math.min(1.0, Number((p.sustain - e.movementY / 80).toFixed(2)))),
                          }));
                        }}
                        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                      />

                      {/* Node 3: Release End */}
                      <circle
                        cx={x4}
                        cy={baselineY}
                        r={6}
                        fill="#52525b"
                        stroke="#e4e4e7"
                        strokeWidth={2}
                        className="cursor-ew-resize hover:scale-125 transition-transform"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          e.stopPropagation();
                        }}
                        onPointerMove={(e) => {
                          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                          setSettings((p) => ({
                            ...p,
                            release: Math.max(0.01, Math.min(5.0, Number((p.release + (e.movementX / 100) * 3.0).toFixed(2)))),
                          }));
                        }}
                        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                      />
                    </>
                  );
                })()}
              </svg>
            </div>

            {/* Hardware ADSR Knobs Panel - Completely Evenly Spaced */}
            <div className="w-full max-w-3xl h-[175px] bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 shadow-xl flex flex-col items-center justify-center">
              <span className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase mb-2">
                Envelope Generators
              </span>
              <div className="w-full flex items-center justify-center gap-10 md:gap-14">
                <Knob
                  label="Attack"
                  value={settings.attack}
                  min={0.001}
                  max={2.0}
                  step={0.002}
                  displayValue={settings.attack <= 0.005 ? "1ms" : `${settings.attack.toFixed(2)}s`}
                  onChange={(val) => setSettings((p) => ({ ...p, attack: val }))}
                />
                <Knob
                  label="Decay"
                  value={settings.decay}
                  min={0.01}
                  max={5.0}
                  step={0.01}
                  displayValue={`${settings.decay.toFixed(2)}s`}
                  onChange={(val) => setSettings((p) => ({ ...p, decay: val }))}
                />
                <Knob
                  label="Sustain"
                  value={settings.sustain}
                  min={0.0}
                  max={1.0}
                  step={0.01}
                  displayValue={`${Math.round(settings.sustain * 100)}%`}
                  onChange={(val) => setSettings((p) => ({ ...p, sustain: val }))}
                />
                <Knob
                  label="Release"
                  value={settings.release}
                  min={0.01}
                  max={5.0}
                  step={0.01}
                  displayValue={`${settings.release.toFixed(2)}s`}
                  onChange={(val) => setSettings((p) => ({ ...p, release: val }))}
                />
              </div>
            </div>
          </div>
        )}

        {/* 5. FILTERS MASTER TAB (Moog Model D Dual Filter Section) */}
        {masterTab === "filters" && (
          <FiltersDeck
            lpfEnabled={settings.lpfEnabled}
            setLpfEnabled={(enabled) =>
              setSettings((p) => ({ ...p, lpfEnabled: enabled }))
            }
            lpfCutoff={settings.lpfCutoff}
            setLpfCutoff={(cutoff) =>
              setSettings((p) => ({ ...p, lpfCutoff: cutoff }))
            }
            lpfResonance={settings.lpfResonance}
            setLpfResonance={(res) =>
              setSettings((p) => ({ ...p, lpfResonance: res }))
            }
            lpfSlope={settings.lpfSlope}
            setLpfSlope={(slope) =>
              setSettings((p) => ({ ...p, lpfSlope: slope }))
            }
            hpfEnabled={settings.hpfEnabled}
            setHpfEnabled={(enabled) =>
              setSettings((p) => ({ ...p, hpfEnabled: enabled }))
            }
            hpfCutoff={settings.hpfCutoff}
            setHpfCutoff={(cutoff) =>
              setSettings((p) => ({ ...p, hpfCutoff: cutoff }))
            }
            hpfResonance={settings.hpfResonance}
            setHpfResonance={(res) =>
              setSettings((p) => ({ ...p, hpfResonance: res }))
            }
            hpfSlope={settings.hpfSlope}
            setHpfSlope={(slope) =>
              setSettings((p) => ({ ...p, hpfSlope: slope }))
            }
          />
        )}
        </div>
      </div>
    </div>
  );
}