export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export const formatSeconds = (seconds: number, decimals = 2) => `${seconds.toFixed(decimals)}s`;

export const formatMilliseconds = (seconds: number) => `${Math.round(seconds * 1000)}ms`;

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
}

/** Compact axis labels: 50, 1.00k, 10.0k */
export function formatFrequencyAxis(hz: number): string {
  if (hz >= 10000) return `${(hz / 1000).toFixed(1)}k`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)}k`;
  return `${Math.round(hz)}`;
}

export function formatSemitoneOffset(semitones: number): string {
  const named: Record<number, string> = {
    0: "ROOT", 12: "+1 OCT", 24: "+2 OCT", [-12]: "-1 OCT", [-24]: "-2 OCT",
    7: "+5TH", [-7]: "-5TH", 5: "+4TH", 4: "+M3", 3: "+m3",
  };
  return named[semitones] ?? (semitones > 0 ? `+${semitones}st` : `${semitones}st`);
}

export function formatPan(pan: number): string {
  if (pan === 0) return "CENTER";
  return pan < 0 ? `L ${Math.round(-pan * 100)}%` : `R ${Math.round(pan * 100)}%`;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
