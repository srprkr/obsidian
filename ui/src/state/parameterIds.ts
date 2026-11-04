// Parameter IDs shared with the plugin (plugin/source/Parameters.h). Keep both lists in sync.

export const PARAM_IDS = [
  "masterGain",
  "playbackMode",
  "startPos",
  "endPos",
  "loopStartPos",
  "loopEndPos",
  "loopCrossfade",
  "rootNote",
  "preserveSpeed",
  "tempoSync",
  "sampleBpm",
  "releaseTrigEnabled",
  "releaseTrigPos",
  "releaseTrigGain",
  "attack",
  "decay",
  "sustain",
  "release",
  "hpfEnabled",
  "hpfCutoff",
  "hpfResonance",
  "hpfSlope",
  "lpfEnabled",
  "lpfCutoff",
  "lpfResonance",
  "lpfSlope",
  "seqEnabled",
  "seqSteps",
  "seqRate",
  "seqSync",
  "seqBpm",
  "arpEnabled",
  "arpDivision",
  "arpPattern",
  "arpOctaves",
  "arpRate",
  "arpGate",
] as const;

export type ParamId = (typeof PARAM_IDS)[number];

// Choice parameters are stored as indices into these lists.
export const PLAYBACK_MODES = ["oneshot", "loop"] as const;
export const FILTER_SLOPES = [12, 18, 24] as const;
export const SEQUENCER_STEP_COUNTS = [8, 16] as const;
export const RATE_MULTIPLIERS = [0.5, 1, 2] as const;
export const ARP_DIVISIONS = ["1/4", "1/8", "1/16", "1/32"] as const;
export const ARP_PATTERNS = [
  { id: "up", label: "UP" },
  { id: "down", label: "DOWN" },
  { id: "upDown", label: "UP/DOWN" },
  { id: "random", label: "RANDOM" },
  { id: "chord", label: "CHORD" },
] as const;

export type PlaybackMode = (typeof PLAYBACK_MODES)[number];
export type FilterSlope = (typeof FILTER_SLOPES)[number];
