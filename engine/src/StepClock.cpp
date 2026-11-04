#include "obsidian/StepClock.h"

#include <algorithm>
#include <cmath>

namespace obsidian
{

void StepClock::start (int startOffset) noexcept
{
    running = true;
    const double offset = std::max (0, startOffset);

    if (followingHost)
    {
        // Wait for the next grid line of the song.
        const double beatNow = blockStartBeat + offset * beatsPerSample;
        lastTick = static_cast<int64_t> (std::ceil (beatNow / tickBeats - 1.0e-9)) - 1;
    }
    else
    {
        // Free-running: tick 0 fires right now.
        blockStartBeat = -offset * beatsPerSample;
        lastTick = -1;
    }
}

void StepClock::beginBlock (const TransportInfo& transport, double bpm, double newTickBeats,
                            double sampleRate, bool followHost) noexcept
{
    beatsPerSample = std::max (bpm, 1.0) / 60.0 / std::max (sampleRate, 1.0);

    const bool host = followHost && transport.isPlaying && transport.hasPpqPosition;
    const bool tickLengthChanged = std::abs (newTickBeats - tickBeats) > 1.0e-9;
    tickBeats = std::max (newTickBeats, 1.0e-4);

    if (host)
    {
        blockStartBeat = transport.ppqPosition;

        const auto expectedTick = static_cast<int64_t> (std::ceil (blockStartBeat / tickBeats - 1.0e-9)) - 1;
        const bool jumped = lastTick < expectedTick - 1 || lastTick > expectedTick + 1;

        // Resync on a host jump (loop / locate), when switching from free-running, or when the
        // step length changes - otherwise a burst of catch-up ticks would fire.
        if (! followingHost || jumped || tickLengthChanged)
            lastTick = expectedTick;
    }
    else if (tickLengthChanged)
    {
        lastTick = static_cast<int64_t> (std::floor (blockStartBeat / tickBeats));
    }

    followingHost = host;
}

int StepClock::nextTickOffset (int numSamples) const noexcept
{
    if (! running)
        return -1;

    const double tickBeat = static_cast<double> (lastTick + 1) * tickBeats;
    const double offset = std::ceil ((tickBeat - blockStartBeat) / beatsPerSample - 1.0e-6);

    if (offset >= numSamples)
        return -1;

    return static_cast<int> (std::max (0.0, offset));
}

void StepClock::endBlock (int numSamples) noexcept
{
    // In host mode the next block's beginBlock() overwrites this with the host position.
    blockStartBeat += numSamples * beatsPerSample;
}

} // namespace obsidian
