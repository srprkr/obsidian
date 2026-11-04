#pragma once

#include <juce_core/juce_core.h>
#include <obsidian/EngineParams.h>

/**
    Converts the step pattern to and from the JSON shape the UI uses:
    [ { "split": bool, "first": { "on", "velocity", "pitchOffset", "pan" }, "second": {...} }, ... ]
*/
namespace PatternSerialization
{
    juce::var toVar (const obsidian::StepPattern& pattern);

    /** Missing or malformed fields fall back to defaults; values are clamped to valid ranges. */
    obsidian::StepPattern fromVar (const juce::var& value);
}
