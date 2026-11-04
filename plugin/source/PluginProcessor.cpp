#include "PluginProcessor.h"
#include "PatternSerialization.h"
#include "PluginEditor.h"

using namespace juce;

namespace
{
    const Identifier extraStateTag ("ObsidianExtra");
    const Identifier mainSamplePathProp ("mainSamplePath");
    const Identifier releaseSamplePathProp ("releaseSamplePath");
    const Identifier patternProp ("pattern");
    const Identifier uiStateProp ("uiState");
    const Identifier presetIdProp ("presetId");

    constexpr int maxEventsPerBlock = 2048;
} // namespace

ObsidianPlayerProcessor::ObsidianPlayerProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", AudioChannelSet::stereo(), true)),
      state (*this, nullptr, "ObsidianPlayer", createParameterLayout()),
      parameterSnapshot (state),
      presets (state)
{
    blockEvents.reserve (maxEventsPerBlock);
    startTimerHz (2); // frees samples the audio thread no longer uses
}

ObsidianPlayerProcessor::~ObsidianPlayerProcessor()
{
    stopTimer();
}

//==============================================================================
void ObsidianPlayerProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    engine.prepare (sampleRate, samplesPerBlock);
    engine.setSamples (mainSample.data, releaseSample.data);
    engine.setPattern (pattern);
}

bool ObsidianPlayerProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainOutputChannelSet() == AudioChannelSet::stereo();
}

void ObsidianPlayerProcessor::processBlock (AudioBuffer<float>& buffer, MidiBuffer& midi)
{
    ScopedNoDenormals noDenormals;

    // Pick up new samples / pattern from the UI, if the UI isn't mid-update.
    if (std::unique_lock lock (handoverMutex, std::try_to_lock); lock.owns_lock())
    {
        if (samplesPending)
        {
            engine.setSamples (pendingMain, pendingRelease);
            pendingMain.reset(); // the message thread still holds a reference, so nothing is freed here
            pendingRelease.reset();
            samplesPending = false;
        }
        if (patternPending)
        {
            engine.setPattern (pendingPattern);
            patternPending = false;
        }
    }

    engine.setParams (parameterSnapshot.read());
    engine.setSequencerManualRun (sequencerManualRun.load());

    obsidian::TransportInfo transport;
    if (auto* hostPlayHead = getPlayHead())
    {
        if (const auto position = hostPlayHead->getPosition())
        {
            if (const auto bpm = position->getBpm())
                transport.bpm = *bpm;
            transport.isPlaying = position->getIsPlaying();
            if (const auto ppq = position->getPpqPosition())
            {
                transport.hasPpqPosition = true;
                transport.ppqPosition = *ppq;
            }
        }
    }

    // UI notes first (at the start of the block), then host MIDI in time order.
    blockEvents.clear();
    uiNoteFifo.read (uiNoteFifo.getNumReady()).forEach ([this] (int index)
    {
        if (blockEvents.size() < maxEventsPerBlock)
            blockEvents.push_back (uiNotes[(size_t) index]);
    });

    for (const auto metadata : midi)
    {
        if (blockEvents.size() >= maxEventsPerBlock)
            break;

        const auto message = metadata.getMessage();
        const int offset = jlimit (0, buffer.getNumSamples() - 1, metadata.samplePosition);
        using Type = obsidian::NoteEvent::Type;

        if (message.isNoteOn())
            blockEvents.push_back ({ Type::NoteOn, offset, message.getNoteNumber(), message.getVelocity(), 0.0f });
        else if (message.isNoteOff())
            blockEvents.push_back ({ Type::NoteOff, offset, message.getNoteNumber(), 0, 0.0f });
        else if (message.isAllNotesOff() || message.isAllSoundOff())
            blockEvents.push_back ({ Type::AllNotesOff, offset, 0, 0, 0.0f });
    }

    engine.process (buffer.getWritePointer (0), buffer.getWritePointer (1), buffer.getNumSamples(),
                    transport, blockEvents.data(), (int) blockEvents.size());

    if (std::unique_lock lock (telemetryMutex, std::try_to_lock); lock.owns_lock())
        telemetry = engine.getTelemetry();
}

//==============================================================================
AudioProcessorEditor* ObsidianPlayerProcessor::createEditor()
{
    return new ObsidianPlayerEditor (*this);
}

void ObsidianPlayerProcessor::getStateInformation (MemoryBlock& destData)
{
    auto tree = state.copyState();

    ValueTree extra (extraStateTag);
    extra.setProperty (mainSamplePathProp, mainSample.data ? String (mainSample.data->sourcePath) : String(), nullptr);
    extra.setProperty (releaseSamplePathProp, releaseSample.data ? String (releaseSample.data->sourcePath) : String(), nullptr);
    extra.setProperty (patternProp, JSON::toString (PatternSerialization::toVar (pattern), true), nullptr);
    extra.setProperty (uiStateProp, JSON::toString (uiState, true), nullptr);
    extra.setProperty (presetIdProp, presets.getCurrentPresetId(), nullptr);
    tree.appendChild (extra, nullptr);

    if (auto xml = tree.createXml())
        copyXmlToBinary (*xml, destData);
}

void ObsidianPlayerProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr || ! xml->hasTagName (state.state.getType()))
        return;

    auto tree = ValueTree::fromXml (*xml);
    const auto extra = tree.getChildWithName (extraStateTag).createCopy();
    tree.removeChild (tree.getChildWithName (extraStateTag), nullptr);
    state.replaceState (tree);

    // Sample loading and UI notification must happen on the message thread.
    auto restore = [this, extra]
    {
        setPattern (PatternSerialization::fromVar (JSON::parse (extra[patternProp].toString())));
        uiState = JSON::parse (extra[uiStateProp].toString());
        presets.setCurrentPresetId (extra[presetIdProp].toString());

        String error;
        const auto restoreSlot = [&] (SampleSlot slot, const Identifier& prop)
        {
            const auto path = extra[prop].toString();
            if (path.isEmpty() || ! File::isAbsolutePath (path) || ! loadSample (slot, File (path), false, error))
                clearSample (slot);
        };

        restoreSlot (SampleSlot::Main, mainSamplePathProp);
        restoreSlot (SampleSlot::Release, releaseSamplePathProp);
        sendChangeMessage();
    };

    if (MessageManager::getInstance()->isThisTheMessageThread())
        restore();
    else
        MessageManager::callAsync (restore);
}

//==============================================================================
void ObsidianPlayerProcessor::setParameterPlainValue (const char* paramId, float value)
{
    if (auto* parameter = state.getParameter (paramId))
    {
        parameter->beginChangeGesture();
        parameter->setValueNotifyingHost (parameter->convertTo0to1 (value));
        parameter->endChangeGesture();
    }
}

bool ObsidianPlayerProcessor::loadSample (SampleSlot slot, const File& file, bool resetMarkers, String& error)
{
    auto loaded = sampleLibrary.load (file, error);
    if (loaded.data == nullptr)
        return false;

    auto& target = slot == SampleSlot::Main ? mainSample : releaseSample;
    if (target.data != nullptr)
        retiredSamples.push_back (target.data);
    target = std::move (loaded);

    if (resetMarkers && slot == SampleSlot::Main)
    {
        // Defaults the original app applied when a new sample was loaded.
        setParameterPlainValue (ParamIds::startPos, 0.0f);
        setParameterPlainValue (ParamIds::endPos, 1.0f);
        setParameterPlainValue (ParamIds::loopStartPos, 0.0f);
        setParameterPlainValue (ParamIds::loopEndPos, 1.0f);
        setParameterPlainValue (ParamIds::loopCrossfade, 0.02f);
        setParameterPlainValue (ParamIds::releaseTrigPos, 0.8f);
        setParameterPlainValue (ParamIds::preserveSpeed, 1.0f);
        setParameterPlainValue (ParamIds::tempoSync, 1.0f);
    }
    else if (resetMarkers && slot == SampleSlot::Release)
    {
        setParameterPlainValue (ParamIds::releaseTrigEnabled, 1.0f);
        setParameterPlainValue (ParamIds::releaseTrigPos, 0.0f);
    }

    publishSamplesToAudioThread();
    return true;
}

void ObsidianPlayerProcessor::clearSample (SampleSlot slot)
{
    auto& target = slot == SampleSlot::Main ? mainSample : releaseSample;
    if (target.data != nullptr)
        retiredSamples.push_back (target.data);
    target = {};
    publishSamplesToAudioThread();
}

const LoadedSample& ObsidianPlayerProcessor::getSample (SampleSlot slot) const noexcept
{
    return slot == SampleSlot::Main ? mainSample : releaseSample;
}

void ObsidianPlayerProcessor::publishSamplesToAudioThread()
{
    std::lock_guard lock (handoverMutex);
    pendingMain = mainSample.data;
    pendingRelease = releaseSample.data;
    samplesPending = true;
}

void ObsidianPlayerProcessor::setPattern (const obsidian::StepPattern& newPattern)
{
    pattern = newPattern;
    std::lock_guard lock (handoverMutex);
    pendingPattern = newPattern;
    patternPending = true;
}

void ObsidianPlayerProcessor::pushUiNote (const obsidian::NoteEvent& event)
{
    uiNoteFifo.write (1).forEach ([this, &event] (int index) { uiNotes[(size_t) index] = event; });
}

bool ObsidianPlayerProcessor::applyPreset (const String& presetId)
{
    const auto loadedPattern = presets.load (presetId);
    if (! loadedPattern.has_value())
        return false;

    setPattern (*loadedPattern);
    sendChangeMessage();
    return true;
}

obsidian::EngineTelemetry ObsidianPlayerProcessor::getTelemetry() const
{
    std::lock_guard lock (telemetryMutex);
    return telemetry;
}

void ObsidianPlayerProcessor::timerCallback()
{
    // A retired sample can be freed once only this list (and no pending hand-over) holds it.
    std::lock_guard lock (handoverMutex);
    if (samplesPending)
        return;

    retiredSamples.erase (std::remove_if (retiredSamples.begin(), retiredSamples.end(),
                                          [] (const obsidian::SamplePtr& s) { return s.use_count() == 1; }),
                          retiredSamples.end());
}

//==============================================================================
AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ObsidianPlayerProcessor();
}
