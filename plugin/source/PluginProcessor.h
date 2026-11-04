#pragma once

#include "Parameters.h"
#include "PresetManager.h"
#include "SampleLibrary.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <obsidian/SamplerEngine.h>

#include <mutex>

/**
    Obsidian Player's audio processor: owns the parameters, samples, step pattern and engine.

    Threading
      - The UI (message thread) changes samples and the pattern through the methods below. They
        are handed to the audio thread through a small mutex the audio thread only ever
        try-locks, so the audio thread never waits.
      - Old samples are kept alive on the message thread until the audio thread has let go of
        them, so memory is never freed inside processBlock().
*/
class ObsidianPlayerProcessor : public juce::AudioProcessor,
                                public juce::ChangeBroadcaster,
                                private juce::Timer
{
public:
    enum class SampleSlot { Main, Release };

    ObsidianPlayerProcessor();
    ~ObsidianPlayerProcessor() override;

    //==============================================================================
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 5.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    //==============================================================================
    // Message-thread API used by the editor.

    juce::AudioProcessorValueTreeState& getState() noexcept { return state; }
    SampleLibrary& getSampleLibrary() noexcept { return sampleLibrary; }
    PresetManager& getPresets() noexcept { return presets; }

    /** Loads a file into a slot. `resetMarkers` applies the original app's defaults for a fresh sample. */
    bool loadSample (SampleSlot slot, const juce::File& file, bool resetMarkers, juce::String& error);
    void clearSample (SampleSlot slot);
    const LoadedSample& getSample (SampleSlot slot) const noexcept;

    const obsidian::StepPattern& getPattern() const noexcept { return pattern; }
    void setPattern (const obsidian::StepPattern& newPattern);

    juce::var getUiState() const { return uiState; }
    void setUiState (const juce::var& newState) { uiState = newState; }

    /** Notes played from the UI (computer keyboard, step audition). Safe from any thread. */
    void pushUiNote (const obsidian::NoteEvent& event);

    void setSequencerManualRun (bool shouldRun) noexcept { sequencerManualRun.store (shouldRun); }

    bool applyPreset (const juce::String& presetId);

    /** Latest engine snapshot for the UI (playheads, meter, sequencer position). */
    obsidian::EngineTelemetry getTelemetry() const;

    // As a ChangeBroadcaster, the processor notifies the editor when the whole state was
    // replaced (session load or preset), so the UI can refetch everything.

private:
    void timerCallback() override;
    void publishSamplesToAudioThread();
    void setParameterPlainValue (const char* paramId, float value);

    juce::AudioProcessorValueTreeState state;
    ParameterSnapshot parameterSnapshot;
    SampleLibrary sampleLibrary;
    PresetManager presets;

    obsidian::SamplerEngine engine;

    // Message-thread copies of what the audio thread is (or will be) using.
    LoadedSample mainSample, releaseSample;
    obsidian::StepPattern pattern {};
    juce::var uiState;
    std::vector<obsidian::SamplePtr> retiredSamples;

    // Hand-over to the audio thread.
    std::mutex handoverMutex;
    obsidian::SamplePtr pendingMain, pendingRelease;
    bool samplesPending = false;
    obsidian::StepPattern pendingPattern {};
    bool patternPending = false;

    std::atomic<bool> sequencerManualRun { false };

    juce::AbstractFifo uiNoteFifo { 256 };
    std::array<obsidian::NoteEvent, 256> uiNotes {};
    std::vector<obsidian::NoteEvent> blockEvents;

    mutable std::mutex telemetryMutex;
    obsidian::EngineTelemetry telemetry;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ObsidianPlayerProcessor)
};
