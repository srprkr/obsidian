// Data shapes exchanged with the plugin (plugin/source/WebUiBridge.cpp).

import type { ParamId } from "../state/parameterIds";

export type ParameterKind = "float" | "int" | "bool" | "choice";

export interface ParameterInfo {
  id: ParamId;
  name: string;
  kind: ParameterKind;
  min: number;
  max: number;
  defaultValue: number;
  value: number; // plain value: Hz, seconds, choice index, 0/1 for bools...
  choices?: string[];
}

export interface StepHalf {
  on: boolean;
  velocity: number; // 0..127
  pitchOffset: number; // semitones, -24..24
  pan: number; // -1..1
}

export interface SequencerStep {
  split: boolean;
  first: StepHalf;
  second: StepHalf;
}

export type StepPattern = SequencerStep[];

export interface SampleInfo {
  name: string;
  path: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  frames: number;
  /** Interleaved [min, max] pairs of channel 0 across the whole file. */
  peaks: number[];
}

export interface SampleSlots {
  main: SampleInfo | null;
  release: SampleInfo | null;
}

export type SampleSlot = keyof SampleSlots;

export interface PresetSummary {
  id: string;
  name: string;
  favorite: boolean;
}

export interface PresetList {
  items: PresetSummary[];
  currentId: string;
}

export type MasterTab = "playback" | "envelopes" | "filters" | "sequencer" | "arpeggiator";
export type SequencerLane = "velocity" | "arp" | "pan";

/** Per-instance view settings, saved with the plugin state. */
export interface UiState {
  tab: MasterTab;
  waveformZoom: number;
  expandedWaveform: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  endLinked: boolean;
  sequencerLane: SequencerLane;
  audition: boolean;
}

export interface InitialState {
  parameters: ParameterInfo[];
  pattern: StepPattern;
  samples: SampleSlots;
  presets: PresetList;
  uiState: Partial<UiState> | null;
  version: string;
}

/** [kind, position, progress]: kind 0 = note, 1 = release tail from the main sample, 2 = custom release sample. */
export type VoiceTelemetry = [kind: 0 | 1 | 2, position: number, progress: number];

export interface Telemetry {
  peak: [number, number];
  voices: VoiceTelemetry[];
  sequencerStep: number;
  sequencerHalf: number;
  sequencerRunning: boolean;
  arpRunning: boolean;
  heldNotes: number;
  hostBpm: number;
}

export interface OperationResult {
  ok: boolean;
  error?: string;
}
