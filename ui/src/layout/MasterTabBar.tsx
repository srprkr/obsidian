import type { MasterTab } from "../bridge/types";
import { StatusDot } from "../components/controls";

interface TabProps {
  label: string;
  active: boolean;
  onSelect: () => void;
}

interface ToggleTabProps extends TabProps {
  enabled: boolean;
  onToggleEnabled: () => void;
  enabledTitle: string;
  disabledTitle: string;
  tone?: "emerald" | "white";
}

function Tab({ label, active, onSelect }: TabProps) {
  return (
    <button
      onClick={onSelect}
      className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
        active ? "border-zinc-700 bg-zinc-800 text-white shadow-sm" : "border-transparent text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

/** A tab with an LED button that enables / bypasses the section. */
function ToggleTab({ label, active, onSelect, enabled, onToggleEnabled, enabledTitle, disabledTitle, tone = "emerald" }: ToggleTabProps) {
  return (
    <div
      className={`flex items-center rounded-lg border transition ${
        active ? "border-zinc-700 bg-zinc-800 text-white shadow-sm" : "border-transparent text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200"
      }`}
    >
      <button onClick={onSelect} className="py-2 pl-3.5 pr-1.5 text-xs font-bold uppercase tracking-wider">
        {label}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleEnabled();
        }}
        title={enabled ? enabledTitle : disabledTitle}
        className="flex items-center justify-center py-2 pl-1 pr-2.5"
      >
        <StatusDot on={enabled} tone={tone} size="md" />
      </button>
    </div>
  );
}

export interface MasterTabBarProps {
  tab: MasterTab;
  onSelectTab: (tab: MasterTab) => void;
  hasSample: boolean;
  isOneShot: boolean;
  filtersActive: boolean;
  onToggleFilters: () => void;
  sequencerEnabled: boolean;
  onToggleSequencer: () => void;
  arpEnabled: boolean;
  onToggleArp: () => void;
}

export function MasterTabBar(props: MasterTabBarProps) {
  const { tab, onSelectTab, hasSample, isOneShot } = props;

  return (
    <div className="flex w-full select-none items-center justify-center py-1.5">
      <div className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/90 p-1 shadow-md">
        <Tab label="Playback" active={tab === "playback"} onSelect={() => onSelectTab("playback")} />
        <Tab label="Envelopes" active={tab === "envelopes"} onSelect={() => onSelectTab("envelopes")} />

        {hasSample && (
          <ToggleTab
            label="Sequencer"
            active={tab === "sequencer"}
            onSelect={() => onSelectTab("sequencer")}
            enabled={props.sequencerEnabled}
            onToggleEnabled={props.onToggleSequencer}
            enabledTitle="Disable Sequencer (Bypass)"
            disabledTitle="Enable Sequencer"
          />
        )}

        {/* The arpeggiator only works with one-shot playback. */}
        {hasSample && isOneShot && (
          <ToggleTab
            label="Arpeggiator"
            active={tab === "arpeggiator"}
            onSelect={() => onSelectTab("arpeggiator")}
            enabled={props.arpEnabled}
            onToggleEnabled={props.onToggleArp}
            enabledTitle="Disable Arpeggiator (Bypass)"
            disabledTitle="Enable Arpeggiator"
          />
        )}

        <ToggleTab
          label="Filters"
          active={tab === "filters"}
          onSelect={() => onSelectTab("filters")}
          enabled={props.filtersActive}
          onToggleEnabled={props.onToggleFilters}
          enabledTitle="Disable Filters (Bypass)"
          disabledTitle="Enable Filters"
          tone="white"
        />
      </div>
    </div>
  );
}
