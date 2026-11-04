import { useCallback, useMemo } from "react";
import type { ParameterInfo } from "../bridge/types";
import type { ParamId } from "./parameterIds";
import { usePluginStore } from "./pluginStore";

export interface ParamControl {
  value: number;
  info: ParameterInfo;
  set: (value: number) => void;
  beginGesture: () => void;
  endGesture: () => void;
}

/** Everything a control needs to drive one plugin parameter. */
export function useParam(id: ParamId): ParamControl {
  const value = usePluginStore((s) => s.params[id]);
  const info = usePluginStore((s) => s.paramInfo[id]);
  const setParam = usePluginStore((s) => s.setParam);
  const begin = usePluginStore((s) => s.beginGesture);
  const end = usePluginStore((s) => s.endGesture);

  const set = useCallback((v: number) => setParam(id, v), [id, setParam]);
  const beginGesture = useCallback(() => begin(id), [id, begin]);
  const endGesture = useCallback(() => end(id), [id, end]);

  return useMemo(() => ({ value, info, set, beginGesture, endGesture }), [value, info, set, beginGesture, endGesture]);
}

/** Boolean parameter as [value, setter]. */
export function useToggleParam(id: ParamId): [boolean, (on: boolean) => void] {
  const { value, set } = useParam(id);
  return [value >= 0.5, useCallback((on: boolean) => set(on ? 1 : 0), [set])];
}

/** Choice parameter mapped onto a typed list of options. */
export function useChoiceParam<T>(id: ParamId, options: readonly T[]): [T, (option: T) => void] {
  const { value, set } = useParam(id);
  const index = Math.min(options.length - 1, Math.max(0, Math.round(value)));
  const select = useCallback((option: T) => set(Math.max(0, options.indexOf(option))), [options, set]);
  return [options[index], select];
}
