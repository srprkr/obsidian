// Default values used before the plugin answers, and by the browser mock backend.
// The plugin's own parameter list (Parameters.cpp) is authoritative at runtime.

import type { ParameterInfo, SequencerStep, StepPattern, UiState } from "../bridge/types";
import type { ParamId } from "./parameterIds";

export const MAX_SEQUENCER_STEPS = 16;

const float = (id: ParamId, name: string, min: number, max: number, defaultValue: number): ParameterInfo => ({
  id, name, kind: "float", min, max, defaultValue, value: defaultValue,
});
const int = (id: ParamId, name: string, min: number, max: number, defaultValue: number): ParameterInfo => ({
  id, name, kind: "int", min, max, defaultValue, value: defaultValue,
});
const bool = (id: ParamId, name: string, defaultValue: boolean): ParameterInfo => ({
  id, name, kind: "bool", min: 0, max: 1, defaultValue: Number(defaultValue), value: Number(defaultValue),
});
const choice = (id: ParamId, name: string, choices: string[], defaultIndex: number): ParameterInfo => ({
  id, name, kind: "choice", min: 0, max: choices.length - 1, defaultValue: defaultIndex, value: defaultIndex, choices,
});

export const DEFAULT_PARAMETERS: ParameterInfo[] = [
  float("masterGain", "Master", 0, 2, 1),
  choice("playbackMode", "Playback Mode", ["One Shot", "Loop"], 0),
  float("startPos", "Start", 0, 1, 0),
  float("endPos", "End", 0, 1, 1),
  float("loopStartPos", "Loop Start", 0, 1, 0),
  float("loopEndPos", "Loop End", 0, 1, 1),
  float("loopCrossfade", "Loop Crossfade", 0, 0.5, 0.02),
  int("rootNote", "Root Note", 24, 96, 60),
  bool("preserveSpeed", "Preserve Speed", true),
  bool("tempoSync", "Sync To Host Tempo", true),
  int("sampleBpm", "Sample BPM", 40, 240, 120),
  bool("releaseTrigEnabled", "Release Trigger", false),
  float("releaseTrigPos", "Release Trigger Position", 0, 1, 0.8),
  float("releaseTrigGain", "Release Trigger Volume", 0, 1.5, 1),
  float("attack", "Attack", 0.001, 2, 0.001),
  float("decay", "Decay", 0.01, 5, 0.8),
  float("sustain", "Sustain", 0, 1, 0.8),
  float("release", "Release", 0.01, 5, 0.5),
  bool("hpfEnabled", "High Pass", false),
  float("hpfCutoff", "High Pass Cutoff", 20, 20000, 20),
  float("hpfResonance", "High Pass Emphasis", 0.1, 10, 1),
  choice("hpfSlope", "High Pass Slope", ["12 dB", "18 dB", "24 dB"], 0),
  bool("lpfEnabled", "Low Pass", false),
  float("lpfCutoff", "Low Pass Cutoff", 20, 20000, 20000),
  float("lpfResonance", "Low Pass Emphasis", 0.1, 10, 1),
  choice("lpfSlope", "Low Pass Slope", ["12 dB", "18 dB", "24 dB"], 2),
  bool("seqEnabled", "Sequencer", false),
  choice("seqSteps", "Sequencer Steps", ["8", "16"], 0),
  choice("seqRate", "Sequencer Rate", ["0.5x", "1x", "2x"], 1),
  bool("seqSync", "Sequencer Host Sync", true),
  int("seqBpm", "Sequencer BPM", 40, 300, 120),
  bool("arpEnabled", "Arpeggiator", false),
  choice("arpDivision", "Arp Division", ["1/4", "1/8", "1/16", "1/32"], 2),
  choice("arpPattern", "Arp Pattern", ["Up", "Down", "Up/Down", "Random", "Chord"], 0),
  int("arpOctaves", "Arp Octaves", 1, 4, 2),
  choice("arpRate", "Arp Rate", ["0.5x", "1x", "2x"], 1),
  float("arpGate", "Arp Gate", 0.05, 1, 0.8),
];

export const DEFAULT_UI_STATE: UiState = {
  tab: "playback",
  waveformZoom: 1,
  expandedWaveform: false,
  showGrid: false,
  snapToGrid: false,
  endLinked: false,
  sequencerLane: "velocity",
  audition: false,
};

export function createEmptyStep(): SequencerStep {
  return {
    split: false,
    first: { on: false, velocity: 100, pitchOffset: 0, pan: 0 },
    second: { on: false, velocity: 100, pitchOffset: 0, pan: 0 },
  };
}

export function createEmptyPattern(): StepPattern {
  return Array.from({ length: MAX_SEQUENCER_STEPS }, createEmptyStep);
}
