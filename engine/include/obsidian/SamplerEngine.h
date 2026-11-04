#pragma once

#include "Arpeggiator.h"
#include "EngineParams.h"
#include "SampleData.h"
#include "StepClock.h"
#include "Voice.h"

#include <array>
#include <cstdint>
#include <random>

namespace obsidian
{

struct NoteEvent
{
    enum class Type { NoteOn, NoteOff, AllNotesOff, Audition };

    Type type = Type::NoteOn;
    int sampleOffset = 0;
    int note = 60;
    int velocity = 100;
    float pan = 0.0f; // Audition only
};

/** Snapshot of what the engine is doing, for the UI. Written once per block. */
struct EngineTelemetry
{
    static constexpr int maxVoices = 32;

    struct VoiceInfo
    {
        bool active = false;
        bool isReleaseTail = false;
        bool usesReleaseSample = false; // tail playing the custom release sample
        float position = 0.0f;          // fraction of the sample it is playing
        float progress = 0.0f;          // fraction of its region
    };

    std::array<VoiceInfo, maxVoices> voices {};
    float peakLeft = 0.0f, peakRight = 0.0f;
    int sequencerStep = 0;
    int sequencerHalf = 0;
    bool sequencerRunning = false;
    bool arpRunning = false;
    int heldNoteCount = 0;
    double hostBpm = 120.0;
};

/**
    The whole instrument, independent of any plugin framework.

    Thread rules: everything here runs on the audio thread except prepare(). The caller hands
    over samples, parameters and patterns by value or shared pointer; nothing in process()
    allocates or locks.
*/
class SamplerEngine
{
public:
    static constexpr int maxVoices = EngineTelemetry::maxVoices;

    void prepare (double sampleRate, int maxBlockSize);

    /** Swaps the main / release samples. Silences every voice. */
    void setSamples (SamplePtr mainSample, SamplePtr releaseSample) noexcept;

    void setParams (const EngineParams& newParams) noexcept { params = newParams; }
    void setPattern (const StepPattern& newPattern) noexcept { pattern = newPattern; }

    /** The sequencer's transport button: runs the pattern on the root note with no keys held. */
    void setSequencerManualRun (bool shouldRun) noexcept { manualRunRequested = shouldRun; }

    /** Renders numSamples of stereo audio, replacing the buffer contents. Events must be sorted by offset. */
    void process (float* left, float* right, int numSamples, const TransportInfo& transport,
                  const NoteEvent* events, int numEvents) noexcept;

    const EngineTelemetry& getTelemetry() const noexcept { return telemetry; }

private:
    enum class TriggerSource { Key, Sequencer, Arpeggiator, Audition };

    void handleEvent (const NoteEvent& event) noexcept;
    void updateRunStates (int offset) noexcept;
    void onSequencerTick (int64_t tickIndex, int offset) noexcept;
    void onArpTick (int offset) noexcept;

    void triggerNote (int note, int velocity, float pan, TriggerSource source, int gateSamples) noexcept;
    void releaseNote (int note, bool withReleaseTrigger) noexcept;
    void releaseAllNotes (bool withReleaseTrigger) noexcept;
    void releaseVoice (Voice& voice, bool withReleaseTrigger) noexcept;
    void spawnReleaseTail (int note, float velocityGain) noexcept;

    bool computeRates (int note, const SampleData& sample, double& pitchRate, double& contentRate) const noexcept;
    Voice& allocateVoice() noexcept;
    void renderVoices (float* left, float* right, int numSamples) noexcept;
    void updateFilters (int numSamples) noexcept;
    void writeTelemetry() noexcept;

    bool sequencerShouldRun() const noexcept;
    bool arpShouldRun() const noexcept;
    bool patternHasAnyStep() const noexcept;
    double sequencerBpm() const noexcept;
    double halfStepSamples() const noexcept;

    double sampleRate = 44100.0;
    EngineParams params;
    StepPattern pattern {};
    TransportInfo transport;
    SamplePtr mainSample, releaseSample;

    GrainWindow grainWindow;
    std::array<Voice, maxVoices> voices {};
    uint64_t voiceCounter = 0;
    VoiceRenderContext renderContext;
    float smoothedHighPassCutoff = 20.0f, smoothedLowPassCutoff = 20000.0f;
    float smoothedMasterGain = 1.0f;

    NoteList heldNotes;
    bool manualRunRequested = false;

    StepClock sequencerClock, arpClock;
    int sequencerStep = 0, sequencerHalf = 0;
    int arpStepIndex = 0;
    NoteList arpSequence;
    std::minstd_rand random { 0x0b5d1a };

    EngineTelemetry telemetry;
};

} // namespace obsidian
