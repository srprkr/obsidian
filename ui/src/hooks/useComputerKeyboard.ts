import { useEffect } from "react";
import { pluginApi } from "../bridge/api";
import { usePluginStore } from "../state/pluginStore";

// Play the sampler from the computer keyboard when the plugin window has focus:
// A W S E D F T G Y H U J K = C4..C5, Z X C V B = C3 D3 E3 F3 G3, Space = root note.
const KEY_TO_NOTE: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
  z: 48, x: 50, c: 52, v: 53, b: 55,
};

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function useComputerKeyboard() {
  useEffect(() => {
    const down = new Map<string, number>(); // key -> note it started (root may change while held)

    const noteFor = (key: string) =>
      key === " " ? usePluginStore.getState().params.rootNote : KEY_TO_NOTE[key];

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const note = noteFor(key);
      if (note === undefined || down.has(key)) return;
      if (key === " ") e.preventDefault();
      down.set(key, note);
      void pluginApi.noteOn(note, 100);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const note = down.get(key);
      if (note === undefined) return;
      down.delete(key);
      void pluginApi.noteOff(note);
    };

    // Losing focus would leave notes hanging.
    const releaseAll = () => {
      down.forEach((note) => void pluginApi.noteOff(note));
      down.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, []);
}
