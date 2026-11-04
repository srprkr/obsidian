#pragma once

#include "SampleData.h"

namespace obsidian
{

/** Where a voice plays within its sample, in source frames. */
struct PlaybackRegion
{
    double start = 0.0;
    double end = 0.0;        // one-shot playback stops here
    bool looping = false;    // loop playback ignores `end`
    double loopStart = 0.0;
    double loopEnd = 0.0;
    double crossfade = 0.0;  // loop crossfade length
};

/**
    Reads a sample through a "virtual" timeline that unrolls the loop, so playback code can
    simply advance a position forever.

    Positions before the loop end map straight onto the sample. After that the loop repeats.
    Two crossfade strategies keep the loop seam click-free:

      - Pre-roll (loopStart has at least `crossfade` frames before it): the last `crossfade`
        frames of the loop are blended with the audio just *before* loopStart, so the jump back
        lands exactly where the blend was heading. The loop period stays exactly
        loopEnd - loopStart, which keeps rhythmic loops in time.

      - Overlap (no room before loopStart): the loop tail is blended with the loop head, as two
        overlapping playbacks. The period becomes loopLength - crossfade.
*/
class RegionReader
{
public:
    RegionReader() = default;
    RegionReader (const SampleData& sample, PlaybackRegion region);

    bool isValid() const noexcept { return sample != nullptr && frames > 1; }

    /** Interpolated stereo frame at virtual position v. Mono samples return the same value in both. */
    void read (double v, float& left, float& right) const noexcept;

    /** Cheap linear-interpolated channel-0 read, used by grain alignment search. */
    float readMono (double v) const noexcept;

    /** Real frame index that virtual position v maps to (ignoring the crossfade partner). */
    double toSamplePosition (double v) const noexcept;

    /** Frames left before the one-shot end; effectively infinite for loops. */
    double framesRemaining (double v) const noexcept;

    const PlaybackRegion& getRegion() const noexcept { return region; }
    int64_t getNumFrames() const noexcept { return frames; }
    bool isMono() const noexcept { return mono; }

private:
    struct Tap
    {
        double position;
        float weight;
    };

    /** Resolves v into one or two weighted real positions. Returns the number of taps used. */
    int resolve (double v, Tap (&taps)[2]) const noexcept;

    float readChannel (const float* data, double position) const noexcept;

    const SampleData* sample = nullptr;
    PlaybackRegion region;
    int64_t frames = 0;
    bool mono = true;
    bool preRollCrossfade = true;
    double loopLength = 0.0;
    double period = 0.0;
};

} // namespace obsidian
