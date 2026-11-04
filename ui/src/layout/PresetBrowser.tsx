import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, Star, Trash2, X } from "lucide-react";
import { pluginApi } from "../bridge/api";
import type { PresetList } from "../bridge/types";
import { useDismiss } from "../hooks/useDismiss";
import { usePluginStore } from "../state/pluginStore";

function isPresetList(value: unknown): value is PresetList {
  return typeof value === "object" && value !== null && "items" in value;
}

/** Preset name pill with previous/next arrows, a searchable dropdown and "save new". */
export function PresetBrowser() {
  const presets = usePluginStore((s) => s.presets);
  const setPresets = usePluginStore((s) => s.setPresets);
  const showError = usePluginStore((s) => s.showError);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null); // web views have no confirm()
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setConfirmDeleteId(null);
  }, []);
  useDismiss(menuRef, open, close);

  const { items, currentId } = presets;
  const current = items.find((p) => p.id === currentId);

  const load = async (id: string) => {
    const result = await pluginApi.loadPreset(id);
    if (!result.ok) showError(result.error ?? "Preset could not be loaded");
    setPresets({ items, currentId: result.ok ? id : currentId });
  };

  const step = (direction: 1 | -1) => {
    if (items.length === 0) return;
    const index = items.findIndex((p) => p.id === currentId);
    const next = items[(index + direction + items.length) % items.length];
    void load(next.id);
  };

  const filtered = items.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={() => step(-1)}
        disabled={items.length === 0}
        title="Previous preset"
        className="rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-[170px] items-center justify-between gap-2 rounded border border-zinc-700 bg-zinc-800/90 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-750"
        >
          <span className="truncate">{current?.name ?? (items.length > 0 ? "Select Preset" : "No Presets")}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 flex w-72 flex-col gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-2xl">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Search presets..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-500 outline-none"
              />
            </div>

            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="py-4 text-center text-xs text-zinc-500">
                  {items.length === 0 ? "No presets saved yet." : "No matching presets."}
                </div>
              ) : (
                filtered.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => {
                      void load(preset.id);
                      setOpen(false);
                    }}
                    className={`group flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-xs transition ${
                      preset.id === currentId ? "bg-zinc-800 font-medium text-white" : "text-zinc-300 hover:bg-zinc-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <button
                        title={preset.favorite ? "Remove from favourites" : "Add to favourites"}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setPresets(await pluginApi.setPresetFavorite(preset.id, !preset.favorite));
                        }}
                        className="text-zinc-500 hover:text-yellow-400"
                      >
                        <Star className={`h-3.5 w-3.5 ${preset.favorite ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      </button>
                      <span className="truncate">{preset.name}</span>
                    </div>
                    <button
                      title={confirmDeleteId === preset.id ? "Click again to delete" : "Delete preset"}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirmDeleteId !== preset.id) {
                          setConfirmDeleteId(preset.id);
                          return;
                        }
                        setConfirmDeleteId(null);
                        setPresets(await pluginApi.deletePreset(preset.id));
                      }}
                      className={`flex items-center gap-1 transition ${
                        confirmDeleteId === preset.id
                          ? "text-red-400"
                          : "text-zinc-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
                      }`}
                    >
                      {confirmDeleteId === preset.id && <span className="text-[10px] font-semibold">Delete?</span>}
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
              <button
                onClick={() => {
                  setOpen(false);
                  setSaving(true);
                }}
                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Save New Preset</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => step(1)}
        disabled={items.length === 0}
        title="Next preset"
        className="rounded border border-zinc-700 bg-zinc-800 p-1 text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-40"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      {saving && (
        <SavePresetDialog
          onCancel={() => setSaving(false)}
          onSave={async (name) => {
            const result = await pluginApi.savePreset(name);
            if (isPresetList(result)) setPresets(result);
            else showError(result.error ?? "Could not save the preset");
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}

function SavePresetDialog({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const submit = () => name.trim() && onSave(name.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-100">Save Custom Preset</span>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-400" htmlFor="preset-name">Preset Name</label>
          <input
            id="preset-name"
            autoFocus
            type="text"
            placeholder="My New Preset"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            }}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded bg-zinc-700 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-600 disabled:opacity-40"
          >
            Save Preset
          </button>
        </div>
      </div>
    </div>
  );
}
