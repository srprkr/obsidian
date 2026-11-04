#pragma once

#include "EngineParams.h"

namespace obsidian
{

/** Fixed-capacity list of MIDI notes, safe to use on the audio thread. */
struct NoteList
{
    static constexpr int capacity = 128;
    int notes[capacity] {};
    int size = 0;

    void clear() noexcept { size = 0; }
    bool contains (int note) const noexcept;
    void add (int note) noexcept;    // ignores duplicates
    void remove (int note) noexcept; // keeps insertion order
};

/**
    Expands the held notes into the arpeggio's note order:
      notes are sorted, repeated up `octaves` octaves, then arranged by pattern.
      UpDown does not repeat the top and bottom notes. Random and Chord return the Up order
      (the engine picks a random entry / plays all of them).
*/
void buildArpSequence (const NoteList& held, int octaves, ArpPattern pattern, NoteList& out) noexcept;

} // namespace obsidian
