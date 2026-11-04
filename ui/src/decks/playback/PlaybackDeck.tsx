import { Panel, VerticalDivider } from "../../components/controls";
import { usePluginStore } from "../../state/pluginStore";
import { PlaybackToolbar } from "./PlaybackToolbar";
import { LoopRegion, OneShotRegion } from "./RegionControls";
import { ReleaseTriggerSection } from "./ReleaseTriggerSection";
import { WaveformView } from "./WaveformView";

/** The Playback tab: waveform editor plus region, loop and release-trigger controls. */
export function PlaybackDeck() {
  const sample = usePluginStore((s) => s.samples.main);
  const isLoop = usePluginStore((s) => s.params.playbackMode >= 0.5);
  const expanded = usePluginStore((s) => s.ui.expandedWaveform);

  const waveformHeight = !sample ? "min-h-[380px] flex-1" : expanded ? "h-64" : "h-44";

  return (
    <div className="flex h-full w-full flex-col justify-between gap-3 px-6 py-3.5">
      <PlaybackToolbar />
      <WaveformView heightClass={waveformHeight} />

      {sample && (
        <div className="flex flex-col items-center px-6">
          <Panel className="flex h-[175px] w-full max-w-3xl items-center justify-center p-4">
            <div className={`flex h-full items-start justify-center pt-1 ${isLoop ? "gap-5" : "gap-8"}`}>
              {isLoop ? <LoopRegion duration={sample.durationSec} /> : <OneShotRegion duration={sample.durationSec} />}
              <VerticalDivider />
              <ReleaseTriggerSection />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
