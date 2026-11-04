const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS: Record<string, string> = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#" };

/** 60 -> "C4" */
export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

/** "C4", "c#3", "Eb2" -> MIDI note number, or null if it isn't a note name. */
export function noteNameToMidi(name: string): number | null {
  const match = name.trim().match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return null;

  const raw = match[1].toUpperCase();
  const index = NOTE_NAMES.indexOf(FLATS[raw] ?? raw);
  if (index === -1) return null;

  return (parseInt(match[2], 10) + 1) * 12 + index;
}
