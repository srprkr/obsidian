#pragma once

#include "EngineParams.h"

#include <cstdint>

namespace obsidian
{

/**
    Sample-accurate tick source for the sequencer and arpeggiator.

    Ticks fall on multiples of `tickBeats`. While the host transport is playing the clock follows
    the host's beat position, so patterns line up with the song. Otherwise it free-runs from the
    moment it was started, firing its first tick immediately (the original app's behaviour when
    a key is pressed).

    Usage per block (beginBlock/endBlock must be called every block, running or not):
        beginBlock (...)
        start (offset) / stop() as needed
        while ((offset = nextTickOffset (numSamples)) >= 0 && offset <= position) { consumeTick(); ... }
        endBlock (numSamples)
*/
class StepClock
{
public:
    /** Starts the clock at a sample offset within the current block. */
    void start (int startOffset) noexcept;
    void stop() noexcept { running = false; }
    bool isRunning() const noexcept { return running; }

    void beginBlock (const TransportInfo& transport, double bpm, double tickBeats, double sampleRate, bool followHost) noexcept;

    /** Offset within the current block of the next tick, or -1 if none falls before numSamples. */
    int nextTickOffset (int numSamples) const noexcept;

    /** Marks the pending tick as fired and returns its absolute tick index. */
    int64_t consumeTick() noexcept { return ++lastTick; }

    void endBlock (int numSamples) noexcept;

private:
    bool running = false;
    bool followingHost = false;

    double tickBeats = 0.25;
    double beatsPerSample = 0.0;
    double blockStartBeat = 0.0; // beat position at sample 0 of the current block
    int64_t lastTick = -1;
};

} // namespace obsidian
