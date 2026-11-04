#include "obsidian/Voice.h"

#include <algorithm>
#include <cmath>

namespace obsidian
{

namespace
{
    constexpr double halfPi = 1.57079632679489661923;
    constexpr float quickFadeSec = 0.0035f; // the original's anti-click micro-fade
    constexpr float tailFadeOutSec = 0.02f;
    constexpr float tailFadeInSec = 0.001f;
} // namespace

void Voice::start (const VoiceStartInfo& info, const GrainWindow& window, double newSampleRate, uint64_t newOrder)
{
    active = info.sample != nullptr && info.sample->numFrames() > 1;
    if (! active)
        return;

    kind = info.kind;
    note = info.note;
    sample = info.sample;
    order = newOrder;
    sampleRate = newSampleRate;
    velocityGain = info.gain;
    monoSource = info.sample->numChannels() < 2;

    reader = RegionReader (*info.sample, info.region);

    // Search ±12 ms of source audio for the best grain alignment, like the original WSOLA.
    const double searchRadius = std::min (0.4 * window.length * info.pitchRate, 0.012 * info.sample->sampleRate);
    player.start (reader, window, info.pitchRate, info.contentRate, searchRadius);

    gateSamplesRemaining = info.gateSamples;
    gateEndsWithQuickFade = info.gateEndsWithQuickFade;
    quickFadeLength = std::max (1, static_cast<int> (quickFadeSec * sampleRate));
    quickFadeRemaining = -1;

    // Web Audio StereoPannerNode equal-power law.
    const float pan = std::clamp (info.pan, -1.0f, 1.0f);
    if (monoSource)
    {
        const double x = (pan + 1.0) * 0.5;
        panLeftGain = static_cast<float> (std::cos (x * halfPi));
        panRightGain = static_cast<float> (std::sin (x * halfPi));
    }
    else
    {
        const double x = pan <= 0.0f ? pan + 1.0 : pan;
        panToLeft = pan <= 0.0f;
        panLeftGain = static_cast<float> (std::cos (x * halfPi));
        panRightGain = static_cast<float> (std::sin (x * halfPi));
    }

    envelope.setSampleRate (sampleRate);
    envelope.reset();

    if (kind == VoiceStartInfo::Kind::Note)
    {
        envelope.noteOn (info.attackSec, info.decaySec, info.sustainLevel);
        endFadeFrames = std::max (1.0, quickFadeSec * sampleRate * info.contentRate);
    }
    else
    {
        tailFadeInLength = std::max (1, static_cast<int> (tailFadeInSec * sampleRate));
        tailFadeInRemaining = tailFadeInLength;
        const double regionFrames = info.region.end - info.region.start;
        endFadeFrames = std::max (1.0, std::min (tailFadeOutSec * sampleRate * info.contentRate, regionFrames * 0.2));
    }

    highPassWasActive = lowPassWasActive = false;
    for (auto& section : highPassState) for (auto& s : section) s.reset();
    for (auto& section : lowPassState)  for (auto& s : section) s.reset();
}

bool Voice::isReleasing() const noexcept
{
    return kind == VoiceStartInfo::Kind::ReleaseTail
        || quickFadeRemaining >= 0
        || envelope.getStage() == LinearAdsr::Stage::Release;
}

void Voice::release (float releaseSec) noexcept
{
    if (! active)
        return;

    if (kind == VoiceStartInfo::Kind::ReleaseTail)
        return; // tails always play to their end

    gateSamplesRemaining = -1;
    envelope.release (releaseSec);
}

void Voice::quickFade() noexcept
{
    if (! active || quickFadeRemaining >= 0)
        return;

    gateSamplesRemaining = -1;
    quickFadeRemaining = quickFadeLength;
}

float Voice::endFadeGain() const noexcept
{
    const double remaining = reader.framesRemaining (player.getContentPosition());
    return static_cast<float> (std::clamp (remaining / endFadeFrames, 0.0, 1.0));
}

float Voice::processFilters (float x, int channel, const VoiceRenderContext& context) noexcept
{
    if (context.highPass.active)
        for (int s = 0; s < context.highPass.numSections; ++s)
            x = highPassState[s][channel].process (x, context.highPass.sections[static_cast<size_t> (s)]);

    if (context.lowPass.active)
        for (int s = 0; s < context.lowPass.numSections; ++s)
            x = lowPassState[s][channel].process (x, context.lowPass.sections[static_cast<size_t> (s)]);

    return x;
}

void Voice::render (float* left, float* right, int numSamples, const VoiceRenderContext& context) noexcept
{
    if (! active)
        return;

    const bool isNote = kind == VoiceStartInfo::Kind::Note;

    if (isNote)
    {
        // A filter that was just switched on starts from silence rather than stale state.
        if (context.highPass.active && ! highPassWasActive)
            for (auto& section : highPassState) for (auto& s : section) s.reset();
        if (context.lowPass.active && ! lowPassWasActive)
            for (auto& section : lowPassState) for (auto& s : section) s.reset();

        highPassWasActive = context.highPass.active;
        lowPassWasActive = context.lowPass.active;
    }

    for (int i = 0; i < numSamples; ++i)
    {
        if (reader.framesRemaining (player.getContentPosition()) <= 0.0)
        {
            active = false;
            return;
        }

        float l, r;
        player.next (l, r);

        float fade = endFadeGain();
        if (quickFadeRemaining >= 0)
        {
            if (quickFadeRemaining == 0)
            {
                active = false;
                return;
            }
            fade *= static_cast<float> (quickFadeRemaining--) / static_cast<float> (quickFadeLength);
        }

        if (! isNote)
        {
            if (tailFadeInRemaining > 0)
                fade *= 1.0f - static_cast<float> (tailFadeInRemaining--) / static_cast<float> (tailFadeInLength + 1);

            left[i] += l * velocityGain * fade;
            right[i] += r * velocityGain * fade;
            continue;
        }

        if (gateSamplesRemaining > 0 && --gateSamplesRemaining == 0)
        {
            if (gateEndsWithQuickFade)
                quickFade();
            else
                envelope.release (context.releaseSec);
        }

        const float env = envelope.next();
        if (! envelope.isActive())
        {
            active = false;
            return;
        }

        const float gain = env * velocityGain * fade;

        if (monoSource)
        {
            const float m = processFilters (l, 0, context) * gain;
            left[i] += m * panLeftGain;
            right[i] += m * panRightGain;
        }
        else
        {
            l = processFilters (l, 0, context) * gain;
            r = processFilters (r, 1, context) * gain;

            if (panToLeft)
            {
                left[i] += l + r * panLeftGain;
                right[i] += r * panRightGain;
            }
            else
            {
                left[i] += l * panLeftGain;
                right[i] += r + l * panRightGain;
            }
        }
    }
}

float Voice::getPlayheadFraction() const noexcept
{
    const auto frames = reader.getNumFrames();
    if (frames <= 1)
        return 0.0f;

    return static_cast<float> (reader.toSamplePosition (player.getContentPosition()) / static_cast<double> (frames - 1));
}

float Voice::getRegionProgress() const noexcept
{
    const auto& region = reader.getRegion();
    const double length = region.end - region.start;
    if (length <= 0.0)
        return 0.0f;

    return static_cast<float> (std::clamp ((player.getContentPosition() - region.start) / length, 0.0, 1.0));
}

} // namespace obsidian
