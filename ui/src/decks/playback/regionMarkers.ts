// Sample-region markers. All positions are fractions (0..1) of the main sample's length,
// which is how the plugin stores them as automatable parameters.

import { useCallback } from "react";
import type { ParamId } from "../../state/parameterIds";
import { usePluginStore } from "../../state/pluginStore";

export type Marker = "start" | "end" | "loopStart" | "loopEnd" | "releaseTrigger";

export const MARKER_PARAM: Record<Marker, ParamId> = {
  start: "startPos",
  end: "endPos",
  loopStart: "loopStartPos",
  loopEnd: "loopEndPos",
  releaseTrigger: "releaseTrigPos",
};

export interface MarkerPositions {
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  releaseTrigger: number;
}

export interface MoveOptions {
  /** Smallest allowed distance between paired markers (fraction). */
  gap: number;
  /** "Link End": End and Loop End move together. */
  endLinked: boolean;
}

/** Snap To Grid divides the sample into 16 equal parts (4 bars of quarter notes for a 4-bar loop). */
export const SNAP_DIVISIONS = 16;

export const snapFraction = (fraction: number) => Math.round(fraction * SNAP_DIVISIONS) / SNAP_DIVISIONS;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Moves one marker, keeping start < end and loopStart < loopEnd. Returns only what changed. */
export function moveMarker(
  positions: MarkerPositions,
  marker: Marker,
  fraction: number,
  { gap, endLinked }: MoveOptions
): Partial<MarkerPositions> {
  const f = clamp01(fraction);

  switch (marker) {
    case "start":
      return { start: clamp01(Math.min(f, positions.end - gap)) };

    case "end": {
      const end = clamp01(Math.max(f, positions.start + gap));
      return endLinked ? { end, loopEnd: clamp01(Math.max(positions.loopStart + gap, end)) } : { end };
    }

    case "loopStart":
      return { loopStart: clamp01(Math.min(f, positions.loopEnd - gap)) };

    case "loopEnd": {
      const loopEnd = clamp01(Math.max(f, positions.loopStart + gap));
      return endLinked ? { loopEnd, end: clamp01(Math.max(positions.start + gap, loopEnd)) } : { loopEnd };
    }

    case "releaseTrigger":
      return { releaseTrigger: f };
  }
}

export function readMarkerPositions(params: Record<ParamId, number>): MarkerPositions {
  return {
    start: params.startPos,
    end: params.endPos,
    loopStart: params.loopStartPos,
    loopEnd: params.loopEndPos,
    releaseTrigger: params.releaseTrigPos,
  };
}

/** Hook returning a function that moves a marker and writes the affected parameters. */
export function useMarkerMover() {
  return useCallback((marker: Marker, fraction: number) => {
    const { params, ui, samples, setParam } = usePluginStore.getState();
    const duration = samples.main?.durationSec ?? 1;
    const gap = ui.snapToGrid ? 1 / SNAP_DIVISIONS : Math.min(0.5, 0.01 / Math.max(duration, 0.01));
    const target = ui.snapToGrid ? snapFraction(fraction) : fraction;

    const changes = moveMarker(readMarkerPositions(params), marker, target, { gap, endLinked: ui.endLinked });
    for (const [key, value] of Object.entries(changes) as [Marker, number][]) {
      setParam(MARKER_PARAM[key], value);
    }
  }, []);
}

/** Parameters a marker drag may touch (for host automation gestures). */
export function paramsTouchedBy(marker: Marker, endLinked: boolean): ParamId[] {
  if (endLinked && (marker === "end" || marker === "loopEnd")) return ["endPos", "loopEndPos"];
  return [MARKER_PARAM[marker]];
}
