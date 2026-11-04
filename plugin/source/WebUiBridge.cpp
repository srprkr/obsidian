#include "WebUiBridge.h"
#include "PatternSerialization.h"

using namespace juce;
using SampleSlot = ObsidianPlayerProcessor::SampleSlot;

namespace
{
    std::optional<SampleSlot> slotFromString (const var& value)
    {
        const auto text = value.toString();
        if (text == "main")    return SampleSlot::Main;
        if (text == "release") return SampleSlot::Release;
        return std::nullopt;
    }

    var result (bool ok, const String& error = {})
    {
        auto* object = new DynamicObject();
        object->setProperty ("ok", ok);
        if (error.isNotEmpty())
            object->setProperty ("error", error);
        return var (object);
    }

    String kindOf (const RangedAudioParameter& parameter)
    {
        if (dynamic_cast<const AudioParameterBool*> (&parameter) != nullptr)   return "bool";
        if (dynamic_cast<const AudioParameterChoice*> (&parameter) != nullptr) return "choice";
        if (dynamic_cast<const AudioParameterInt*> (&parameter) != nullptr)    return "int";
        return "float";
    }

    float plainValueOf (const RangedAudioParameter& parameter)
    {
        return parameter.convertFrom0to1 (parameter.getValue());
    }

    const var& arg (const Array<var>& args, int index)
    {
        static const var none;
        return isPositiveAndBelow (index, args.size()) ? args.getReference (index) : none;
    }
} // namespace

//==============================================================================
WebUiBridge::WebUiBridge (ObsidianPlayerProcessor& p)
    : processor (p)
{
    for (auto* parameter : processor.getParameters())
        if (auto* ranged = dynamic_cast<RangedAudioParameter*> (parameter))
            parameters.add (ranged);

    parameterDirty = std::vector<std::atomic<bool>> ((size_t) processor.getParameters().size());

    for (auto* parameter : parameters)
        parameter->addListener (this);
}

WebUiBridge::~WebUiBridge()
{
    stopTimer();
    for (auto* parameter : parameters)
        parameter->removeListener (this);
}

WebBrowserComponent::Options WebUiBridge::registerNativeFunctions (WebBrowserComponent::Options options)
{
    const auto fn = [this, &options] (const char* name, std::function<void (const Args&, Completion)> body)
    {
        options = options.withNativeFunction (name, [body] (const Args& args, Completion complete) { body (args, std::move (complete)); });
    };

    // State --------------------------------------------------------------------
    fn ("getInitialState", [this] (const Args&, Completion done) { done (describeState()); });

    fn ("setUiState", [this] (const Args& a, Completion done)
    {
        processor.setUiState (arg (a, 0));
        done ({});
    });

    // Parameters ---------------------------------------------------------------
    fn ("setParameter", [this] (const Args& a, Completion done)
    {
        setParameter (arg (a, 0).toString(), (float) (double) arg (a, 1));
        done ({});
    });
    fn ("beginGesture", [this] (const Args& a, Completion done) { beginGesture (arg (a, 0).toString()); done ({}); });
    fn ("endGesture",   [this] (const Args& a, Completion done) { endGesture (arg (a, 0).toString());   done ({}); });

    // Step pattern -------------------------------------------------------------
    fn ("setPattern", [this] (const Args& a, Completion done)
    {
        processor.setPattern (PatternSerialization::fromVar (arg (a, 0)));
        done ({});
    });

    // Samples ------------------------------------------------------------------
    fn ("browseForSample", [this] (const Args& a, Completion done)
    {
        if (const auto slot = slotFromString (arg (a, 0)))
            browseForSample (*slot, std::move (done));
        else
            done (result (false, "Unknown sample slot"));
    });

    fn ("loadDroppedSample", [this] (const Args& a, Completion done)
    {
        const auto slot = slotFromString (arg (a, 0));
        done (slot ? loadDroppedSample (*slot, arg (a, 1).toString(), arg (a, 2).toString())
                   : result (false, "Unknown sample slot"));
    });

    fn ("clearSample", [this] (const Args& a, Completion done)
    {
        if (const auto slot = slotFromString (arg (a, 0)))
        {
            processor.clearSample (*slot);
            sendSamples();
        }
        done ({});
    });

    // Notes from the UI --------------------------------------------------------
    using Type = obsidian::NoteEvent::Type;
    const auto noteArg = [] (const Args& a, int index, int fallback) { return jlimit (0, 127, a.size() > index ? (int) a[index] : fallback); };

    fn ("noteOn", [this, noteArg] (const Args& a, Completion done)
    {
        processor.pushUiNote ({ Type::NoteOn, 0, noteArg (a, 0, 60), jmax (1, noteArg (a, 1, 100)), 0.0f });
        done ({});
    });
    fn ("noteOff", [this, noteArg] (const Args& a, Completion done)
    {
        processor.pushUiNote ({ Type::NoteOff, 0, noteArg (a, 0, 60), 0, 0.0f });
        done ({});
    });
    fn ("allNotesOff", [this] (const Args&, Completion done)
    {
        processor.pushUiNote ({ Type::AllNotesOff, 0, 0, 0, 0.0f });
        done ({});
    });
    fn ("audition", [this, noteArg] (const Args& a, Completion done)
    {
        const auto pan = jlimit (-1.0f, 1.0f, (float) (double) arg (a, 2));
        processor.pushUiNote ({ Type::Audition, 0, noteArg (a, 0, 60), jmax (1, noteArg (a, 1, 100)), pan });
        done ({});
    });
    fn ("setSequencerRunning", [this] (const Args& a, Completion done)
    {
        processor.setSequencerManualRun ((bool) arg (a, 0));
        done ({});
    });

    // Presets ------------------------------------------------------------------
    fn ("listPresets", [this] (const Args&, Completion done) { done (describePresets()); });

    fn ("savePreset", [this] (const Args& a, Completion done)
    {
        const auto id = processor.getPresets().save (arg (a, 0).toString(), processor.getPattern());
        done (id.isNotEmpty() ? describePresets() : result (false, "Could not save the preset"));
    });

    fn ("loadPreset", [this] (const Args& a, Completion done)
    {
        done (result (processor.applyPreset (arg (a, 0).toString()), "Preset could not be loaded"));
    });

    fn ("setPresetFavorite", [this] (const Args& a, Completion done)
    {
        processor.getPresets().setFavorite (arg (a, 0).toString(), (bool) arg (a, 1));
        done (describePresets());
    });

    fn ("deletePreset", [this] (const Args& a, Completion done)
    {
        processor.getPresets().remove (arg (a, 0).toString());
        done (describePresets());
    });

    return options;
}

void WebUiBridge::attach (WebBrowserComponent& b)
{
    browser = &b;
    startTimerHz (30);
}

void WebUiBridge::notifyStateReplaced()
{
    emit ("stateReplaced", {});
}

//==============================================================================
var WebUiBridge::describeState() const
{
    auto* object = new DynamicObject();
    object->setProperty ("parameters", describeParameters());
    object->setProperty ("pattern", PatternSerialization::toVar (processor.getPattern()));
    object->setProperty ("samples", describeSamples());
    object->setProperty ("presets", describePresets());
    object->setProperty ("uiState", processor.getUiState());
    object->setProperty ("version", JucePlugin_VersionString);
    return var (object);
}

var WebUiBridge::describeParameters() const
{
    Array<var> list;

    for (auto* parameter : parameters)
    {
        const auto& range = parameter->getNormalisableRange();
        auto* object = new DynamicObject();
        object->setProperty ("id", parameter->getParameterID());
        object->setProperty ("name", parameter->getName (64));
        object->setProperty ("kind", kindOf (*parameter));
        object->setProperty ("min", range.start);
        object->setProperty ("max", range.end);
        object->setProperty ("defaultValue", parameter->convertFrom0to1 (parameter->getDefaultValue()));
        object->setProperty ("value", plainValueOf (*parameter));

        if (auto* choice = dynamic_cast<AudioParameterChoice*> (parameter))
        {
            Array<var> choices;
            for (const auto& c : choice->choices)
                choices.add (c);
            object->setProperty ("choices", choices);
        }

        list.add (var (object));
    }

    return list;
}

var WebUiBridge::describeSamples() const
{
    auto* object = new DynamicObject();
    object->setProperty ("main", processor.getSample (SampleSlot::Main).toVar());
    object->setProperty ("release", processor.getSample (SampleSlot::Release).toVar());
    return var (object);
}

var WebUiBridge::describePresets() const
{
    Array<var> items;
    for (const auto& preset : processor.getPresets().list())
    {
        auto* object = new DynamicObject();
        object->setProperty ("id", preset.id);
        object->setProperty ("name", preset.name);
        object->setProperty ("favorite", preset.favorite);
        items.add (var (object));
    }

    auto* object = new DynamicObject();
    object->setProperty ("items", items);
    object->setProperty ("currentId", processor.getPresets().getCurrentPresetId());
    return var (object);
}

//==============================================================================
void WebUiBridge::setParameter (const String& id, float plainValue)
{
    auto* parameter = dynamic_cast<RangedAudioParameter*> (processor.getState().getParameter (id));
    if (parameter == nullptr)
        return;

    // One-off changes (clicks, typed values) still need a gesture so hosts record automation.
    const bool needsGesture = ! activeGestures.contains (id);
    if (needsGesture) parameter->beginChangeGesture();
    parameter->setValueNotifyingHost (parameter->convertTo0to1 (plainValue));
    if (needsGesture) parameter->endChangeGesture();
}

void WebUiBridge::beginGesture (const String& id)
{
    if (auto* parameter = processor.getState().getParameter (id); parameter != nullptr && ! activeGestures.contains (id))
    {
        activeGestures.add (id);
        parameter->beginChangeGesture();
    }
}

void WebUiBridge::endGesture (const String& id)
{
    if (auto* parameter = processor.getState().getParameter (id); parameter != nullptr && activeGestures.contains (id))
    {
        activeGestures.removeString (id);
        parameter->endChangeGesture();
    }
}

void WebUiBridge::browseForSample (SampleSlot slot, Completion completion)
{
    fileChooser = std::make_unique<FileChooser> (slot == SampleSlot::Main ? "Load Sample" : "Load Release Sample",
                                                 File::getSpecialLocation (File::userMusicDirectory),
                                                 processor.getSampleLibrary().getSupportedWildcard());

    fileChooser->launchAsync (FileBrowserComponent::openMode | FileBrowserComponent::canSelectFiles,
                              [this, slot, completion = std::move (completion)] (const FileChooser& chooser)
    {
        const auto file = chooser.getResult();
        if (file == File())
        {
            completion (result (false)); // cancelled
            return;
        }

        String error;
        const bool ok = processor.loadSample (slot, file, true, error);
        sendSamples();
        completion (result (ok, error));
    });
}

var WebUiBridge::loadDroppedSample (SampleSlot slot, const String& fileName, const String& base64)
{
    MemoryOutputStream decoded;
    if (! Base64::convertFromBase64 (decoded, base64) || decoded.getDataSize() == 0)
        return result (false, "The dropped file could not be read.");

    const auto stored = processor.getSampleLibrary().storeImportedFile (fileName, decoded.getMemoryBlock());
    if (stored == File())
        return result (false, "The dropped file could not be saved.");

    String error;
    const bool ok = processor.loadSample (slot, stored, true, error);
    sendSamples();
    return result (ok, error);
}

//==============================================================================
void WebUiBridge::emit (const Identifier& eventId, const var& payload)
{
    if (browser != nullptr)
        browser->emitEventIfBrowserIsVisible (eventId, payload);
}

void WebUiBridge::sendSamples()
{
    emit ("samples", describeSamples());
}

void WebUiBridge::parameterValueChanged (int parameterIndex, float)
{
    // May be called on the audio thread (automation): just flag it.
    if (isPositiveAndBelow (parameterIndex, (int) parameterDirty.size()))
        parameterDirty[(size_t) parameterIndex].store (true, std::memory_order_relaxed);
}

void WebUiBridge::timerCallback()
{
    auto* changed = new DynamicObject();
    for (auto* parameter : parameters)
    {
        const auto index = (size_t) parameter->getParameterIndex();
        if (parameterDirty[index].exchange (false, std::memory_order_relaxed))
            changed->setProperty (parameter->getParameterID(), plainValueOf (*parameter));
    }

    if (! changed->getProperties().isEmpty())
        emit ("parameters", var (changed));
    else
        delete changed;

    const auto t = processor.getTelemetry();

    Array<var> voices;
    for (const auto& voice : t.voices)
    {
        if (! voice.active)
            continue;

        // [kind, position, progress]; kind 0 = note, 1 = release tail from main sample, 2 = custom release sample
        const int kind = ! voice.isReleaseTail ? 0 : (voice.usesReleaseSample ? 2 : 1);
        voices.add (Array<var> { kind, voice.position, voice.progress });
    }

    auto* telemetry = new DynamicObject();
    telemetry->setProperty ("peak", Array<var> { t.peakLeft, t.peakRight });
    telemetry->setProperty ("voices", voices);
    telemetry->setProperty ("sequencerStep", t.sequencerStep);
    telemetry->setProperty ("sequencerHalf", t.sequencerHalf);
    telemetry->setProperty ("sequencerRunning", t.sequencerRunning);
    telemetry->setProperty ("arpRunning", t.arpRunning);
    telemetry->setProperty ("heldNotes", t.heldNoteCount);
    telemetry->setProperty ("hostBpm", t.hostBpm);
    emit ("telemetry", var (telemetry));
}
