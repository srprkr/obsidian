#pragma once

#include <juce_audio_formats/juce_audio_formats.h>
#include <obsidian/SampleData.h>

/** A loaded sample plus the min/max overview the UI draws. */
struct LoadedSample
{
    obsidian::SamplePtr data;
    std::vector<float> peaks; // interleaved min, max pairs of channel 0

    juce::var toVar() const;  // description sent to the UI (null when empty)
};

/** Decodes audio files and keeps copies of files dropped onto the UI. */
class SampleLibrary
{
public:
    SampleLibrary();

    /** Wildcard for the file chooser, e.g. "*.wav;*.aiff;..." */
    juce::String getSupportedWildcard() const;

    /** Decodes a file. Returns an empty sample and sets `error` on failure. */
    LoadedSample load (const juce::File& file, juce::String& error) const;

    /**
        Saves raw bytes from a file dropped onto the web UI (the browser cannot reveal the
        original path), so the copy can be reloaded with the session later.
    */
    juce::File storeImportedFile (const juce::String& fileName, const juce::MemoryBlock& bytes) const;

    static juce::File getImportFolder();

private:
    mutable juce::AudioFormatManager formats; // createReaderFor() is non-const
};
