#pragma once

#include "RegionReader.h"

#include <vector>

namespace obsidian
{

/** Hann window shared by every voice. Built once in SamplerEngine::prepare(). */
struct GrainWindow
{
    int length = 0; // N, in output samples
    int hop = 0;    // N / 2
    std::vector<float> table;

    void build (double outputSampleRate);
};

/**
    Plays a RegionReader at independent pitch and speed.

    pitchRate   - source frames advanced per output sample by the audio itself (sets the pitch)
    contentRate - source frames advanced per output sample by the timeline (sets the speed)

    When both rates match, the sample is simply resampled. Otherwise playback is built from
    overlapping Hann-windowed grains (50 % overlap). Each new grain is placed near the ideal
    timeline position and nudged, within a small search window, to the offset whose waveform
    best matches the natural continuation of the previous grain (WSOLA). This keeps phase
    coherent and avoids the "phasey" sound of plain overlap-add.

    This replaces the original app's offline WSOLA render, which rendered a whole stretched
    buffer per key - far too expensive to do inside a plugin's audio callback.
*/
class StretchPlayer
{
public:
    void start (const RegionReader& reader, const GrainWindow& window,
                double pitchRate, double contentRate, double searchRadiusFrames) noexcept;

    void next (float& left, float& right) noexcept;

    /** Current timeline position in the reader's virtual frames. */
    double getContentPosition() const noexcept { return contentPosition; }

    bool isGranular() const noexcept { return granular; }

private:
    struct Grain
    {
        bool active = false;
        bool isFirst = false;
        double startPosition = 0.0;
        double position = 0.0;
        int age = 0;
    };

    void spawnGrain() noexcept;
    double findBestAlignment (double ideal, double natural) const noexcept;

    const RegionReader* reader = nullptr;
    const GrainWindow* window = nullptr;

    double pitchRate = 1.0;
    double contentRate = 1.0;
    double contentPosition = 0.0;
    double searchRadius = 0.0;
    bool granular = false;

    Grain grains[2];
    int newestGrain = -1;
    int samplesUntilNextGrain = 0;
};

} // namespace obsidian
