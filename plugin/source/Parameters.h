#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <obsidian/EngineParams.h>

/** Parameter IDs. The React UI uses the same strings (ui/src/state/parameterIds.ts). */
namespace ParamIds
{
    inline constexpr const char* masterGain           = "masterGain";

    inline constexpr const char* playbackMode         = "playbackMode";
    inline constexpr const char* startPos             = "startPos";
    inline constexpr const char* endPos               = "endPos";
    inline constexpr const char* loopStartPos         = "loopStartPos";
    inline constexpr const char* loopEndPos           = "loopEndPos";
    inline constexpr const char* loopCrossfade        = "loopCrossfade";
    inline constexpr const char* rootNote             = "rootNote";
    inline constexpr const char* preserveSpeed        = "preserveSpeed";
    inline constexpr const char* tempoSync            = "tempoSync";
    inline constexpr const char* sampleBpm            = "sampleBpm";

    inline constexpr const char* releaseTrigEnabled   = "releaseTrigEnabled";
    inline constexpr const char* releaseTrigPos       = "releaseTrigPos";
    inline constexpr const char* releaseTrigGain      = "releaseTrigGain";

    inline constexpr const char* attack               = "attack";
    inline constexpr const char* decay                = "decay";
    inline constexpr const char* sustain              = "sustain";
    inline constexpr const char* release              = "release";

    inline constexpr const char* hpfEnabled           = "hpfEnabled";
    inline constexpr const char* hpfCutoff            = "hpfCutoff";
    inline constexpr const char* hpfResonance         = "hpfResonance";
    inline constexpr const char* hpfSlope             = "hpfSlope";
    inline constexpr const char* lpfEnabled           = "lpfEnabled";
    inline constexpr const char* lpfCutoff            = "lpfCutoff";
    inline constexpr const char* lpfResonance         = "lpfResonance";
    inline constexpr const char* lpfSlope             = "lpfSlope";

    inline constexpr const char* seqEnabled           = "seqEnabled";
    inline constexpr const char* seqSteps             = "seqSteps";
    inline constexpr const char* seqRate              = "seqRate";
    inline constexpr const char* seqSync              = "seqSync";
    inline constexpr const char* seqBpm               = "seqBpm";

    inline constexpr const char* arpEnabled           = "arpEnabled";
    inline constexpr const char* arpDivision          = "arpDivision";
    inline constexpr const char* arpPattern           = "arpPattern";
    inline constexpr const char* arpOctaves           = "arpOctaves";
    inline constexpr const char* arpRate              = "arpRate";
    inline constexpr const char* arpGate              = "arpGate";
} // namespace ParamIds

juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

/** Lock-free reader that turns the current parameter values into an engine snapshot. */
class ParameterSnapshot
{
public:
    explicit ParameterSnapshot (juce::AudioProcessorValueTreeState& state);
    ~ParameterSnapshot();

    obsidian::EngineParams read() const noexcept;

private:
    struct Raw;
    std::unique_ptr<Raw> raw;
};
