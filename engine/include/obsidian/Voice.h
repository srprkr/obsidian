#pragma once

#include "Biquad.h"
#include "Envelope.h"
#include "StretchPlayer.h"

#include <cstdint>

namespace obsidian
{

/** Per-block settings shared by every voice. */
struct VoiceRenderContext
{
    double sampleRate = 44100.0;
    FilterDesign highPass;
    FilterDesign lowPass;
    float releaseSec = 0.5f;
};

/** Everything needed to start a voice, worked out by the engine at trigger time. */
struct VoiceStartInfo
{
    enum class Kind { Note, ReleaseTail };

    Kind kind = Kind::Note;
    int note = 60;
    const SampleData* sample = nullptr;
    PlaybackRegion region;
    double pitchRate = 1.0;   // source frames per output sample (pitch)
    double contentRate = 1.0; // source frames per output sample (speed)
    float gain = 1.0f;        // velocity gain (master gain is applied by the engine)
    float pan = 0.0f;

    // Note voices only.
    float attackSec = 0.001f, decaySec = 0.8f, sustainLevel = 0.8f;

    /** Samples until an automatic note-off, or -1 to wait for an explicit release. */
    int gateSamples = -1;
    /** True: the gate ends with a 3.5 ms fade (step sequencer). False: with the normal release. */
    bool gateEndsWithQuickFade = true;
};

/**
    One playing note: stretch player -> high-pass -> low-pass -> ADSR -> pan.

    A ReleaseTail voice is the release-trigger sample played when a key goes up. Like the
    original app it bypasses the filters, envelope and panner, and fades out over its last 20 ms.
*/
class Voice
{
public:
    void start (const VoiceStartInfo& info, const GrainWindow& window, double sampleRate, uint64_t order);

    /** Moves to the release stage using releaseSec. */
    void release (float releaseSec) noexcept;

    /** Very short fade, used for retriggers, gate ends and pattern clears. */
    void quickFade() noexcept;

    void kill() noexcept { active = false; }

    /** Adds this voice's output to the buffers. */
    void render (float* left, float* right, int numSamples, const VoiceRenderContext& context) noexcept;

    bool isActive() const noexcept { return active; }
    bool isReleasing() const noexcept;
    bool isReleaseTail() const noexcept { return kind == VoiceStartInfo::Kind::ReleaseTail; }
    int getNote() const noexcept { return note; }
    float getVelocityGain() const noexcept { return velocityGain; }
    uint64_t getOrder() const noexcept { return order; }
    const SampleData* getSample() const noexcept { return sample; }

    /** Playhead as a fraction (0..1) of the sample, for the waveform display. */
    float getPlayheadFraction() const noexcept;
    /** Progress (0..1) through the voice's region; used for release-tail display. */
    float getRegionProgress() const noexcept;

private:
    float processFilters (float x, int channel, const VoiceRenderContext& context) noexcept;
    float endFadeGain() const noexcept;

    bool active = false;
    VoiceStartInfo::Kind kind = VoiceStartInfo::Kind::Note;
    int note = 0;
    uint64_t order = 0;
    const SampleData* sample = nullptr;
    double sampleRate = 44100.0;

    RegionReader reader;
    StretchPlayer player;
    LinearAdsr envelope;

    float velocityGain = 1.0f;
    float panLeftGain = 1.0f, panRightGain = 1.0f;
    bool panToLeft = true; // stereo sources: which side receives the cross-fed channel
    bool monoSource = true;

    int gateSamplesRemaining = -1;
    bool gateEndsWithQuickFade = true;

    int quickFadeLength = 1;
    int quickFadeRemaining = -1; // -1 = not fading

    int tailFadeInLength = 1;
    int tailFadeInRemaining = 0;
    double endFadeFrames = 1.0;

    bool highPassWasActive = false, lowPassWasActive = false;
    BiquadState highPassState[2][2]; // [section][channel]
    BiquadState lowPassState[2][2];
};

} // namespace obsidian
