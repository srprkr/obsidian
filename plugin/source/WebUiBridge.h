#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

/**
    Connects the React UI to the processor.

    UI -> plugin: native functions (see registerNativeFunctions for the full list). They all run
                  on the message thread and resolve a JavaScript promise.
    Plugin -> UI: events, sent ~30 times a second:
                    "parameters"    { id: plainValue, ... } for parameters changed by the host
                    "telemetry"     playheads, meter, sequencer position
                    "samples"       sample descriptions after a load / clear
                    "stateReplaced" the whole state changed (preset / session load); UI refetches

    The TypeScript side of this contract lives in ui/src/bridge/.
*/
class WebUiBridge : private juce::Timer,
                    private juce::AudioProcessorParameter::Listener
{
public:
    explicit WebUiBridge (ObsidianPlayerProcessor& processor);
    ~WebUiBridge() override;

    juce::WebBrowserComponent::Options registerNativeFunctions (juce::WebBrowserComponent::Options options);

    /** Call once the browser exists; events are sent to it from then on. */
    void attach (juce::WebBrowserComponent& browser);

    void notifyStateReplaced();

private:
    using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;
    using Args = juce::Array<juce::var>;

    juce::var describeState() const;
    juce::var describeParameters() const;
    juce::var describeSamples() const;
    juce::var describePresets() const;

    void setParameter (const juce::String& id, float plainValue);
    void beginGesture (const juce::String& id);
    void endGesture (const juce::String& id);

    void browseForSample (ObsidianPlayerProcessor::SampleSlot slot, Completion completion);
    juce::var loadDroppedSample (ObsidianPlayerProcessor::SampleSlot slot, const juce::String& fileName, const juce::String& base64);

    void emit (const juce::Identifier& eventId, const juce::var& payload);
    void sendSamples();

    void timerCallback() override;
    void parameterValueChanged (int parameterIndex, float newValue) override;
    void parameterGestureChanged (int, bool) override {}

    ObsidianPlayerProcessor& processor;
    juce::WebBrowserComponent* browser = nullptr;

    juce::Array<juce::RangedAudioParameter*> parameters;
    std::vector<std::atomic<bool>> parameterDirty;
    juce::StringArray activeGestures;

    std::unique_ptr<juce::FileChooser> fileChooser;
};
