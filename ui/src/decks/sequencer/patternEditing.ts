// Pure helpers for editing the step pattern, plus the lane definitions (velocity / arp / pan).

import type { SequencerLane, SequencerStep, StepHalf, StepPattern } from "../../bridge/types";
import { formatPan, formatSemitoneOffset } from "../../lib/format";

export type HalfKey = "first" | "second";

export function updateHalf(pattern: StepPattern, index: number, half: HalfKey, changes: Partial<StepHalf>): StepPattern {
  const current = pattern[index][half];
  if (Object.entries(changes).every(([k, v]) => current[k as keyof StepHalf] === v)) return pattern;

  const next = [...pattern];
  next[index] = { ...pattern[index], [half]: { ...current, ...changes } };
  return next;
}

/** Splitting a step copies the first half's settings into the second half and turns it on. */
export function toggleSplit(pattern: StepPattern, index: number): StepPattern {
  const step = pattern[index];
  const next = [...pattern];
  next[index] = step.split
    ? { ...step, split: false }
    : { ...step, split: true, second: { ...step.first, on: true } };
  return next;
}

/** Applies a value generator to one field on every half of every step. */
export function mapAllHalves<K extends keyof StepHalf>(pattern: StepPattern, field: K, value: (index: number) => StepHalf[K]): StepPattern {
  return pattern.map((step: SequencerStep, i) => ({
    ...step,
    first: { ...step.first, [field]: value(i) },
    second: { ...step.second, [field]: value(i) },
  }));
}

//==============================================================================
export interface LaneDefinition {
  field: "velocity" | "pitchOffset" | "pan";
  label: string;
  defaultValue: number;
  /** Vertical position (0 bottom .. 1 top) -> stored value. */
  fromFraction: (fraction: number) => number;
  /** Bipolar lanes draw from the centre line. */
  bipolar: boolean;
  range: number; // |max| for bipolar lanes, max for unipolar
  badge: (value: number) => string;
  footer: (value: number) => string;
  accent: "neutral" | "amber" | "sky";
}

export const LANES: Record<SequencerLane, LaneDefinition> = {
  velocity: {
    field: "velocity",
    label: "Vel",
    defaultValue: 100,
    fromFraction: (f) => Math.round(f * 127),
    bipolar: false,
    range: 127,
    badge: (v) => String(v),
    footer: () => "VEL",
    accent: "neutral",
  },
  arp: {
    field: "pitchOffset",
    label: "Arp",
    defaultValue: 0,
    fromFraction: (f) => {
      const semitones = Math.round(-24 + f * 48);
      return Math.abs(semitones) === 1 && Math.abs(f - 0.5) < 0.02 ? 0 : semitones; // sticky centre
    },
    bipolar: true,
    range: 24,
    badge: formatSemitoneOffset,
    footer: (v) => (v >= 0 ? `+${v}` : `${v}`),
    accent: "amber",
  },
  pan: {
    field: "pan",
    label: "Pan",
    defaultValue: 0,
    fromFraction: (f) => {
      const pan = Number((-1 + f * 2).toFixed(2));
      return Math.abs(pan) < 0.08 ? 0 : pan; // sticky centre
    },
    bipolar: true,
    range: 1,
    badge: formatPan,
    footer: () => "PAN",
    accent: "sky",
  },
};

export function laneValue(half: StepHalf, lane: SequencerLane): number {
  return half[LANES[lane].field];
}

//==============================================================================
// Quick fills offered per lane.

const MUSICAL_OFFSETS = [0, 2, 3, 5, 7, 10, 12, 14, 15, 17, 19, 24];
const randomInt = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

export const LANE_PRESETS: Record<SequencerLane, { label: string; apply: (p: StepPattern) => StepPattern }[]> = {
  velocity: [
    { label: "Flat 100", apply: (p) => mapAllHalves(p, "velocity", () => 100) },
    { label: "Random", apply: (p) => mapAllHalves(p, "velocity", () => randomInt(45, 127)) },
  ],
  arp: [
    { label: "Random", apply: (p) => mapAllHalves(p, "pitchOffset", () => MUSICAL_OFFSETS[randomInt(0, MUSICAL_OFFSETS.length - 1)]) },
  ],
  pan: [
    { label: "Ping-Pong", apply: (p) => mapAllHalves(p, "pan", (i) => (i % 2 === 0 ? -0.7 : 0.7)) },
    { label: "Random", apply: (p) => mapAllHalves(p, "pan", () => Number((-0.85 + Math.random() * 1.7).toFixed(2))) },
    { label: "All Center", apply: (p) => mapAllHalves(p, "pan", () => 0) },
  ],
};

export function resetLane(pattern: StepPattern, lane: SequencerLane): StepPattern {
  const { field, defaultValue } = LANES[lane];
  return mapAllHalves(pattern, field, () => defaultValue);
}
