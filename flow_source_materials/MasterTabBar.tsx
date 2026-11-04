import React from "react";

export interface MasterTabBarProps {
  masterTab: "playback" | "envelopes" | "filters" | "sequencer" | "arpeggiator";
  setMasterTab: (tab: "playback" | "envelopes" | "filters" | "sequencer" | "arpeggiator") => void;
  playbackMode?: "oneshot" | "loop";
  hasSample?: boolean;
  filtersActive?: boolean;
  onToggleFilters?: () => void;
  sequencerEnabled: boolean;
  setSequencerEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  arpeggiatorEnabled: boolean;
  setArpeggiatorEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  onDisableSequencer?: () => void;
}

export function MasterTabBar({
  masterTab,
  setMasterTab,
  playbackMode = "oneshot",
  hasSample = false,
  filtersActive = false,
  onToggleFilters,
  sequencerEnabled,
  setSequencerEnabled,
  arpeggiatorEnabled,
  setArpeggiatorEnabled,
  onDisableSequencer,
}: MasterTabBarProps) {
  return (
    <div className="w-full py-1.5 flex items-center justify-center select-none">
      <div className="flex items-center gap-1.5 p-1 bg-zinc-950/90 rounded-xl border border-zinc-800 shadow-md">
        {/* 1. PLAYBACK */}
        <button
          onClick={() => setMasterTab("playback")}
          className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
            masterTab === "playback"
              ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          PLAYBACK
        </button>

        {/* 2. ENVELOPES (Moved to second after Playback) */}
        <button
          onClick={() => setMasterTab("envelopes")}
          className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
            masterTab === "envelopes"
              ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          ENVELOPES
        </button>

        {/* 3. SEQUENCER with Enable / Disable Bypass Dot (Only when sample is loaded) */}
        {hasSample && (
          <div
            className={`flex items-center rounded-lg transition border ${
              masterTab === "sequencer"
                ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-850"
            }`}
          >
            <button
              onClick={() => setMasterTab("sequencer")}
              className="pl-3.5 pr-1.5 py-2 text-xs font-bold uppercase tracking-wider"
            >
              SEQUENCER
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSequencerEnabled((prev) => {
                  const next = !prev;
                  if (!next && onDisableSequencer) onDisableSequencer();
                  return next;
                });
              }}
              title={sequencerEnabled ? "Disable Sequencer (Bypass)" : "Enable Sequencer"}
              className="pr-2.5 pl-1 py-2 flex items-center justify-center group"
            >
              <span
                className={`w-2 h-2 rounded-full transition-all ${
                  sequencerEnabled
                    ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                    : "bg-zinc-600 group-hover:bg-zinc-500"
                }`}
              />
            </button>
          </div>
        )}

        {/* 4. ARPEGGIATOR with Enable / Disable Bypass Dot (Only when sample is loaded in One-Shot Mode) */}
        {hasSample && playbackMode === "oneshot" && (
          <div
            className={`flex items-center rounded-lg transition border ${
              masterTab === "arpeggiator"
                ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-850"
            }`}
          >
            <button
              onClick={() => setMasterTab("arpeggiator")}
              className="pl-3.5 pr-1.5 py-2 text-xs font-bold uppercase tracking-wider"
            >
              ARPEGGIATOR
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setArpeggiatorEnabled((prev) => !prev);
              }}
              title={arpeggiatorEnabled ? "Disable Arpeggiator (Bypass)" : "Enable Arpeggiator"}
              className="pr-2.5 pl-1 py-2 flex items-center justify-center group"
            >
              <span
                className={`w-2 h-2 rounded-full transition-all ${
                  arpeggiatorEnabled
                    ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                    : "bg-zinc-600 group-hover:bg-zinc-500"
                }`}
              />
            </button>
          </div>
        )}

        {/* 5. FILTERS (Last, with Enable / Disable Bypass Dot) */}
        <div
          className={`flex items-center rounded-lg transition border ${
            masterTab === "filters"
              ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-850"
          }`}
        >
          <button
            onClick={() => setMasterTab("filters")}
            className="pl-3.5 pr-1.5 py-2 text-xs font-bold uppercase tracking-wider"
          >
            FILTERS
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleFilters) onToggleFilters();
            }}
            title={filtersActive ? "Disable Filters (Bypass)" : "Enable Filters"}
            className="pr-2.5 pl-1 py-2 flex items-center justify-center group"
          >
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                filtersActive
                  ? "bg-zinc-200 shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                  : "bg-zinc-600 group-hover:bg-zinc-500"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

export function RateSelector({ rate, setRate }: { rate: number; setRate: (r: number) => void }) {
  return (
    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 select-none">
      <span className="text-[10px] text-zinc-500 font-bold uppercase">Rate:</span>
      {[0.5, 1, 2].map((r) => (
        <button
          key={r}
          onClick={() => setRate(r)}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition ${
            rate === r
              ? "bg-zinc-750 text-white shadow-sm border border-zinc-600"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {r}x
        </button>
      ))}
    </div>
  );
}