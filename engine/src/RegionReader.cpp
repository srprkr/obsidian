#include "obsidian/RegionReader.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace obsidian
{

namespace
{
    constexpr double halfPi = 1.57079632679489661923;
    constexpr double minimumCrossfadeFrames = 8.0;
} // namespace

RegionReader::RegionReader (const SampleData& s, PlaybackRegion r)
    : sample (&s), region (r), frames (s.numFrames()), mono (s.numChannels() < 2)
{
    const double last = static_cast<double> (std::max<int64_t> (frames - 1, 1));

    region.start = std::clamp (region.start, 0.0, last);
    region.end = std::clamp (region.end, region.start + 1.0, last);

    if (! region.looping)
        return;

    region.loopEnd = std::clamp (region.loopEnd, 2.0, last);
    region.loopStart = std::clamp (region.loopStart, 0.0, region.loopEnd - 2.0);
    loopLength = region.loopEnd - region.loopStart;

    region.crossfade = std::clamp (region.crossfade, 0.0, loopLength * 0.45);
    preRollCrossfade = region.loopStart >= region.crossfade;

    if (region.crossfade < minimumCrossfadeFrames)
        region.crossfade = 0.0;

    period = preRollCrossfade ? loopLength : loopLength - region.crossfade;

    // Playback must begin before the loop seam.
    region.start = std::min (region.start, region.loopEnd - region.crossfade - 1.0);
}

int RegionReader::resolve (double v, Tap (&taps)[2]) const noexcept
{
    if (! region.looping)
    {
        taps[0] = { v, 1.0f };
        return 1;
    }

    const double xf = region.crossfade;

    if (preRollCrossfade)
    {
        // Fold v into [loopStart, loopEnd) once it reaches the loop.
        double u = v;
        if (u >= region.loopEnd)
            u = region.loopStart + std::fmod (u - region.loopStart, loopLength);

        const double fadeStart = region.loopEnd - xf;
        if (xf > 0.0 && u >= fadeStart && u < region.loopEnd)
        {
            const double t = (u - fadeStart) / xf;
            taps[0] = { u, static_cast<float> (std::cos (t * halfPi)) };
            taps[1] = { u - loopLength, static_cast<float> (std::sin (t * halfPi)) };
            return 2;
        }

        taps[0] = { u, 1.0f };
        return 1;
    }

    // Overlap strategy: the first pass runs to loopEnd - xf, then cycles of `period` frames
    // each start with a crossfade from the loop tail into the loop head.
    const double firstCycleStart = region.loopEnd - xf;
    if (v < firstCycleStart)
    {
        taps[0] = { v, 1.0f };
        return 1;
    }

    const double t = std::fmod (v - firstCycleStart, period);
    if (xf > 0.0 && t < xf)
    {
        const double fade = t / xf;
        taps[0] = { region.loopEnd - xf + t, static_cast<float> (std::cos (fade * halfPi)) };
        taps[1] = { region.loopStart + t, static_cast<float> (std::sin (fade * halfPi)) };
        return 2;
    }

    taps[0] = { region.loopStart + t, 1.0f };
    return 1;
}

float RegionReader::readChannel (const float* data, double position) const noexcept
{
    // 4-point, 3rd-order Hermite interpolation.
    const auto lastIndex = frames - 1;
    const auto index = static_cast<int64_t> (std::floor (position));
    const float frac = static_cast<float> (position - static_cast<double> (index));

    const auto at = [&] (int64_t i) { return data[std::clamp<int64_t> (i, 0, lastIndex)]; };

    const float xm1 = at (index - 1);
    const float x0 = at (index);
    const float x1 = at (index + 1);
    const float x2 = at (index + 2);

    const float c1 = 0.5f * (x1 - xm1);
    const float c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2;
    const float c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
    return ((c3 * frac + c2) * frac + c1) * frac + x0;
}

void RegionReader::read (double v, float& left, float& right) const noexcept
{
    left = right = 0.0f;

    if (! isValid() || v < 0.0 || (! region.looping && v >= region.end))
        return;

    Tap taps[2];
    const int numTaps = resolve (v, taps);

    const float* leftData = sample->channels[0].data();
    const float* rightData = mono ? leftData : sample->channels[1].data();

    for (int i = 0; i < numTaps; ++i)
    {
        if (taps[i].position < 0.0)
            continue;

        left += taps[i].weight * readChannel (leftData, taps[i].position);
        right += taps[i].weight * (mono ? 0.0f : readChannel (rightData, taps[i].position));
    }

    if (mono)
        right = left;
}

float RegionReader::readMono (double v) const noexcept
{
    if (! isValid() || v < 0.0 || (! region.looping && v >= region.end))
        return 0.0f;

    Tap taps[2];
    const int numTaps = resolve (v, taps);
    const float* data = sample->channels[0].data();

    float result = 0.0f;
    for (int i = 0; i < numTaps; ++i)
    {
        const double p = std::clamp (taps[i].position, 0.0, static_cast<double> (frames - 1));
        const auto index = static_cast<int64_t> (p);
        const auto next = std::min<int64_t> (index + 1, frames - 1);
        const float frac = static_cast<float> (p - static_cast<double> (index));
        result += taps[i].weight * (data[index] + frac * (data[next] - data[index]));
    }

    return result;
}

double RegionReader::toSamplePosition (double v) const noexcept
{
    Tap taps[2];
    resolve (v, taps);
    return std::clamp (taps[0].position, 0.0, static_cast<double> (std::max<int64_t> (frames - 1, 0)));
}

double RegionReader::framesRemaining (double v) const noexcept
{
    if (region.looping)
        return std::numeric_limits<double>::max();

    return region.end - v;
}

} // namespace obsidian
