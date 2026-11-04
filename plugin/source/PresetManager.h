#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <obsidian/EngineParams.h>

/**
    User presets, stored as JSON files in Documents/Obsidian Player/Presets.

    A preset holds every parameter and the step pattern. Samples are not stored, matching the
    original app: presets are "settings", the sample stays loaded.
*/
class PresetManager
{
public:
    struct Preset
    {
        juce::String id; // file name without extension
        juce::String name;
        bool favorite = false;
    };

    explicit PresetManager (juce::AudioProcessorValueTreeState& state);

    static juce::File getPresetFolder();

    juce::Array<Preset> list() const;

    /** Saves the current settings. Returns the new preset id, or an empty string on failure. */
    juce::String save (const juce::String& name, const obsidian::StepPattern& pattern);

    /** Applies a preset's parameters and returns its pattern. */
    std::optional<obsidian::StepPattern> load (const juce::String& id);

    bool setFavorite (const juce::String& id, bool favorite);
    bool remove (const juce::String& id);

    juce::String getCurrentPresetId() const { return currentId; }
    void setCurrentPresetId (const juce::String& id) { currentId = id; }

private:
    juce::File fileFor (const juce::String& id) const;

    juce::AudioProcessorValueTreeState& state;
    juce::String currentId;
};
