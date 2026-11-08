// End-to-end check of the built VST3, run by ctest on every platform (including CI on Windows/macOS).
//
// Loads the plugin the way a DAW does, gives it a sample through its saved state (as reopening a
// project would), sends MIDI notes, and fails if no audio comes out.
//
// Usage: obsidian_plugin_host_test "<path to Obsidian Player.vst3>"

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>

using namespace juce;

namespace
{
    constexpr double sampleRate = 48000.0;
    constexpr int blockSize = 512;
    int failures = 0;

    void check (bool condition, const String& what)
    {
        std::printf ("%s %s\n", condition ? "[ ok ]" : "[FAIL]", what.toRawUTF8());
        if (! condition)
            ++failures;
    }

    /** Writes a two-second decaying 220 Hz tone to a temporary WAV file. */
    File writeTestTone()
    {
        auto file = File::getSpecialLocation (File::tempDirectory).getChildFile ("obsidian-test-tone.wav");
        file.deleteFile();

        AudioBuffer<float> tone (1, (int) sampleRate * 2);
        for (int i = 0; i < tone.getNumSamples(); ++i)
            tone.setSample (0, i, 0.6f * std::sin (MathConstants<float>::twoPi * 220.0f * (float) i / (float) sampleRate)
                                      * std::exp (-(float) i / (float) sampleRate));

        WavAudioFormat wav;
        std::unique_ptr<OutputStream> stream (file.createOutputStream().release());
        if (auto writer = std::unique_ptr<AudioFormatWriter> (wav.createWriterFor (stream.get(), sampleRate, 1, 16, {}, 0)))
        {
            stream.release(); // the writer owns the stream now
            writer->writeFromAudioSampleBuffer (tone, 0, tone.getNumSamples());
        }
        return file;
    }

    /** Points the plugin's saved state at a sample, like reopening a DAW project. */
    void loadSampleThroughState (AudioPluginInstance& plugin, const File& sample)
    {
        MemoryBlock state;
        plugin.getStateInformation (state);
        auto xml = AudioProcessor::getXmlFromBinary (state.getData(), (int) state.getSize());
        if (xml == nullptr)
            return;

        // JUCE's VST3 host wraps the plugin's own state as base64 in <VST3PluginState><IComponent>.
        auto* component = xml->getChildByName ("IComponent");
        MemoryBlock inner;
        if (component == nullptr || ! inner.fromBase64Encoding (component->getAllSubText()))
            return;

        auto pluginXml = AudioProcessor::getXmlFromBinary (inner.getData(), (int) inner.getSize());
        if (pluginXml == nullptr)
            return;

        auto tree = ValueTree::fromXml (*pluginXml);
        tree.getOrCreateChildWithName ("ObsidianExtra", nullptr).setProperty ("mainSamplePath", sample.getFullPathName(), nullptr);

        MemoryBlock newInner;
        AudioProcessor::copyXmlToBinary (*tree.createXml(), newInner);
        component->deleteAllTextElements();
        component->addTextElement (newInner.toBase64Encoding());

        MemoryBlock newState;
        AudioProcessor::copyXmlToBinary (*xml, newState);
        plugin.setStateInformation (newState.getData(), (int) newState.getSize());
    }

    /** RMS of the left channel over `blocks` blocks; `midi` is delivered in the first block. */
    double render (AudioPluginInstance& plugin, const MidiBuffer& midi, int blocks)
    {
        AudioBuffer<float> buffer (jmax (2, plugin.getTotalNumOutputChannels()), blockSize);
        double sum = 0.0;
        int64 count = 0;

        for (int b = 0; b < blocks; ++b)
        {
            buffer.clear();
            MidiBuffer events;
            if (b == 0)
                events = midi;

            plugin.processBlock (buffer, events);

            for (int i = 0; i < blockSize; ++i)
            {
                const auto s = buffer.getSample (0, i);
                sum += (double) s * s;
                ++count;
            }
        }
        return std::sqrt (sum / (double) jmax<int64> (1, count));
    }

    MidiBuffer single (const MidiMessage& message, int offset = 0)
    {
        MidiBuffer buffer;
        buffer.addEvent (message, offset);
        return buffer;
    }
} // namespace

int main (int argc, char** argv)
{
    if (argc < 2)
    {
        std::puts ("usage: obsidian_plugin_host_test <path to .vst3>");
        return 2;
    }

    ScopedJuceInitialiser_GUI juce; // this thread becomes the message thread, as in a DAW

    AudioPluginFormatManager formats;
    formats.addFormat (new VST3PluginFormat());

    OwnedArray<PluginDescription> types;
    formats.getFormat (0)->findAllTypesForFile (types, String::fromUTF8 (argv[1]));
    check (! types.isEmpty(), "plugin found in " + String::fromUTF8 (argv[1]));
    if (types.isEmpty())
        return 1;

    const auto& description = *types.getFirst();
    check (description.isInstrument, "registered as an instrument (" + description.category + ")");

    String error;
    auto plugin = formats.createPluginInstance (description, sampleRate, blockSize, error);
    check (plugin != nullptr, "plugin instance created " + error);
    if (plugin == nullptr)
        return 1;

    check (plugin->acceptsMidi(), "accepts MIDI");
    check (plugin->getTotalNumOutputChannels() == 2, "stereo output");

    const auto tone = writeTestTone();
    loadSampleThroughState (*plugin, tone);

    plugin->setPlayConfigDetails (0, 2, sampleRate, blockSize);
    plugin->prepareToPlay (sampleRate, blockSize);

    check (render (*plugin, {}, 10) < 1.0e-6, "silent with no notes");

    for (int channel : { 1, 10, 16 })
    {
        const auto level = render (*plugin, single (MidiMessage::noteOn (channel, 60, (uint8) 100)), 20);
        check (level > 0.01, "MIDI note on channel " + String (channel) + " produces audio (rms " + String (level, 4) + ")");
        render (*plugin, single (MidiMessage::noteOff (channel, 60)), 40);
    }

    const auto late = render (*plugin, single (MidiMessage::noteOn (1, 67, (uint8) 90), blockSize / 2), 20);
    check (late > 0.01, "note arriving mid-block produces audio");
    // Default release is 0.5 s; 80 blocks is ~0.85 s.
    render (*plugin, single (MidiMessage::allNotesOff (1)), 80);

    const auto afterRelease = render (*plugin, {}, 10);
    check (afterRelease < 1.0e-4, "silent again after note off");

    plugin->releaseResources();
    plugin.reset();
    tone.deleteFile();

    std::printf ("\n%s\n", failures == 0 ? "PLUGIN MIDI TEST PASSED" : "PLUGIN MIDI TEST FAILED");
    return failures == 0 ? 0 : 1;
}
