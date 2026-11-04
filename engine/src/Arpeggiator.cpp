#include "obsidian/Arpeggiator.h"

#include <algorithm>

namespace obsidian
{

bool NoteList::contains (int note) const noexcept
{
    return std::find (notes, notes + size, note) != notes + size;
}

void NoteList::add (int note) noexcept
{
    if (size < capacity && ! contains (note))
        notes[size++] = note;
}

void NoteList::remove (int note) noexcept
{
    auto* end = std::remove (notes, notes + size, note);
    size = static_cast<int> (end - notes);
}

void buildArpSequence (const NoteList& held, int octaves, ArpPattern pattern, NoteList& out) noexcept
{
    out.clear();

    int sorted[NoteList::capacity];
    std::copy (held.notes, held.notes + held.size, sorted);
    std::sort (sorted, sorted + held.size);

    for (int octave = 0; octave < std::max (1, octaves); ++octave)
        for (int i = 0; i < held.size && out.size < NoteList::capacity; ++i)
            out.notes[out.size++] = std::clamp (sorted[i] + octave * 12, 0, 127);

    if (pattern == ArpPattern::Down)
    {
        std::reverse (out.notes, out.notes + out.size);
    }
    else if (pattern == ArpPattern::UpDown && out.size > 2)
    {
        // Up, then back down without repeating either end: 1 2 3 4 -> 1 2 3 4 3 2
        const int upLength = out.size;
        for (int i = upLength - 2; i >= 1 && out.size < NoteList::capacity; --i)
            out.notes[out.size++] = out.notes[i];
    }
}

} // namespace obsidian
