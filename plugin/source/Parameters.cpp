#include "Parameters.h"

using namespace juce;
using APVTS = AudioProcessorValueTreeState;

namespace
{
    const StringArray playbackModeChoices { "One Shot", "Loop" };
    const StringArray slopeChoices { "12 dB", "18 dB", "24 dB" };
    const StringArray stepCountChoices { "8", "16" };
    const StringArray rateChoices { "0.5x", "1x", "2x" };
    const StringArray arpDivisionChoices { "1/4", "1/8", "1/16", "1/32" };
    const StringArray arpPatternChoices { "Up", "Down", "Up/Down", "Random", "Chord" };

    constexpr float rateValues[] { 0.5f, 1.0f, 2.0f };
    constexpr float arpDivisionBeats[] { 1.0f, 0.5f, 0.25f, 0.125f };
    constexpr int stepCounts[] { 8, 16 };

    ParameterID id (const char* name) { return { name, 1 }; }

    /** Range whose midpoint sits at `centre`, for knobs that need fine control at the low end. */
    NormalisableRange<float> skewedRange (float min, float max, float centre, float interval = 0.0f)
    {
        NormalisableRange<float> range { min, max, interval };
        range.setSkewForCentre (centre);
        return range;
    }

    NormalisableRange<float> logFrequencyRange()
    {
        // Exactly logarithmic 20 Hz .. 20 kHz, matching the UI's knob and graph mapping.
        return { 20.0f, 20000.0f,
                 [] (float, float, float norm) { return 20.0f * std::pow (1000.0f, norm); },
                 [] (float, float, float hz) { return std::log10 (jlimit (20.0f, 20000.0f, hz) / 20.0f) / 3.0f; },
                 [] (float, float, float hz) { return jlimit (20.0f, 20000.0f, (float) std::round (hz)); } };
    }

    auto seconds (int decimals)
    {
        return AudioParameterFloatAttributes().withLabel ("s").withStringFromValueFunction (
            [decimals] (float v, int) { return String (v, decimals) + " s"; });
    }

    auto percent()
    {
        return AudioParameterFloatAttributes().withStringFromValueFunction (
            [] (float v, int) { return String (roundToInt (v * 100.0f)) + "%"; });
    }

    auto hertz()
    {
        return AudioParameterFloatAttributes().withLabel ("Hz").withStringFromValueFunction (
            [] (float v, int) { return v >= 1000.0f ? String (v / 1000.0f, 2) + " kHz" : String (roundToInt (v)) + " Hz"; });
    }

    String midiNoteName (int note) { return MidiMessage::getMidiNoteName (note, true, true, 4); }
} // namespace

APVTS::ParameterLayout createParameterLayout()
{
    APVTS::ParameterLayout layout;

    auto output = std::make_unique<AudioProcessorParameterGroup> ("output", "Output", "|");
    output->addChild (std::make_unique<AudioParameterFloat> (id (ParamIds::masterGain), "Master", NormalisableRange<float> { 0.0f, 2.0f }, 1.0f, percent()));

    auto sample = std::make_unique<AudioProcessorParameterGroup> ("sample", "Sample", "|");
    sample->addChild (
        std::make_unique<AudioParameterChoice> (id (ParamIds::playbackMode), "Playback Mode", playbackModeChoices, 0),
        std::make_unique<AudioParameterFloat> (id (ParamIds::startPos), "Start", NormalisableRange<float> { 0.0f, 1.0f }, 0.0f, percent()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::endPos), "End", NormalisableRange<float> { 0.0f, 1.0f }, 1.0f, percent()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::loopStartPos), "Loop Start", NormalisableRange<float> { 0.0f, 1.0f }, 0.0f, percent()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::loopEndPos), "Loop End", NormalisableRange<float> { 0.0f, 1.0f }, 1.0f, percent()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::loopCrossfade), "Loop Crossfade", skewedRange (0.0f, 0.5f, 0.08f), 0.02f,
                                               AudioParameterFloatAttributes().withStringFromValueFunction ([] (float v, int) { return String (roundToInt (v * 1000.0f)) + " ms"; })),
        std::make_unique<AudioParameterInt> (id (ParamIds::rootNote), "Root Note", 24, 96, 60,
                                             AudioParameterIntAttributes().withStringFromValueFunction ([] (int v, int) { return midiNoteName (v); })),
        std::make_unique<AudioParameterBool> (id (ParamIds::preserveSpeed), "Preserve Speed", true),
        std::make_unique<AudioParameterBool> (id (ParamIds::tempoSync), "Sync To Host Tempo", true),
        std::make_unique<AudioParameterInt> (id (ParamIds::sampleBpm), "Sample BPM", 40, 240, 120));

    auto releaseTrigger = std::make_unique<AudioProcessorParameterGroup> ("releaseTrigger", "Release Trigger", "|");
    releaseTrigger->addChild (
        std::make_unique<AudioParameterBool> (id (ParamIds::releaseTrigEnabled), "Release Trigger", false),
        std::make_unique<AudioParameterFloat> (id (ParamIds::releaseTrigPos), "Release Trigger Position", NormalisableRange<float> { 0.0f, 1.0f }, 0.8f, percent()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::releaseTrigGain), "Release Trigger Volume", NormalisableRange<float> { 0.0f, 1.5f }, 1.0f, percent()));

    auto envelope = std::make_unique<AudioProcessorParameterGroup> ("envelope", "Envelope", "|");
    envelope->addChild (
        std::make_unique<AudioParameterFloat> (id (ParamIds::attack), "Attack", skewedRange (0.001f, 2.0f, 0.3f), 0.001f, seconds (3)),
        std::make_unique<AudioParameterFloat> (id (ParamIds::decay), "Decay", skewedRange (0.01f, 5.0f, 1.0f), 0.8f, seconds (2)),
        std::make_unique<AudioParameterFloat> (id (ParamIds::sustain), "Sustain", NormalisableRange<float> { 0.0f, 1.0f }, 0.8f, percent()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::release), "Release", skewedRange (0.01f, 5.0f, 1.0f), 0.5f, seconds (2)));

    auto filters = std::make_unique<AudioProcessorParameterGroup> ("filters", "Filters", "|");
    filters->addChild (
        std::make_unique<AudioParameterBool> (id (ParamIds::hpfEnabled), "High Pass", false),
        std::make_unique<AudioParameterFloat> (id (ParamIds::hpfCutoff), "High Pass Cutoff", logFrequencyRange(), 20.0f, hertz()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::hpfResonance), "High Pass Emphasis", NormalisableRange<float> { 0.1f, 10.0f, 0.1f }, 1.0f),
        std::make_unique<AudioParameterChoice> (id (ParamIds::hpfSlope), "High Pass Slope", slopeChoices, 0),
        std::make_unique<AudioParameterBool> (id (ParamIds::lpfEnabled), "Low Pass", false),
        std::make_unique<AudioParameterFloat> (id (ParamIds::lpfCutoff), "Low Pass Cutoff", logFrequencyRange(), 20000.0f, hertz()),
        std::make_unique<AudioParameterFloat> (id (ParamIds::lpfResonance), "Low Pass Emphasis", NormalisableRange<float> { 0.1f, 10.0f, 0.1f }, 1.0f),
        std::make_unique<AudioParameterChoice> (id (ParamIds::lpfSlope), "Low Pass Slope", slopeChoices, 2));

    auto sequencer = std::make_unique<AudioProcessorParameterGroup> ("sequencer", "Sequencer", "|");
    sequencer->addChild (
        std::make_unique<AudioParameterBool> (id (ParamIds::seqEnabled), "Sequencer", false),
        std::make_unique<AudioParameterChoice> (id (ParamIds::seqSteps), "Sequencer Steps", stepCountChoices, 0),
        std::make_unique<AudioParameterChoice> (id (ParamIds::seqRate), "Sequencer Rate", rateChoices, 1),
        std::make_unique<AudioParameterBool> (id (ParamIds::seqSync), "Sequencer Host Sync", true),
        std::make_unique<AudioParameterInt> (id (ParamIds::seqBpm), "Sequencer BPM", 40, 300, 120));

    auto arp = std::make_unique<AudioProcessorParameterGroup> ("arpeggiator", "Arpeggiator", "|");
    arp->addChild (
        std::make_unique<AudioParameterBool> (id (ParamIds::arpEnabled), "Arpeggiator", false),
        std::make_unique<AudioParameterChoice> (id (ParamIds::arpDivision), "Arp Division", arpDivisionChoices, 2),
        std::make_unique<AudioParameterChoice> (id (ParamIds::arpPattern), "Arp Pattern", arpPatternChoices, 0),
        std::make_unique<AudioParameterInt> (id (ParamIds::arpOctaves), "Arp Octaves", 1, 4, 2),
        std::make_unique<AudioParameterChoice> (id (ParamIds::arpRate), "Arp Rate", rateChoices, 1),
        std::make_unique<AudioParameterFloat> (id (ParamIds::arpGate), "Arp Gate", NormalisableRange<float> { 0.05f, 1.0f }, 0.8f, percent()));

    layout.add (std::move (output), std::move (sample), std::move (releaseTrigger), std::move (envelope),
                std::move (filters), std::move (sequencer), std::move (arp));
    return layout;
}

//==============================================================================
struct ParameterSnapshot::Raw
{
    explicit Raw (APVTS& s) : state (s) {}

    const std::atomic<float>& get (const char* paramId) const
    {
        auto* value = state.getRawParameterValue (paramId);
        jassert (value != nullptr);
        return *value;
    }

    APVTS& state;

    const std::atomic<float>& masterGain = get (ParamIds::masterGain);
    const std::atomic<float>& playbackMode = get (ParamIds::playbackMode);
    const std::atomic<float>& startPos = get (ParamIds::startPos);
    const std::atomic<float>& endPos = get (ParamIds::endPos);
    const std::atomic<float>& loopStartPos = get (ParamIds::loopStartPos);
    const std::atomic<float>& loopEndPos = get (ParamIds::loopEndPos);
    const std::atomic<float>& loopCrossfade = get (ParamIds::loopCrossfade);
    const std::atomic<float>& rootNote = get (ParamIds::rootNote);
    const std::atomic<float>& preserveSpeed = get (ParamIds::preserveSpeed);
    const std::atomic<float>& tempoSync = get (ParamIds::tempoSync);
    const std::atomic<float>& sampleBpm = get (ParamIds::sampleBpm);
    const std::atomic<float>& releaseTrigEnabled = get (ParamIds::releaseTrigEnabled);
    const std::atomic<float>& releaseTrigPos = get (ParamIds::releaseTrigPos);
    const std::atomic<float>& releaseTrigGain = get (ParamIds::releaseTrigGain);
    const std::atomic<float>& attack = get (ParamIds::attack);
    const std::atomic<float>& decay = get (ParamIds::decay);
    const std::atomic<float>& sustain = get (ParamIds::sustain);
    const std::atomic<float>& release = get (ParamIds::release);
    const std::atomic<float>& hpfEnabled = get (ParamIds::hpfEnabled);
    const std::atomic<float>& hpfCutoff = get (ParamIds::hpfCutoff);
    const std::atomic<float>& hpfResonance = get (ParamIds::hpfResonance);
    const std::atomic<float>& hpfSlope = get (ParamIds::hpfSlope);
    const std::atomic<float>& lpfEnabled = get (ParamIds::lpfEnabled);
    const std::atomic<float>& lpfCutoff = get (ParamIds::lpfCutoff);
    const std::atomic<float>& lpfResonance = get (ParamIds::lpfResonance);
    const std::atomic<float>& lpfSlope = get (ParamIds::lpfSlope);
    const std::atomic<float>& seqEnabled = get (ParamIds::seqEnabled);
    const std::atomic<float>& seqSteps = get (ParamIds::seqSteps);
    const std::atomic<float>& seqRate = get (ParamIds::seqRate);
    const std::atomic<float>& seqSync = get (ParamIds::seqSync);
    const std::atomic<float>& seqBpm = get (ParamIds::seqBpm);
    const std::atomic<float>& arpEnabled = get (ParamIds::arpEnabled);
    const std::atomic<float>& arpDivision = get (ParamIds::arpDivision);
    const std::atomic<float>& arpPattern = get (ParamIds::arpPattern);
    const std::atomic<float>& arpOctaves = get (ParamIds::arpOctaves);
    const std::atomic<float>& arpRate = get (ParamIds::arpRate);
    const std::atomic<float>& arpGate = get (ParamIds::arpGate);
};

ParameterSnapshot::ParameterSnapshot (APVTS& state) : raw (std::make_unique<Raw> (state)) {}
ParameterSnapshot::~ParameterSnapshot() = default;

obsidian::EngineParams ParameterSnapshot::read() const noexcept
{
    using namespace obsidian;

    const auto f = [] (const std::atomic<float>& v) { return v.load (std::memory_order_relaxed); };
    const auto b = [&] (const std::atomic<float>& v) { return f (v) >= 0.5f; };
    const auto index = [&] (const std::atomic<float>& v, int count) { return jlimit (0, count - 1, roundToInt (f (v))); };
    const auto slope = [&] (const std::atomic<float>& v) { return static_cast<FilterSlope> (index (v, 3)); };

    const auto& r = *raw;
    EngineParams p;

    p.masterGain = f (r.masterGain);
    p.playbackMode = index (r.playbackMode, 2) == 1 ? PlaybackMode::Loop : PlaybackMode::OneShot;
    p.startPos = f (r.startPos);
    p.endPos = f (r.endPos);
    p.loopStartPos = f (r.loopStartPos);
    p.loopEndPos = f (r.loopEndPos);
    p.loopCrossfadeSec = f (r.loopCrossfade);
    p.rootNote = roundToInt (f (r.rootNote));
    p.preserveSpeed = b (r.preserveSpeed);
    p.tempoSync = b (r.tempoSync);
    p.sampleBpm = f (r.sampleBpm);

    p.releaseTriggerEnabled = b (r.releaseTrigEnabled);
    p.releaseTriggerPos = f (r.releaseTrigPos);
    p.releaseTriggerGain = f (r.releaseTrigGain);

    p.attackSec = f (r.attack);
    p.decaySec = f (r.decay);
    p.sustainLevel = f (r.sustain);
    p.releaseSec = f (r.release);

    p.highPass = { b (r.hpfEnabled), f (r.hpfCutoff), f (r.hpfResonance), slope (r.hpfSlope) };
    p.lowPass = { b (r.lpfEnabled), f (r.lpfCutoff), f (r.lpfResonance), slope (r.lpfSlope) };

    p.sequencerEnabled = b (r.seqEnabled);
    p.sequencerSteps = stepCounts[index (r.seqSteps, 2)];
    p.sequencerRate = rateValues[index (r.seqRate, 3)];
    p.sequencerHostSync = b (r.seqSync);
    p.sequencerBpm = f (r.seqBpm);

    p.arpEnabled = b (r.arpEnabled);
    p.arpDivisionBeats = arpDivisionBeats[index (r.arpDivision, 4)];
    p.arpPattern = static_cast<ArpPattern> (index (r.arpPattern, 5));
    p.arpOctaves = roundToInt (f (r.arpOctaves));
    p.arpRate = rateValues[index (r.arpRate, 3)];
    p.arpGate = f (r.arpGate);

    return p;
}
