import logoUrl from "../assets/obsidian-player-logo.jpg";
import { ParamKnob } from "../components/ParamKnob";
import { formatPercent } from "../lib/format";
import { OutputMeter } from "./OutputMeter";
import { PresetBrowser } from "./PresetBrowser";

export function Header() {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900 px-6 py-2">
      <div className="flex shrink-0 items-center justify-start gap-2">
        {/* The logo is white on black; "screen" blending drops the black background. */}
        <img src={logoUrl} alt="Obsidian Player" className="pointer-events-none h-10 w-auto select-none object-contain mix-blend-screen" />
      </div>

      <PresetBrowser />

      <div className="flex items-start gap-3 pt-1">
        <OutputMeter />
        <div className="flex h-16 shrink-0 origin-top scale-90 items-start">
          <ParamKnob param="masterGain" label="Master" step={0.01} format={formatPercent} />
        </div>
      </div>
    </div>
  );
}
