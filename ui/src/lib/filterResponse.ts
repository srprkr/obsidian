// Magnitude response of the plugin's filters, for the Filters graph.
// This mirrors engine/src/Biquad.cpp exactly, so the curve shows what you hear.

import type { FilterSlope } from "../state/parameterIds";

interface Section { b0: number; b1: number; b2: number; a1: number; a2: number }

export interface FilterSettings {
  enabled: boolean;
  cutoffHz: number;
  emphasis: number;
  slope: FilterSlope;
}

/** Reference rate for drawing; the response shape barely changes between 44.1 and 96 kHz. */
const SAMPLE_RATE = 48000;

/** Emphasis (0.1..10) -> biquad Q in dB, as in the original Web Audio app. */
export function emphasisToQ(emphasis: number): number {
  return Math.min(16, Math.max(0.5, 0.5 + Math.pow(emphasis / 2.6, 1.85)));
}

function clampCutoff(hz: number) {
  return Math.min(SAMPLE_RATE * 0.49, Math.max(10, hz));
}

function biquad(type: "lowpass" | "highpass", hz: number, qDb: number): Section {
  const w0 = (2 * Math.PI * clampCutoff(hz)) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const a0 = 1 + alpha;
  const b0 = (type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  return {
    b0,
    b1: (type === "lowpass" ? 1 - cos : -(1 + cos)) / a0,
    b2: b0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function onePole(type: "lowpass" | "highpass", hz: number): Section {
  const k = Math.tan((Math.PI * clampCutoff(hz)) / SAMPLE_RATE);
  const b0 = type === "lowpass" ? k / (1 + k) : 1 / (1 + k);
  return { b0, b1: type === "lowpass" ? b0 : -b0, b2: 0, a1: (k - 1) / (k + 1), a2: 0 };
}

export function designSections(type: "lowpass" | "highpass", settings: FilterSettings): Section[] {
  const audible = type === "highpass" ? settings.cutoffHz > 20 : settings.cutoffHz < 20000 || settings.emphasis > 1;
  if (!settings.enabled || !audible) return [];

  const q = emphasisToQ(settings.emphasis);
  switch (settings.slope) {
    case 12: return [biquad(type, settings.cutoffHz, q)];
    case 18: return [biquad(type, settings.cutoffHz, q), onePole(type, settings.cutoffHz)];
    case 24: return [biquad(type, settings.cutoffHz, Math.sqrt(q)), biquad(type, settings.cutoffHz, Math.sqrt(q) * 1.15)];
  }
}

/** Gain in dB of a cascade at one frequency. */
export function magnitudeDb(sections: Section[], hz: number): number {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  // z^-1 = e^{-jw}
  const re1 = Math.cos(w), im1 = -Math.sin(w);
  const re2 = Math.cos(2 * w), im2 = -Math.sin(2 * w);

  let magnitude = 1;
  for (const s of sections) {
    const numRe = s.b0 + s.b1 * re1 + s.b2 * re2;
    const numIm = s.b1 * im1 + s.b2 * im2;
    const denRe = 1 + s.a1 * re1 + s.a2 * re2;
    const denIm = s.a1 * im1 + s.a2 * im2;
    magnitude *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  }
  return 20 * Math.log10(Math.max(1e-6, magnitude));
}

// Logarithmic 20 Hz .. 20 kHz axis.
export const frequencyToFraction = (hz: number) =>
  Math.log10(Math.min(20000, Math.max(20, hz)) / 20) / 3;
export const fractionToFrequency = (fraction: number) => 20 * Math.pow(1000, Math.min(1, Math.max(0, fraction)));
