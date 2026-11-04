import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Play, Square, Volume2, Zap, Sliders, RotateCcw } from "lucide-react";

export interface SequencerDeckProps {
  isSeqPlaying: boolean;
  setIsSeqPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  totalSteps: number;
  setTotalSteps: (steps: number) => void;
  seqMode?: "step" | "melodic";
  setSeqMode?: (mode: "step" | "melodic") => void;
  seqSteps: boolean[];
  setSeqSteps: React.Dispatch<React.SetStateAction<boolean[]>>;
  seqSplitSteps: boolean[];
  setSeqSplitSteps: React.Dispatch<React.SetStateAction<boolean[]>>;
  seqSubSteps: boolean[];
  setSeqSubSteps: React.Dispatch<React.SetStateAction<boolean[]>>;
  seqVelocities: number[];
  setSeqVelocities: React.Dispatch<React.SetStateAction<number[]>>;
  seqSubVelocities: number[];
  setSeqSubVelocities: React.Dispatch<React.SetStateAction<number[]>>;
  seqPitches: number[];
  setSeqPitches: React.Dispatch<React.SetStateAction<number[]>>;
  seqArpOffsets: number[];
  setSeqArpOffsets: React.Dispatch<React.SetStateAction<number[]>>;
  seqSubArpOffsets: number[];
  setSeqSubArpOffsets: React.Dispatch<React.SetStateAction<number[]>>;
  seqPans: number[];
  setSeqPans: React.Dispatch<React.SetStateAction<number[]>>;
  seqSubPans: number[];
  setSeqSubPans: React.Dispatch<React.SetStateAction<number[]>>;
  currentSeqSubStep?: 0 | 1;
  seqSubTab: "velocity" | "arp" | "pan";
  setSeqSubTab: (tab: "velocity" | "arp" | "pan") => void;
  currentSeqStep: number;
  setCurrentSeqStep: React.Dispatch<React.SetStateAction<number>>;
  isSeqDawSync: boolean;
  setIsSeqDawSync: React.Dispatch<React.SetStateAction<boolean>>;
  customSeqBpm: number;
  setCustomSeqBpm: React.Dispatch<React.SetStateAction<number>>;
  isEditingBpm: boolean;
  setIsEditingBpm: React.Dispatch<React.SetStateAction<boolean>>;
  bpmInputText: string;
  setBpmInputText: React.Dispatch<React.SetStateAction<string>>;
  hostBpm: number;
  seqPlayrate: number;
  setSeqPlayrate: (rate: number) => void;
  midiToNoteName: (midi: number) => string;
  triggerVoice: (midiNote: number, gateDurationSec?: number, scheduleTime?: number, velocity?: number, pan?: number) => void;
  releaseVoice?: (midiNote: number, skipReleaseTrigger?: boolean) => void;
  heldKeysCount?: number;
  onTogglePlay?: () => void;
}

const ROOT_NOTES = [
  { value: 0, label: "C" },
  { value: 1, label: "C#" },
  { value: 2, label: "D" },
  { value: 3, label: "D#" },
  { value: 4, label: "E" },
  { value: 5, label: "F" },
  { value: 6, label: "F#" },
  { value: 7, label: "G" },
  { value: 8, label: "G#" },
  { value: 9, label: "A" },
  { value: 10, label: "A#" },
  { value: 11, label: "B" },
];

const MODES = [
  { id: "minor", label: "Minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major", label: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "min_pent", label: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "maj_pent", label: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "octaves", label: "Octaves Only", intervals: [0] },
  { id: "fifth", label: "Root + 5th", intervals: [0, 7] },
  { id: "chromatic", label: "Chromatic (All)", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export function SequencerDeck({
  isSeqPlaying,
  setIsSeqPlaying,
  totalSteps,
  setTotalSteps,
  seqMode,
  setSeqMode,
  seqSteps,
  setSeqSteps,
  seqSplitSteps,
  setSeqSplitSteps,
  seqSubSteps,
  setSeqSubSteps,
  seqVelocities,
  setSeqVelocities,
  seqSubVelocities,
  setSeqSubVelocities,
  seqPitches,
  setSeqPitches,
  seqArpOffsets,
  setSeqArpOffsets,
  seqSubArpOffsets,
  setSeqSubArpOffsets,
  seqPans,
  setSeqPans,
  seqSubPans,
  setSeqSubPans,
  currentSeqSubStep = 0,
  seqSubTab,
  setSeqSubTab,
  currentSeqStep,
  setCurrentSeqStep,
  isSeqDawSync,
  setIsSeqDawSync,
  customSeqBpm,
  setCustomSeqBpm,
  isEditingBpm,
  setIsEditingBpm,
  bpmInputText,
  setBpmInputText,
  hostBpm,
  seqPlayrate,
  setSeqPlayrate,
  midiToNoteName,
  triggerVoice,
  releaseVoice,
  heldKeysCount = 0,
  onTogglePlay,
}: SequencerDeckProps) {
  const [scaleRoot, setScaleRoot] = useState<number>(0); // C
  const [scaleModeId, setScaleModeId] = useState<string>("minor");
  const [isAuditionEnabled, setIsAuditionEnabled] = useState<boolean>(false);

  // Drag-paint state for toggling steps across the grid
  const isDraggingPaintRef = useRef<boolean>(false);
  const paintTargetStateRef = useRef<boolean | null>(null);
  const isDraggingGraphRef = useRef<boolean>(false);
  const lastAuditionedStepRef = useRef<number>(-1);

  // Global pointer up cleanup for drag-painting steps and graphs
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      isDraggingPaintRef.current = false;
      paintTargetStateRef.current = null;
      isDraggingGraphRef.current = false;
      lastAuditionedStepRef.current = -1;
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, []);

  const hasAnyEnabledStep = useMemo(() => {
    return seqSteps.slice(0, totalSteps).some(Boolean);
  }, [seqSteps, totalSteps]);

  // Real-time Note Audition Helper (respects audition toggle)
  const auditionNote = useCallback((midi: number, vel: number = 100, pan: number = 0) => {
    if (!isAuditionEnabled) return;
    try {
      triggerVoice(midi, 0.15, undefined, vel, pan);
    } catch {}
  }, [isAuditionEnabled, triggerVoice]);

  // Apply toggle to a step A (used by click & drag painting) - preserves all parameter values
  const applyStepToggleA = useCallback(
    (idx: number, targetState: boolean) => {
      setSeqSteps((prev) => {
        if (prev[idx] === targetState) return prev;
        const next = [...prev];
        next[idx] = targetState;
        return next;
      });

      if (targetState) {
        auditionNote(
          60 + (seqArpOffsets[idx] || 0),
          seqVelocities[idx] !== undefined ? seqVelocities[idx] : 100,
          seqPans[idx] || 0
        );
      }
    },
    [auditionNote, seqArpOffsets, seqVelocities, seqPans, setSeqSteps]
  );

  // Apply toggle to Sub-step B (used by click & drag painting) - preserves all parameter values
  const applyStepToggleB = useCallback(
    (idx: number, targetState: boolean) => {
      setSeqSubSteps((prev) => {
        if (prev[idx] === targetState) return prev;
        const next = [...prev];
        next[idx] = targetState;
        return next;
      });

      if (targetState) {
        auditionNote(
          60 + (seqSubArpOffsets[idx] || 0),
          seqSubVelocities[idx] !== undefined ? seqSubVelocities[idx] : 100,
          seqSubPans[idx] || 0
        );
      }
    },
    [auditionNote, seqSubArpOffsets, seqSubVelocities, seqSubPans, setSeqSubSteps]
  );

  // Continuous click-and-drag drawing across steps for Velocity, Arp, and Panning (does NOT alter step on/off state)
  const updateGraphValue = useCallback(
    (idx: number, isSub: boolean, clientY: number, trackRect: DOMRect) => {
      const norm = Math.min(1, Math.max(0, 1 - (clientY - trackRect.top) / trackRect.height));

      if (seqSubTab === "velocity") {
        const newVel = Math.round(norm * 127);
        if (isSub) {
          setSeqSubVelocities((prev) => {
            if (prev[idx] === newVel) return prev;
            const next = [...prev];
            next[idx] = newVel;
            return next;
          });
        } else {
          setSeqVelocities((prev) => {
            if (prev[idx] === newVel) return prev;
            const next = [...prev];
            next[idx] = newVel;
            return next;
          });
        }
      } else if (seqSubTab === "arp") {
        let newOffset = Math.round(-24 + norm * 48);
        if (Math.abs(newOffset) === 1 && Math.abs(norm - 0.5) < 0.02) newOffset = 0;
        if (isSub) {
          setSeqSubArpOffsets((prev) => {
            if (prev[idx] === newOffset) return prev;
            const next = [...prev];
            next[idx] = newOffset;
            return next;
          });
        } else {
          setSeqArpOffsets((prev) => {
            if (prev[idx] === newOffset) return prev;
            const next = [...prev];
            next[idx] = newOffset;
            return next;
          });
        }
      } else if (seqSubTab === "pan") {
        let newPan = Number((-1.0 + norm * 2.0).toFixed(2));
        if (Math.abs(newPan) < 0.08) newPan = 0;
        if (isSub) {
          setSeqSubPans((prev) => {
            if (prev[idx] === newPan) return prev;
            const next = [...prev];
            next[idx] = newPan;
            return next;
          });
        } else {
          setSeqPans((prev) => {
            if (prev[idx] === newPan) return prev;
            const next = [...prev];
            next[idx] = newPan;
            return next;
          });
        }
      }
    },
    [
      seqSubTab,
      setSeqVelocities,
      setSeqSubVelocities,
      setSeqArpOffsets,
      setSeqSubArpOffsets,
      setSeqPans,
      setSeqSubPans,
    ]
  );

  // Arp interval label helper
  const formatArpOffset = (st: number) => {
    if (st === 0) return "ROOT";
    if (st === 12) return "+1 OCT";
    if (st === 24) return "+2 OCT";
    if (st === -12) return "-1 OCT";
    if (st === -24) return "-2 OCT";
    if (st === 7) return "+5TH";
    if (st === -7) return "-5TH";
    if (st === 5) return "+4TH";
    if (st === 4) return "+M3";
    if (st === 3) return "+m3";
    if (st > 0) return `+${st}st`;
    return `${st}st`;
  };

  // Pan display helper
  const formatPan = (p: number) => {
    if (p === 0) return "CENTER";
    if (p < 0) return `L ${Math.round(Math.abs(p) * 100)}%`;
    return `R ${Math.round(p * 100)}%`;
  };

  const renderStep = (idx: number, isCompact: boolean) => {
    const isSplit = seqSplitSteps[idx] || false;
    const isPlayhead = isSeqPlaying && currentSeqStep === idx;
    const isBeatStart = idx % 4 === 0;

    // Sub-step A (First half / Standard step)
    const activeA = seqSteps[idx] || false;
    const velA = seqVelocities[idx] !== undefined ? seqVelocities[idx] : 100;
    const arpA = seqArpOffsets[idx] !== undefined ? seqArpOffsets[idx] : 0;
    const panA = seqPans[idx] !== undefined ? seqPans[idx] : 0;
    const isTriggeringNowA = isPlayhead && currentSeqSubStep === 0 && activeA && heldKeysCount > 0;

    // Sub-step B (Second half)
    const activeB = seqSubSteps[idx] || false;
    const velB = seqSubVelocities[idx] !== undefined ? seqSubVelocities[idx] : 100;
    const arpB = seqSubArpOffsets[idx] !== undefined ? seqSubArpOffsets[idx] : 0;
    const panB = seqSubPans[idx] !== undefined ? seqSubPans[idx] : 0;
    const isTriggeringNowB = isPlayhead && currentSeqSubStep === 1 && activeB && heldKeysCount > 0;

    const toggleSplit = () => {
      setSeqSplitSteps((prev) => {
        const next = [...prev];
        const willBeSplit = !next[idx];
        next[idx] = willBeSplit;
        if (willBeSplit) {
          // Initialize Sub-step B with copy of A if not configured
          setSeqSubSteps((s) => {
            const ns = [...s];
            ns[idx] = true;
            return ns;
          });
          setSeqSubVelocities((v) => {
            const nv = [...v];
            nv[idx] = velA;
            return nv;
          });
          setSeqSubArpOffsets((a) => {
            const na = [...a];
            na[idx] = arpA;
            return na;
          });
          setSeqSubPans((p) => {
            const np = [...p];
            np[idx] = panA;
            return np;
          });
        }
        return next;
      });
    };

    const renderSliderLane = (isSub: boolean) => {
      const active = isSub ? activeB : activeA;
      const velocity = isSub ? velB : velA;
      const arpOffset = isSub ? arpB : arpA;
      const pan = isSub ? panB : panA;
      const isSubPlayhead = isPlayhead && (isSub ? currentSeqSubStep === 1 : currentSeqSubStep === 0);
      const subLabel = isSub ? `${idx + 1}.2` : isSplit ? `${idx + 1}.1` : `${idx + 1}`;

      return (
        <div className="flex-1 flex flex-col items-center justify-between w-full h-full min-w-0">
          {/* Slider for selected sub-tab */}
          {seqSubTab === "velocity" && (
            <div className="w-full flex-1 flex flex-col items-center justify-end pt-1">
              <span
                className={`text-[8px] font-mono font-bold mb-0.5 pointer-events-none transition-colors ${
                  active ? "text-zinc-200" : "text-zinc-500"
                }`}
              >
                {velocity}
              </span>
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  isDraggingGraphRef.current = true;
                  lastAuditionedStepRef.current = idx;
                  const rect = e.currentTarget.getBoundingClientRect();
                  updateGraphValue(idx, isSub, e.clientY, rect);
                  auditionNote(60 + arpOffset, velocity, pan);
                }}
                onPointerEnter={(e) => {
                  if (isDraggingGraphRef.current && e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    updateGraphValue(idx, isSub, e.clientY, rect);
                    if (lastAuditionedStepRef.current !== idx) {
                      lastAuditionedStepRef.current = idx;
                      auditionNote(60 + arpOffset, velocity, pan);
                    }
                  }
                }}
                onPointerMove={(e) => {
                  if (isDraggingGraphRef.current && e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    updateGraphValue(idx, isSub, e.clientY, rect);
                  }
                }}
                title={`Step ${subLabel} Velocity: ${velocity}`}
                className={`w-full max-w-[24px] flex-1 rounded-md bg-zinc-900 border relative overflow-hidden flex flex-col justify-end cursor-ns-resize select-none touch-none transition-all ${
                  isSubPlayhead
                    ? "border-white shadow-[0_0_6px_rgba(255,255,255,0.3)]"
                    : active
                    ? "border-zinc-400 shadow-sm"
                    : "border-zinc-800 hover:border-zinc-600 opacity-60"
                }`}
              >
                <div
                  className={`w-full bg-gradient-to-t from-zinc-600 via-zinc-400 to-zinc-200 border-t-2 border-white pointer-events-none transition-opacity ${
                    active ? "opacity-100" : "opacity-45"
                  }`}
                  style={{ height: `${(velocity / 127) * 100}%` }}
                />
              </div>
              <span
                className={`text-[7px] font-mono mt-0.5 uppercase font-semibold pointer-events-none ${
                  active ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                VEL
              </span>
            </div>
          )}

          {seqSubTab === "arp" && (
            <div className="w-full flex-1 flex flex-col items-center justify-end pt-1">
              <span
                className={`text-[7px] font-mono font-bold mb-0.5 px-0.5 rounded text-center truncate max-w-full transition-opacity ${
                  active ? "opacity-100" : "opacity-60"
                } ${
                  arpOffset !== 0
                    ? "bg-amber-400/20 text-amber-300 border border-amber-500/40"
                    : "text-zinc-400 bg-zinc-900 border border-zinc-800"
                }`}
              >
                {formatArpOffset(arpOffset)}
              </span>
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  isDraggingGraphRef.current = true;
                  lastAuditionedStepRef.current = idx;
                  const rect = e.currentTarget.getBoundingClientRect();
                  updateGraphValue(idx, isSub, e.clientY, rect);
                  auditionNote(60 + arpOffset, velocity, pan);
                }}
                onPointerEnter={(e) => {
                  if (isDraggingGraphRef.current && e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    updateGraphValue(idx, isSub, e.clientY, rect);
                    if (lastAuditionedStepRef.current !== idx) {
                      lastAuditionedStepRef.current = idx;
                      auditionNote(60 + arpOffset, velocity, pan);
                    }
                  }
                }}
                onPointerMove={(e) => {
                  if (isDraggingGraphRef.current && e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    updateGraphValue(idx, isSub, e.clientY, rect);
                  }
                }}
                onDoubleClick={() => {
                  if (isSub) {
                    setSeqSubArpOffsets((p) => { const n = [...p]; n[idx] = 0; return n; });
                  } else {
                    setSeqArpOffsets((p) => { const n = [...p]; n[idx] = 0; return n; });
                  }
                }}
                title={`Step ${subLabel} Arp Offset: ${formatArpOffset(arpOffset)}`}
                className={`w-full max-w-[24px] flex-1 rounded-md bg-zinc-900 border relative overflow-hidden flex flex-col justify-end cursor-ns-resize select-none touch-none transition-all ${
                  isSubPlayhead
                    ? "border-white shadow-[0_0_6px_rgba(255,255,255,0.3)]"
                    : active
                    ? "border-zinc-400 shadow-sm"
                    : "border-zinc-800 hover:border-zinc-600 opacity-60"
                }`}
              >
                <div className="absolute top-[50%] left-0 right-0 border-b border-white/40 pointer-events-none" />
                {arpOffset > 0 ? (
                  <div
                    className={`absolute left-0 right-0 bg-gradient-to-t from-zinc-600 via-amber-400 to-amber-200 border-t border-white pointer-events-none transition-opacity ${
                      active ? "opacity-100" : "opacity-45"
                    }`}
                    style={{ bottom: "50%", height: `${(arpOffset / 24) * 50}%` }}
                  />
                ) : arpOffset < 0 ? (
                  <div
                    className={`absolute left-0 right-0 bg-gradient-to-b from-zinc-600 via-amber-500 to-amber-700 border-b border-amber-300 pointer-events-none transition-opacity ${
                      active ? "opacity-100" : "opacity-45"
                    }`}
                    style={{ top: "50%", height: `${(Math.abs(arpOffset) / 24) * 50}%` }}
                  />
                ) : (
                  <div className={`absolute top-[46%] left-0.5 right-0.5 h-1 rounded-full bg-amber-400/80 pointer-events-none transition-opacity ${
                    active ? "opacity-100" : "opacity-45"
                  }`} />
                )}
              </div>
              <span
                className={`text-[7px] font-mono mt-0.5 uppercase font-semibold pointer-events-none ${
                  active ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {arpOffset >= 0 ? `+${arpOffset}` : `${arpOffset}`}
              </span>
            </div>
          )}

          {seqSubTab === "pan" && (
            <div className="w-full flex-1 flex flex-col items-center justify-end pt-1">
              <span
                className={`text-[7px] font-mono font-bold mb-0.5 px-0.5 rounded text-center truncate max-w-full transition-opacity ${
                  active ? "opacity-100" : "opacity-60"
                } ${
                  pan !== 0
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                    : "text-zinc-400 bg-zinc-900 border border-zinc-800"
                }`}
              >
                {formatPan(pan)}
              </span>
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  isDraggingGraphRef.current = true;
                  lastAuditionedStepRef.current = idx;
                  const rect = e.currentTarget.getBoundingClientRect();
                  updateGraphValue(idx, isSub, e.clientY, rect);
                  auditionNote(60 + arpOffset, velocity, pan);
                }}
                onPointerEnter={(e) => {
                  if (isDraggingGraphRef.current && e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    updateGraphValue(idx, isSub, e.clientY, rect);
                    if (lastAuditionedStepRef.current !== idx) {
                      lastAuditionedStepRef.current = idx;
                      auditionNote(60 + arpOffset, velocity, pan);
                    }
                  }
                }}
                onPointerMove={(e) => {
                  if (isDraggingGraphRef.current && e.buttons === 1) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    updateGraphValue(idx, isSub, e.clientY, rect);
                  }
                }}
                onDoubleClick={() => {
                  if (isSub) {
                    setSeqSubPans((p) => { const n = [...p]; n[idx] = 0; return n; });
                  } else {
                    setSeqPans((p) => { const n = [...p]; n[idx] = 0; return n; });
                  }
                }}
                title={`Step ${subLabel} Pan: ${formatPan(pan)}`}
                className={`w-full max-w-[24px] flex-1 rounded-md bg-zinc-900 border relative overflow-hidden flex flex-col justify-end cursor-ns-resize select-none touch-none transition-all ${
                  isSubPlayhead
                    ? "border-white shadow-[0_0_6px_rgba(255,255,255,0.3)]"
                    : active
                    ? "border-zinc-400 shadow-sm"
                    : "border-zinc-800 hover:border-zinc-600 opacity-60"
                }`}
              >
                <div className="absolute top-[50%] left-0 right-0 border-b border-white/40 pointer-events-none" />
                {pan > 0 ? (
                  <div
                    className={`absolute left-0 right-0 bg-gradient-to-t from-zinc-600 via-sky-400 to-sky-200 border-t border-white pointer-events-none transition-opacity ${
                      active ? "opacity-100" : "opacity-45"
                    }`}
                    style={{ bottom: "50%", height: `${(pan / 1.0) * 50}%` }}
                  />
                ) : pan < 0 ? (
                  <div
                    className={`absolute left-0 right-0 bg-gradient-to-b from-zinc-600 via-sky-500 to-sky-700 border-b border-sky-300 pointer-events-none transition-opacity ${
                      active ? "opacity-100" : "opacity-45"
                    }`}
                    style={{ top: "50%", height: `${(Math.abs(pan) / 1.0) * 50}%` }}
                  />
                ) : (
                  <div className={`absolute top-[46%] left-0.5 right-0.5 h-1 rounded-full bg-zinc-300 pointer-events-none transition-opacity ${
                    active ? "opacity-100" : "opacity-45"
                  }`} />
                )}
              </div>
              <span
                className={`text-[7px] font-mono mt-0.5 uppercase font-semibold pointer-events-none ${
                  active ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                PAN
              </span>
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        key={idx}
        className={`rounded-xl flex flex-col items-center justify-between p-1.5 transition-all border ${
          isCompact ? "h-36" : "h-full min-h-[255px]"
        } ${
          isTriggeringNowA || isTriggeringNowB
            ? "bg-zinc-850 border-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.35)]"
            : isPlayhead
            ? "bg-zinc-850/90 border-emerald-500/60"
            : isBeatStart
            ? "bg-zinc-900 border-zinc-700/80"
            : "bg-zinc-950/80 border-zinc-800"
        }`}
      >
        {isSplit ? (
          <>
            {/* 1. Dual Sub-Step Trigger Buttons at Top */}
            <div className="flex items-center gap-1 w-full">
              {/* Sub-step 1 Trigger Button */}
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  isDraggingPaintRef.current = true;
                  const nextState = !activeA;
                  paintTargetStateRef.current = nextState;
                  applyStepToggleA(idx, nextState);
                }}
                onPointerEnter={(e) => {
                  if (isDraggingPaintRef.current && e.buttons === 1 && paintTargetStateRef.current !== null) {
                    applyStepToggleA(idx, paintTargetStateRef.current);
                  }
                }}
                title={`Step ${idx + 1}.1: Click or drag to toggle`}
                className={`flex-1 py-1.5 px-0.5 rounded-lg flex flex-col items-center justify-between transition-all border cursor-pointer select-none touch-none ${
                  isTriggeringNowA
                    ? "bg-emerald-400 text-zinc-950 border-white shadow-md font-bold scale-[1.02]"
                    : activeA
                    ? isPlayhead && currentSeqSubStep === 0
                      ? "bg-zinc-200 text-zinc-950 border-white shadow-sm font-bold"
                      : "bg-zinc-750 hover:bg-zinc-700 text-white border-zinc-600 shadow-sm"
                    : isPlayhead && currentSeqSubStep === 0
                    ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                    : "bg-zinc-900/60 hover:bg-zinc-850 text-zinc-500 hover:text-zinc-300 border-zinc-800/80"
                }`}
              >
                <span className="text-[9px] font-mono font-bold leading-none pointer-events-none">{idx + 1}.1</span>
                <div
                  className={`w-2 h-2 rounded-full my-0.5 transition-all pointer-events-none ${
                    isTriggeringNowA
                      ? "bg-zinc-950 scale-125"
                      : activeA
                      ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                      : "bg-zinc-800"
                  }`}
                />
                <span className="text-[8px] font-mono font-bold leading-none pointer-events-none">
                  {isTriggeringNowA ? "HIT" : activeA ? "ON" : "—"}
                </span>
              </div>

              {/* Sub-step 2 Trigger Button */}
              <div
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  isDraggingPaintRef.current = true;
                  const nextState = !activeB;
                  paintTargetStateRef.current = nextState;
                  applyStepToggleB(idx, nextState);
                }}
                onPointerEnter={(e) => {
                  if (isDraggingPaintRef.current && e.buttons === 1 && paintTargetStateRef.current !== null) {
                    applyStepToggleB(idx, paintTargetStateRef.current);
                  }
                }}
                title={`Step ${idx + 1}.2: Click or drag to toggle`}
                className={`flex-1 py-1.5 px-0.5 rounded-lg flex flex-col items-center justify-between transition-all border cursor-pointer select-none touch-none ${
                  isTriggeringNowB
                    ? "bg-emerald-400 text-zinc-950 border-white shadow-md font-bold scale-[1.02]"
                    : activeB
                    ? isPlayhead && currentSeqSubStep === 1
                      ? "bg-zinc-200 text-zinc-950 border-white shadow-sm font-bold"
                      : "bg-zinc-750 hover:bg-zinc-700 text-white border-zinc-600 shadow-sm"
                    : isPlayhead && currentSeqSubStep === 1
                    ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                    : "bg-zinc-900/60 hover:bg-zinc-850 text-zinc-500 hover:text-zinc-300 border-zinc-800/80"
                }`}
              >
                <span className="text-[9px] font-mono font-bold leading-none pointer-events-none">{idx + 1}.2</span>
                <div
                  className={`w-2 h-2 rounded-full my-0.5 transition-all pointer-events-none ${
                    isTriggeringNowB
                      ? "bg-zinc-950 scale-125"
                      : activeB
                      ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                      : "bg-zinc-800"
                  }`}
                />
                <span className="text-[8px] font-mono font-bold leading-none pointer-events-none">
                  {isTriggeringNowB ? "HIT" : activeB ? "ON" : "—"}
                </span>
              </div>
            </div>

            {/* 2. Split Button positioned BELOW the toggle on/off button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSplit();
              }}
              title="Click to merge back into single 1x step"
              className="w-full mt-1.5 mb-1 py-0.5 rounded text-[8px] font-mono font-bold transition border bg-zinc-700 hover:bg-zinc-650 text-white border-zinc-500 shadow-sm"
            >
              1x (MERGE)
            </button>

            {/* 3. Dual Sub-step Sliders (Full Height) */}
            <div className="flex items-stretch gap-1 w-full flex-1 pt-0.5">
              {renderSliderLane(false)}
              <div className="w-[1px] bg-zinc-800/80 self-stretch my-1" />
              {renderSliderLane(true)}
            </div>
          </>
        ) : (
          <>
            {/* 1. Step Trigger Button (Top) with Click-and-Drag Painting */}
            <div
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                isDraggingPaintRef.current = true;
                const nextActive = !activeA;
                paintTargetStateRef.current = nextActive;
                applyStepToggleA(idx, nextActive);
              }}
              onPointerEnter={(e) => {
                if (isDraggingPaintRef.current && e.buttons === 1 && paintTargetStateRef.current !== null) {
                  applyStepToggleA(idx, paintTargetStateRef.current);
                }
              }}
              title={`Step ${idx + 1}: Click or drag to toggle`}
              className={`w-full py-1.5 px-1 rounded-lg flex flex-col items-center justify-between transition-all border cursor-pointer select-none touch-none ${
                isTriggeringNowA
                  ? "bg-emerald-400 text-zinc-950 border-white shadow-md font-bold scale-[1.02]"
                  : activeA
                  ? isPlayhead
                    ? "bg-zinc-200 text-zinc-950 border-white shadow-sm font-bold"
                    : "bg-zinc-750 hover:bg-zinc-700 text-white border-zinc-600 shadow-sm"
                  : isPlayhead
                  ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                  : "bg-zinc-900/60 hover:bg-zinc-850 text-zinc-500 hover:text-zinc-300 border-zinc-800/80"
              }`}
            >
              <span className="text-[10px] font-mono font-bold leading-none pointer-events-none">{idx + 1}</span>
              <div
                className={`w-2.5 h-2.5 rounded-full my-1 transition-all pointer-events-none ${
                  isTriggeringNowA
                    ? "bg-zinc-950 scale-125"
                    : activeA
                    ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                    : "bg-zinc-800"
                }`}
              />
              <span className="text-[9px] font-mono font-bold leading-none pointer-events-none">
                {isTriggeringNowA ? "HIT" : activeA ? "ON" : "—"}
              </span>
            </div>

            {/* 2. Split Button positioned BELOW the toggle on/off button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSplit();
              }}
              title="Click to split step in half (two 8th notes)"
              className="w-full mt-1.5 mb-1 py-0.5 rounded text-[8px] font-mono font-bold transition border bg-zinc-900 hover:bg-zinc-850 text-zinc-500 hover:text-zinc-300 border-zinc-800 hover:border-zinc-700"
            >
              ÷2 SPLIT
            </button>

            {/* 3. Slider Lane for Selected Sub-Tab (Taller Slider Graph, No Duplicate Button) */}
            {renderSliderLane(false)}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full px-6 pt-3.5 pb-3.5 flex flex-col justify-between">
      {/* Top Transport & Setup Strip */}
      <div className="flex items-center justify-between gap-4 bg-zinc-950/80 p-3 rounded-xl border border-zinc-800">
        {/* Left: Clear & Audition Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (seqSubTab === "velocity") {
                setSeqVelocities(new Array(32).fill(100));
              } else if (seqSubTab === "arp") {
                setSeqArpOffsets(new Array(32).fill(0));
              } else if (seqSubTab === "pan") {
                setSeqPans(new Array(32).fill(0));
              }
            }}
            title={`Reset ${seqSubTab} to default`}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-red-400 text-xs font-semibold border border-zinc-800 transition"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset {seqSubTab === "velocity" ? "Vel" : seqSubTab === "arp" ? "Arp" : "Pan"}</span>
          </button>

          {/* Audition / Sound Preview Toggle Button */}
          <button
            onClick={() => setIsAuditionEnabled((prev) => !prev)}
            title={
              isAuditionEnabled
                ? "Audition ON: Hear sample play when editing steps/velocity/arp/pan"
                : "Audition OFF: Silent editing"
            }
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
              isAuditionEnabled
                ? "bg-zinc-800 text-white border-zinc-600 shadow-sm"
                : "bg-zinc-950 text-zinc-500 hover:text-zinc-400 border-zinc-800"
            }`}
          >
            <Volume2
              className={`w-3.5 h-3.5 ${
                isAuditionEnabled ? "text-zinc-200" : "text-zinc-600"
              }`}
            />
            <span>Audition</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
                isAuditionEnabled
                  ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                  : "bg-zinc-700"
              }`}
            />
          </button>
        </div>

        {/* Steps Selector: 8 or 16 */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold text-zinc-500">Steps:</span>
          <div className="flex items-center bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
            {[8, 16].map((count) => (
              <button
                key={count}
                onClick={() => {
                  setTotalSteps(count);
                  setCurrentSeqStep((c) => c % count);
                }}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition ${
                  totalSteps === count
                    ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850"
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        {/* Speed / Rate: 0.5x, 1x, 2x */}
        <div className="flex items-center gap-1.5 pl-3 border-l border-zinc-800">
          <span className="text-[10px] uppercase font-bold text-zinc-500">Step Rate:</span>
          <div className="flex items-center bg-zinc-900 border border-zinc-750 rounded-lg p-0.5">
            {[0.5, 1, 2].map((rate) => (
              <button
                key={rate}
                onClick={() => setSeqPlayrate(rate)}
                title={`Sequencer clock: ${rate}x relative to tempo (${rate === 0.5 ? "1/8 notes" : rate === 1 ? "1/16 notes" : "1/32 notes"})`}
                className={`px-2 py-1 rounded text-xs font-mono font-bold transition ${
                  seqPlayrate === rate
                    ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        {/* Right: Sync & BPM + Play Sequence */}
        <div className="flex items-center gap-3">
          {/* Sync & BPM */}
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setIsSeqDawSync((s) => !s)}
              title={
                isSeqDawSync
                  ? "Sequencer synced to Host DAW Tempo"
                  : "Click to sync to Host DAW Tempo"
              }
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider border transition ${
                isSeqDawSync
                  ? "bg-zinc-750 text-white border-zinc-600 shadow-sm"
                  : "bg-zinc-950 text-zinc-400 hover:text-zinc-200 border-zinc-855"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isSeqDawSync ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-600"
                }`}
              />
              <span>Sync</span>
            </button>

            <div className="flex items-center px-2">
              {isSeqDawSync ? (
                <span
                  className="font-mono text-zinc-200 font-bold text-xs flex items-center gap-1"
                  title="Synced to Host DAW"
                >
                  {hostBpm} <span className="text-[10px] text-zinc-500 font-normal">BPM</span>
                </span>
              ) : isEditingBpm ? (
                <input
                  autoFocus
                  type="number"
                  min="40"
                  max="300"
                  value={bpmInputText}
                  onChange={(e) => setBpmInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseInt(bpmInputText);
                      if (!isNaN(val) && val >= 40 && val <= 300) setCustomSeqBpm(val);
                      setIsEditingBpm(false);
                    } else if (e.key === "Escape") {
                      setIsEditingBpm(false);
                    }
                  }}
                  onBlur={() => {
                    const val = parseInt(bpmInputText);
                    if (!isNaN(val) && val >= 40 && val <= 300) setCustomSeqBpm(val);
                    setIsEditingBpm(false);
                  }}
                  className="w-14 bg-zinc-950 border border-zinc-600 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white text-center outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setBpmInputText(customSeqBpm.toString());
                    setIsEditingBpm(true);
                  }}
                  title="Click to type custom BPM"
                  className="font-mono text-zinc-100 hover:text-white font-bold text-xs flex items-center gap-1 hover:bg-zinc-800 px-1.5 py-0.5 rounded transition cursor-text border border-dashed border-zinc-700 hover:border-zinc-500"
                >
                  <span>{customSeqBpm}</span>
                  <span className="text-[10px] text-zinc-500 font-normal">BPM</span>
                </button>
              )}
            </div>
          </div>

          {/* Play / Stop Button */}
          <button
            onClick={() => {
              if (onTogglePlay) {
                onTogglePlay();
              } else {
                setIsSeqPlaying((p) => !p);
              }
            }}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
              isSeqPlaying
                ? "bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)] border border-emerald-400"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-750 hover:text-white border border-zinc-700"
            }`}
          >
            {isSeqPlaying ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span>{isSeqPlaying ? "Stop" : "Play"}</span>
          </button>
        </div>
      </div>

      {/* Main Pattern Sequencer Surface */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 shadow-xl flex flex-col gap-3 flex-1">
        {/* Surface Header Bar with Sub-Tab Navigation Bar & Context Controls */}
        <div className="flex items-center justify-between text-xs text-zinc-500 font-bold uppercase tracking-wider pb-2 border-b border-zinc-800/60">
          {/* Left: Step Info */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-300 font-bold">
              {totalSteps}-Step Pattern
            </span>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border transition-all ${
                !hasAnyEnabledStep
                  ? "bg-zinc-900 text-zinc-500 border-zinc-800"
                  : heldKeysCount > 0
                  ? "bg-emerald-950/80 text-emerald-400 border-emerald-600 shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800"
              }`}
            >
              {!hasAnyEnabledStep
                ? "BLANK"
                : heldKeysCount > 0
                ? `ARMED (${heldKeysCount})`
                : "TRIGGER"}
            </span>
          </div>

          {/* Center: Prominent Sub-Tab Selector (VEL | ARP | PAN) */}
          <div className="flex items-center bg-zinc-900 border border-zinc-750 rounded-xl p-0.5 shadow-sm">
            {/* 1. Velocity Sub-tab */}
            <button
              onClick={() => setSeqSubTab("velocity")}
              className={`px-4 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                seqSubTab === "velocity"
                  ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              VEL
            </button>

            {/* 2. Arpeggiator / Pitch Sub-tab */}
            <button
              onClick={() => setSeqSubTab("arp")}
              className={`px-4 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                seqSubTab === "arp"
                  ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ARP
            </button>

            {/* 3. Panning Sub-tab */}
            <button
              onClick={() => setSeqSubTab("pan")}
              className={`px-4 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                seqSubTab === "pan"
                  ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              PAN
            </button>
          </div>

          {/* Right: Sub-tab specific quick presets */}
          <div className="flex items-center gap-2">
            {seqSubTab === "velocity" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-zinc-500 font-semibold mr-1">Presets:</span>
                <button
                  onClick={() => setSeqVelocities(new Array(32).fill(100))}
                  className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                >
                  Flat 100
                </button>
                <button
                  onClick={() => {
                    setSeqVelocities((prev) =>
                      prev.map(() => Math.round(45 + Math.random() * 82))
                    );
                  }}
                  className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                >
                  Random
                </button>
              </div>
            )}

            {seqSubTab === "arp" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-zinc-500 font-semibold mr-1">Presets:</span>
                <button
                  onClick={() => {
                    const musicalOffsets = [0, 2, 3, 5, 7, 10, 12, 14, 15, 17, 19, 24];
                    setSeqArpOffsets((prev) =>
                      prev.map(() => musicalOffsets[Math.floor(Math.random() * musicalOffsets.length)])
                    );
                  }}
                  className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                >
                  Random
                </button>
              </div>
            )}

            {seqSubTab === "pan" && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-zinc-500 font-semibold mr-1">Presets:</span>
                <button
                  onClick={() => {
                    setSeqPans((prev) => prev.map((_, i) => (i % 2 === 0 ? -0.7 : 0.7)));
                  }}
                  className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                >
                  Ping-Pong
                </button>
                <button
                  onClick={() => {
                    setSeqPans((prev) =>
                      prev.map(() => Number((-0.85 + Math.random() * 1.7).toFixed(2)))
                    );
                  }}
                  className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                >
                  Random
                </button>
                <button
                  onClick={() => setSeqPans(new Array(32).fill(0))}
                  className="px-2 py-0.5 rounded text-[10px] bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                >
                  All Center
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Grid: 1 Row for <= 16 steps, 2 Rows for 24 & 32 steps */}
        {totalSteps <= 16 ? (
          <div
            className={`grid gap-2 flex-1 items-stretch ${
              totalSteps === 8
                ? "grid-cols-[repeat(8,minmax(0,1fr))]"
                : "grid-cols-[repeat(16,minmax(0,1fr))]"
            }`}
          >
            {Array.from({ length: totalSteps }).map((_, idx) => renderStep(idx, false))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 flex-1 justify-between">
            {/* Row 1: Steps 1 - 16 */}
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
                Bar 1 - 2 (Steps 1 - 16)
              </span>
              <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 flex-1">
                {Array.from({ length: 16 }).map((_, idx) => renderStep(idx, true))}
              </div>
            </div>

            {/* Row 2: Steps 17 - 32 */}
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
                Bar 3 - 4 (Steps 17 - 32)
              </span>
              <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 flex-1">
                {Array.from({ length: totalSteps - 16 }).map((_, i) => renderStep(16 + i, true))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}