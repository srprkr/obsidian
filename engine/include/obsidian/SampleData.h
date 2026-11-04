#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace obsidian
{

/** Decoded audio held entirely in memory. Immutable once handed to the engine. */
struct SampleData
{
    std::vector<std::vector<float>> channels; // one or two channels, equal length
    double sampleRate = 44100.0;
    std::string name;       // display name (file name without extension)
    std::string sourcePath; // absolute path on disk, used to restore plugin state

    int numChannels() const noexcept { return static_cast<int> (channels.size()); }

    int64_t numFrames() const noexcept
    {
        return channels.empty() ? 0 : static_cast<int64_t> (channels.front().size());
    }

    double durationSeconds() const noexcept
    {
        return sampleRate > 0.0 ? static_cast<double> (numFrames()) / sampleRate : 0.0;
    }
};

using SamplePtr = std::shared_ptr<const SampleData>;

} // namespace obsidian
