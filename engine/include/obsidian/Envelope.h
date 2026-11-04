#pragma once

#include <algorithm>

namespace obsidian
{

/** Linear-segment ADSR, matching the original Web Audio linearRampToValueAtTime envelope. */
class LinearAdsr
{
public:
    enum class Stage { Idle, Attack, Decay, Sustain, Release };

    void setSampleRate (double newSampleRate) noexcept { sampleRate = newSampleRate; }

    void noteOn (float attackSec, float decaySec, float sustain) noexcept
    {
        sustainLevel = std::clamp (sustain, 0.0f, 1.0f);
        attackStep = 1.0f / samplesFor (std::max (attackSec, 0.001f));
        decayStep = (1.0f - sustainLevel) / samplesFor (std::max (decaySec, 0.01f));
        level = 0.0f;
        stage = Stage::Attack;
    }

    /** Ramps from the current level down to zero over releaseSec. */
    void release (float releaseSec) noexcept
    {
        if (stage == Stage::Idle)
            return;

        releaseStep = std::max (level, 1.0e-6f) / samplesFor (std::max (releaseSec, 0.001f));
        stage = Stage::Release;
    }

    void reset() noexcept
    {
        level = 0.0f;
        stage = Stage::Idle;
    }

    float next() noexcept
    {
        switch (stage)
        {
            case Stage::Idle:
                return 0.0f;

            case Stage::Attack:
                level += attackStep;
                if (level >= 1.0f)
                {
                    level = 1.0f;
                    stage = Stage::Decay;
                }
                break;

            case Stage::Decay:
                level -= decayStep;
                if (level <= sustainLevel)
                {
                    level = sustainLevel;
                    stage = Stage::Sustain;
                }
                break;

            case Stage::Sustain:
                break;

            case Stage::Release:
                level -= releaseStep;
                if (level <= 0.0f)
                {
                    level = 0.0f;
                    stage = Stage::Idle;
                }
                break;
        }

        return level;
    }

    Stage getStage() const noexcept { return stage; }
    bool isActive() const noexcept  { return stage != Stage::Idle; }
    float getLevel() const noexcept { return level; }

private:
    float samplesFor (float seconds) const noexcept
    {
        return std::max (1.0f, static_cast<float> (seconds * sampleRate));
    }

    double sampleRate = 44100.0;
    Stage stage = Stage::Idle;
    float level = 0.0f;
    float sustainLevel = 1.0f;
    float attackStep = 1.0f, decayStep = 0.0f, releaseStep = 1.0f;
};

} // namespace obsidian
