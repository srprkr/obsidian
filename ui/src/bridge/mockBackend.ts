// In-browser stand-in for the plugin, used by `npm run dev` outside a DAW.
// It keeps state in memory and decodes dropped files with Web Audio so the waveform shows;
// it makes no sound. Everything audio-related lives in the C++ engine.

import type { Backend, PluginEvents } from "./api";
import type { InitialState, OperationResult, PresetList, SampleInfo, SampleSlot, SampleSlots, StepPattern, Telemetry, UiState } from "./types";
import { createEmptyPattern, DEFAULT_PARAMETERS } from "../state/defaults";
import type { ParamId } from "../state/parameterIds";
import { base64ToArrayBuffer, fileToBase64 } from "../lib/files";

type Listener = (payload: unknown) => void;

export function createMockBackend(): Backend {
  const listeners = new Map<string, Set<Listener>>();
  const emit = <K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]) =>
    listeners.get(event)?.forEach((fn) => fn(payload));

  const params = new Map<ParamId, number>(DEFAULT_PARAMETERS.map((p) => [p.id, p.defaultValue]));
  let pattern: StepPattern = createEmptyPattern();
  let uiState: Partial<UiState> | null = null;
  const samples: SampleSlots = { main: null, release: null };
  const presets: { id: string; name: string; favorite: boolean; params: Map<ParamId, number>; pattern: StepPattern }[] = [];
  let currentPresetId = "";
  let held = 0;
  let manualRun = false;

  const presetList = (): PresetList => ({
    items: presets.map(({ id, name, favorite }) => ({ id, name, favorite })),
    currentId: currentPresetId,
  });

  async function decode(fileName: string, base64: string): Promise<SampleInfo> {
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(base64ToArrayBuffer(base64));
    const data = buffer.getChannelData(0);
    const bins = 1024;
    const peaks: number[] = [];
    for (let b = 0; b < bins; b++) {
      const from = Math.floor((data.length * b) / bins);
      const to = Math.max(from + 1, Math.floor((data.length * (b + 1)) / bins));
      let lo = 1, hi = -1;
      for (let i = from; i < to && i < data.length; i++) {
        lo = Math.min(lo, data[i]);
        hi = Math.max(hi, data[i]);
      }
      peaks.push(lo > hi ? 0 : lo, lo > hi ? 0 : hi);
    }
    return {
      name: fileName.replace(/\.[^/.]+$/, ""),
      path: fileName,
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      frames: buffer.length,
      peaks,
    };
  }

  async function loadDropped(slot: SampleSlot, fileName: string, base64: string): Promise<OperationResult> {
    try {
      samples[slot] = await decode(fileName, base64);
      emit("samples", { ...samples });
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not decode that file in the browser." };
    }
  }

  function pickFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
  }

  const telemetry = (): Telemetry => ({
    peak: [0, 0],
    voices: [],
    sequencerStep: 0,
    sequencerHalf: 0,
    sequencerRunning: params.get("seqEnabled") === 1 && (held > 0 || manualRun),
    arpRunning: false,
    heldNotes: held,
    hostBpm: 120,
  });
  window.setInterval(() => emit("telemetry", telemetry()), 100);

  const handlers: Record<string, (...args: never[]) => unknown> = {
    getInitialState: (): InitialState => ({
      parameters: DEFAULT_PARAMETERS.map((p) => ({ ...p, value: params.get(p.id) ?? p.defaultValue })),
      pattern,
      samples: { ...samples },
      presets: presetList(),
      uiState,
      version: "dev",
    }),
    setUiState: (state: UiState) => { uiState = state; },
    setParameter: (id: ParamId, value: number) => { params.set(id, value); },
    beginGesture: () => undefined,
    endGesture: () => undefined,
    setPattern: (next: StepPattern) => { pattern = next; },
    browseForSample: async (slot: SampleSlot): Promise<OperationResult> => {
      const file = await pickFile();
      return file ? loadDropped(slot, file.name, await fileToBase64(file)) : { ok: false };
    },
    loadDroppedSample: (slot: SampleSlot, name: string, base64: string) => loadDropped(slot, name, base64),
    clearSample: (slot: SampleSlot) => { samples[slot] = null; emit("samples", { ...samples }); },
    noteOn: () => { held++; },
    noteOff: () => { held = Math.max(0, held - 1); },
    allNotesOff: () => { held = 0; },
    audition: () => undefined,
    setSequencerRunning: (run: boolean) => { manualRun = run; },
    listPresets: presetList,
    savePreset: (name: string) => {
      const id = `${name}-${Date.now()}`;
      presets.push({ id, name, favorite: false, params: new Map(params), pattern });
      currentPresetId = id;
      return presetList();
    },
    loadPreset: (id: string): OperationResult => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return { ok: false };
      preset.params.forEach((v, k) => params.set(k, v));
      pattern = preset.pattern;
      currentPresetId = id;
      window.setTimeout(() => emit("stateReplaced", {}), 0);
      return { ok: true };
    },
    setPresetFavorite: (id: string, favorite: boolean) => {
      const preset = presets.find((p) => p.id === id);
      if (preset) preset.favorite = favorite;
      return presetList();
    },
    deletePreset: (id: string) => {
      const index = presets.findIndex((p) => p.id === id);
      if (index >= 0) presets.splice(index, 1);
      return presetList();
    },
  };

  return {
    call: async <T,>(name: string, ...args: unknown[]) => {
      const handler = handlers[name] as ((...a: unknown[]) => unknown) | undefined;
      if (!handler) throw new Error(`Mock backend has no '${name}'`);
      return (await handler(...args)) as T;
    },
    on: (event, fn) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn as Listener);
      listeners.set(event, set);
      return () => set.delete(fn as Listener);
    },
  };
}
