#include "obsidian/StretchPlayer.h"

#include <algorithm>
#include <cmath>

namespace obsidian
{

namespace
{
    constexpr double twoPi = 6.28318530717958647692;

    // Correlation is evaluated on a decimated set of taps to keep the search cheap.
    constexpr int correlationTapSpacing = 8;
    constexpr int coarseCandidateStride = 4;
} // namespace

void GrainWindow::build (double outputSampleRate)
{
    // ~32 ms grains, as in the original WSOLA engine.
    length = std::clamp (static_cast<int> (std::lround (outputSampleRate * 0.032)), 512, 4096);
    length -= length % 2;
    hop = length / 2;

    // Periodic Hann: at 50 % overlap the windows sum to exactly 1.
    table.resize (static_cast<size_t> (length));
    for (int i = 0; i < length; ++i)
        table[static_cast<size_t> (i)] = static_cast<float> (0.5 * (1.0 - std::cos (twoPi * i / length)));
}

void StretchPlayer::start (const RegionReader& r, const GrainWindow& w,
                           double newPitchRate, double newContentRate, double searchRadiusFrames) noexcept
{
    reader = &r;
    window = &w;
    pitchRate = newPitchRate;
    contentRate = newContentRate;
    searchRadius = std::max (0.0, searchRadiusFrames);
    contentPosition = r.getRegion().start;

    // Below a 0.5 % mismatch the grain machinery is inaudible, so just resample.
    granular = std::abs (contentRate / pitchRate - 1.0) >= 0.005;

    grains[0] = {};
    grains[1] = {};
    newestGrain = -1;
    samplesUntilNextGrain = 0;
}

void StretchPlayer::next (float& left, float& right) noexcept
{
    if (! granular)
    {
        reader->read (contentPosition, left, right);
        contentPosition += contentRate;
        return;
    }

    if (samplesUntilNextGrain == 0)
    {
        spawnGrain();
        samplesUntilNextGrain = window->hop;
    }
    --samplesUntilNextGrain;

    left = right = 0.0f;

    for (auto& grain : grains)
    {
        if (! grain.active)
            continue;

        // The very first grain starts at full gain so the note's attack is not smeared.
        const float gain = (grain.isFirst && grain.age < window->hop)
                               ? 1.0f
                               : window->table[static_cast<size_t> (grain.age)];

        float l, r;
        reader->read (grain.position, l, r);
        left += gain * l;
        right += gain * r;

        grain.position += pitchRate;
        if (++grain.age >= window->length)
            grain.active = false;
    }

    contentPosition += contentRate;
}

void StretchPlayer::spawnGrain() noexcept
{
    const int slot = newestGrain < 0 ? 0 : 1 - newestGrain;
    const double regionStart = reader->getRegion().start;
    Grain& grain = grains[slot];

    if (newestGrain < 0)
    {
        grain.isFirst = true;
        grain.startPosition = contentPosition;
    }
    else
    {
        // Centre the grain on where the timeline will be halfway through it.
        const double ideal = contentPosition + 0.5 * window->length * (contentRate - pitchRate);
        const double natural = grains[newestGrain].startPosition + window->hop * pitchRate;

        grain.isFirst = false;
        grain.startPosition = std::max (regionStart, findBestAlignment (ideal, natural));
    }

    grain.position = grain.startPosition;
    grain.age = 0;
    grain.active = true;
    newestGrain = slot;
}

double StretchPlayer::findBestAlignment (double ideal, double natural) const noexcept
{
    if (searchRadius < 1.0)
        return ideal;

    const int numTaps = std::max (1, window->hop / correlationTapSpacing);
    const double tapStep = correlationTapSpacing * pitchRate;

    // Target: how the previous grain would have continued through the overlap region.
    float target[1024];
    const int taps = std::min (numTaps, 1024);
    for (int j = 0; j < taps; ++j)
        target[j] = reader->readMono (natural + j * tapStep);

    const double regionStart = reader->getRegion().start;

    // Normalised cross-correlation, so loud passages are not unfairly preferred.
    const auto score = [&] (double candidate)
    {
        double dot = 0.0, energy = 1.0e-9;
        for (int j = 0; j < taps; ++j)
        {
            const float s = reader->readMono (candidate + j * tapStep);
            dot += s * target[j];
            energy += s * s;
        }
        return dot / std::sqrt (energy);
    };

    const double low = std::max (regionStart, ideal - searchRadius);
    const double high = std::max (low, ideal + searchRadius);

    double best = ideal;
    double bestScore = -1.0e30;

    for (double candidate = low; candidate <= high; candidate += coarseCandidateStride)
    {
        if (const double s = score (candidate); s > bestScore)
        {
            bestScore = s;
            best = candidate;
        }
    }

    const double coarseBest = best;
    for (int offset = -(coarseCandidateStride - 1); offset <= coarseCandidateStride - 1; ++offset)
    {
        const double candidate = coarseBest + offset;
        if (offset == 0 || candidate < low || candidate > high)
            continue;

        if (const double s = score (candidate); s > bestScore)
        {
            bestScore = s;
            best = candidate;
        }
    }

    return best;
}

} // namespace obsidian
