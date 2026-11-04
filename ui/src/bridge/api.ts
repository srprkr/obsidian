// Typed API to the plugin. Inside the plugin this talks to JUCE; in a normal browser
// (`npm run dev`) it falls back to an in-memory mock so the UI can be developed standalone.

import type {
  InitialState,
  OperationResult,
  PresetList,
  SampleSlot,
  SampleSlots,
  StepPattern,
  Telemetry,
  UiState,
} from "./types";
import type { ParamId } from "../state/parameterIds";
import { callNative, isRunningInPlugin, onNativeEvent } from "./juceBackend";
import { createMockBackend } from "./mockBackend";

export interface PluginEvents {
  parameters: Partial<Record<ParamId, number>>;
  telemetry: Telemetry;
  samples: SampleSlots;
  stateReplaced: unknown;
}

export interface Backend {
  call<T>(name: string, ...params: unknown[]): Promise<T>;
  on<K extends keyof PluginEvents>(event: K, fn: (payload: PluginEvents[K]) => void): () => void;
}

const backend: Backend = isRunningInPlugin()
  ? { call: callNative, on: (event, fn) => onNativeEvent(event, fn as (p: unknown) => void) }
  : createMockBackend();

export const pluginApi = {
  isMock: !isRunningInPlugin(),

  getInitialState: () => backend.call<InitialState>("getInitialState"),
  setUiState: (state: UiState) => backend.call<void>("setUiState", state),

  setParameter: (id: ParamId, value: number) => backend.call<void>("setParameter", id, value),
  beginGesture: (id: ParamId) => backend.call<void>("beginGesture", id),
  endGesture: (id: ParamId) => backend.call<void>("endGesture", id),

  setPattern: (pattern: StepPattern) => backend.call<void>("setPattern", pattern),

  browseForSample: (slot: SampleSlot) => backend.call<OperationResult>("browseForSample", slot),
  loadDroppedSample: (slot: SampleSlot, fileName: string, base64: string) =>
    backend.call<OperationResult>("loadDroppedSample", slot, fileName, base64),
  clearSample: (slot: SampleSlot) => backend.call<void>("clearSample", slot),

  noteOn: (note: number, velocity = 100) => backend.call<void>("noteOn", note, velocity),
  noteOff: (note: number) => backend.call<void>("noteOff", note),
  allNotesOff: () => backend.call<void>("allNotesOff"),
  audition: (note: number, velocity: number, pan: number) => backend.call<void>("audition", note, velocity, pan),
  setSequencerRunning: (running: boolean) => backend.call<void>("setSequencerRunning", running),

  listPresets: () => backend.call<PresetList>("listPresets"),
  savePreset: (name: string) => backend.call<PresetList | OperationResult>("savePreset", name),
  loadPreset: (id: string) => backend.call<OperationResult>("loadPreset", id),
  setPresetFavorite: (id: string, favorite: boolean) => backend.call<PresetList>("setPresetFavorite", id, favorite),
  deletePreset: (id: string) => backend.call<PresetList>("deletePreset", id),

  on: backend.on,
};
