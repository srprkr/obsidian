#include "SampleLibrary.h"

using namespace juce;

namespace
{
    constexpr int overviewBins = 1024;
    constexpr double maxSampleSeconds = 20.0 * 60.0;

    std::vector<float> computePeaks (const obsidian::SampleData& sample)
    {
        std::vector<float> peaks (overviewBins * 2, 0.0f);
        const auto& data = sample.channels.front();
        const auto frames = static_cast<int64> (data.size());

        for (int bin = 0; bin < overviewBins; ++bin)
        {
            const auto from = frames * bin / overviewBins;
            const auto to = std::max (from + 1, frames * (bin + 1) / overviewBins);
            float lo = 1.0f, hi = -1.0f;

            for (auto i = from; i < to && i < frames; ++i)
            {
                lo = std::min (lo, data[(size_t) i]);
                hi = std::max (hi, data[(size_t) i]);
            }

            peaks[(size_t) bin * 2] = lo > hi ? 0.0f : lo;
            peaks[(size_t) bin * 2 + 1] = lo > hi ? 0.0f : hi;
        }

        return peaks;
    }
} // namespace

var LoadedSample::toVar() const
{
    if (data == nullptr)
        return {};

    Array<var> peakArray;
    peakArray.ensureStorageAllocated ((int) peaks.size());
    for (auto p : peaks)
        peakArray.add (std::round (p * 10000.0f) / 10000.0f);

    auto* info = new DynamicObject();
    info->setProperty ("name", String (data->name));
    info->setProperty ("path", String (data->sourcePath));
    info->setProperty ("durationSec", data->durationSeconds());
    info->setProperty ("sampleRate", data->sampleRate);
    info->setProperty ("channels", data->numChannels());
    info->setProperty ("frames", (int64) data->numFrames());
    info->setProperty ("peaks", peakArray);
    return var (info);
}

//==============================================================================
SampleLibrary::SampleLibrary()
{
    formats.registerBasicFormats(); // WAV, AIFF, FLAC, Ogg, MP3 (+ CoreAudio formats on macOS)
}

String SampleLibrary::getSupportedWildcard() const
{
    return formats.getWildcardForAllFormats();
}

LoadedSample SampleLibrary::load (const File& file, String& error) const
{
    std::unique_ptr<AudioFormatReader> reader (formats.createReaderFor (file));

    if (reader == nullptr)
    {
        error = file.existsAsFile() ? "Unsupported or damaged audio file: " + file.getFileName()
                                    : "File not found: " + file.getFullPathName();
        return {};
    }

    const auto frames = reader->lengthInSamples;
    if (frames < 2 || reader->sampleRate <= 0.0)
    {
        error = "The file contains no audio: " + file.getFileName();
        return {};
    }

    if ((double) frames / reader->sampleRate > maxSampleSeconds)
    {
        error = "Samples longer than 20 minutes are not supported.";
        return {};
    }

    const int channels = jlimit (1, 2, (int) reader->numChannels);
    AudioBuffer<float> buffer (channels, (int) frames);
    reader->read (&buffer, 0, (int) frames, 0, true, channels > 1);

    auto sample = std::make_shared<obsidian::SampleData>();
    sample->sampleRate = reader->sampleRate;
    sample->name = file.getFileNameWithoutExtension().toStdString();
    sample->sourcePath = file.getFullPathName().toStdString();
    sample->channels.resize ((size_t) channels);

    for (int ch = 0; ch < channels; ++ch)
        sample->channels[(size_t) ch].assign (buffer.getReadPointer (ch), buffer.getReadPointer (ch) + frames);

    LoadedSample result;
    result.peaks = computePeaks (*sample);
    result.data = std::move (sample);
    return result;
}

File SampleLibrary::getImportFolder()
{
    return File::getSpecialLocation (File::userApplicationDataDirectory)
        .getChildFile ("Obsidian Player")
        .getChildFile ("Imported Samples");
}

File SampleLibrary::storeImportedFile (const String& fileName, const MemoryBlock& bytes) const
{
    auto folder = getImportFolder();
    folder.createDirectory();

    const auto safeName = File::createLegalFileName (fileName.isNotEmpty() ? fileName : String ("Sample.wav"));
    auto target = folder.getChildFile (safeName);

    // Reuse an identical earlier import instead of piling up copies.
    if (target.existsAsFile() && target.getSize() == (int64) bytes.getSize())
    {
        MemoryBlock existing;
        if (target.loadFileAsData (existing) && existing == bytes)
            return target;
    }

    target = target.getNonexistentSibling();
    return target.replaceWithData (bytes.getData(), bytes.getSize()) ? target : File();
}
