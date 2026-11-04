import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { MasterTab } from "./bridge/types";
import { ArpeggiatorDeck } from "./decks/arpeggiator/ArpeggiatorDeck";
import { EnvelopesDeck } from "./decks/envelopes/EnvelopesDeck";
import { FiltersDeck } from "./decks/filters/FiltersDeck";
import { PlaybackDeck } from "./decks/playback/PlaybackDeck";
import { SequencerDeck } from "./decks/sequencer/SequencerDeck";
import { useComputerKeyboard } from "./hooks/useComputerKeyboard";
import { Header } from "./layout/Header";
import { MasterTabBar } from "./layout/MasterTabBar";
import { connectToPlugin, usePluginStore } from "./state/pluginStore";

// Must match ObsidianPlayerEditor::designWidth / designHeight; the plugin window keeps this aspect ratio.
const DESIGN_WIDTH = 1024;
const DESIGN_HEIGHT = 600;

/** Scales the fixed-size design to fill the (resizable) plugin window. */
function useWindowScale() {
  const compute = () => Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  const [scale, setScale] = useState(compute);
  useEffect(() => {
    const onResize = () => setScale(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

/** Stops the web view from navigating to files dropped outside a drop zone. */
function usePreventStrayDrops() {
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);
}

function ErrorBanner() {
  const error = usePluginStore((s) => s.lastError);
  const showError = usePluginStore((s) => s.showError);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => showError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error, showError]);

  if (!error) return null;
  return (
    <div className="absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-red-900/60 bg-zinc-900 px-3 py-2 text-xs text-red-300 shadow-2xl">
      <span>{error}</span>
      <button onClick={() => showError(null)} className="text-zinc-500 hover:text-zinc-200">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Workspace({ tab }: { tab: MasterTab }) {
  switch (tab) {
    case "playback": return <PlaybackDeck />;
    case "envelopes": return <EnvelopesDeck />;
    case "filters": return <FiltersDeck />;
    case "sequencer": return <SequencerDeck />;
    case "arpeggiator": return <ArpeggiatorDeck />;
  }
}

export default function App() {
  const scale = useWindowScale();
  useEffect(connectToPlugin, []);
  useComputerKeyboard();
  usePreventStrayDrops();

  const ready = usePluginStore((s) => s.ready);
  const tab = usePluginStore((s) => s.ui.tab);
  const updateUi = usePluginStore((s) => s.updateUi);
  const hasSample = usePluginStore((s) => s.samples.main !== null);
  const isOneShot = usePluginStore((s) => s.params.playbackMode < 0.5);
  const lpfEnabled = usePluginStore((s) => s.params.lpfEnabled >= 0.5);
  const hpfEnabled = usePluginStore((s) => s.params.hpfEnabled >= 0.5);
  const sequencerEnabled = usePluginStore((s) => s.params.seqEnabled >= 0.5);
  const arpEnabled = usePluginStore((s) => s.params.arpEnabled >= 0.5);
  const setParam = usePluginStore((s) => s.setParam);
  const setSequencerManualRun = usePluginStore((s) => s.setSequencerManualRun);

  // The sequencer and arpeggiator tabs need a sample; the arpeggiator also needs one-shot mode.
  const visibleTab: MasterTab =
    (!hasSample && (tab === "sequencer" || tab === "arpeggiator")) || (tab === "arpeggiator" && !isOneShot) ? "playback" : tab;

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 font-sans text-zinc-100">
      <div
        className="relative flex origin-top-left select-none flex-col overflow-hidden border border-zinc-800 bg-zinc-900"
        style={{ width: DESIGN_WIDTH, height: DESIGN_HEIGHT, transform: `scale(${scale})` }}
      >
        <Header />
        <MasterTabBar
          tab={visibleTab}
          onSelectTab={(t) => updateUi({ tab: t })}
          hasSample={hasSample}
          isOneShot={isOneShot}
          filtersActive={lpfEnabled || hpfEnabled}
          onToggleFilters={() => {
            // The tab LED bypasses both filters, or brings the low-pass back.
            if (lpfEnabled || hpfEnabled) {
              setParam("lpfEnabled", 0);
              setParam("hpfEnabled", 0);
            } else {
              setParam("lpfEnabled", 1);
            }
          }}
          sequencerEnabled={sequencerEnabled}
          onToggleSequencer={() => {
            if (sequencerEnabled) setSequencerManualRun(false);
            setParam("seqEnabled", sequencerEnabled ? 0 : 1);
          }}
          arpEnabled={arpEnabled}
          onToggleArp={() => setParam("arpEnabled", arpEnabled ? 0 : 1)}
        />
        <div className="min-h-0 w-full flex-1 overflow-hidden">{ready && <Workspace tab={visibleTab} />}</div>
        <ErrorBanner />
      </div>
    </div>
  );
}
