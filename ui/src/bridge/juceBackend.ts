// Minimal client for JUCE's WebBrowserComponent native integration.
//
// JUCE injects `window.__JUCE__` into the page. Native functions are invoked by emitting a
// "__juce__invoke" event and resolved by a matching "__juce__complete" event; this mirrors
// JUCE's own frontend library (modules/juce_gui_extra/native/javascript/index.js).

interface JuceBackendObject {
  addEventListener(eventId: string, fn: (payload: unknown) => void): [string, number];
  removeEventListener(token: [string, number]): void;
  emitEvent(eventId: string, payload: unknown): void;
}

interface JuceGlobal {
  backend: JuceBackendObject;
  initialisationData: { __juce__functions?: string[] } & Record<string, unknown>;
}

declare global {
  interface Window {
    __JUCE__?: JuceGlobal;
  }
}

export function isRunningInPlugin(): boolean {
  return typeof window !== "undefined" && window.__JUCE__ !== undefined;
}

let nextPromiseId = 0;
const pending = new Map<number, (result: unknown) => void>();
let completionListenerInstalled = false;

function juce(): JuceGlobal {
  const value = window.__JUCE__;
  if (!value) throw new Error("JUCE native integration is not available");
  return value;
}

function ensureCompletionListener() {
  if (completionListenerInstalled) return;
  completionListenerInstalled = true;

  juce().backend.addEventListener("__juce__complete", (payload) => {
    const { promiseId, result } = payload as { promiseId: number; result: unknown };
    const resolve = pending.get(promiseId);
    if (resolve) {
      pending.delete(promiseId);
      resolve(result);
    }
  });
}

export function callNative<T = unknown>(name: string, ...params: unknown[]): Promise<T> {
  ensureCompletionListener();

  const known = juce().initialisationData.__juce__functions;
  if (known && !known.includes(name)) {
    console.warn(`Native function '${name}' is not registered by the plugin`);
  }

  const promiseId = nextPromiseId++;
  const result = new Promise<T>((resolve) => pending.set(promiseId, resolve as (r: unknown) => void));
  juce().backend.emitEvent("__juce__invoke", { name, params, resultId: promiseId });
  return result;
}

export function onNativeEvent<T = unknown>(eventId: string, fn: (payload: T) => void): () => void {
  const token = juce().backend.addEventListener(eventId, fn as (payload: unknown) => void);
  return () => juce().backend.removeEventListener(token);
}
