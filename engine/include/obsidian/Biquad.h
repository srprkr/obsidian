#pragma once

#include "EngineParams.h"

#include <array>

namespace obsidian
{

/** Normalised biquad coefficients (a0 == 1). One-pole sections set b2 = a2 = 0. */
struct BiquadCoeffs
{
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
};

/** Transposed direct form II state for one channel of one section. */
struct BiquadState
{
    double z1 = 0.0, z2 = 0.0;

    float process (float x, const BiquadCoeffs& c) noexcept
    {
        const double y = c.b0 * x + z1;
        z1 = c.b1 * x - c.a1 * y + z2;
        z2 = c.b2 * x - c.a2 * y;
        return static_cast<float> (y);
    }

    void reset() noexcept { z1 = z2 = 0.0; }
};

/** Maps the UI "emphasis" control (0.1..10) to a biquad Q, expressed in dB like Web Audio's BiquadFilterNode. */
double emphasisToQ (float emphasis) noexcept;

/** RBJ cookbook sections. qDb follows the Web Audio convention: alpha = sin(w0) / (2 * 10^(qDb/20)). */
BiquadCoeffs designLowPass  (double cutoffHz, double qDb, double sampleRate) noexcept;
BiquadCoeffs designHighPass (double cutoffHz, double qDb, double sampleRate) noexcept;
BiquadCoeffs designOnePoleLowPass  (double cutoffHz, double sampleRate) noexcept;
BiquadCoeffs designOnePoleHighPass (double cutoffHz, double sampleRate) noexcept;

/** A cascade of up to two sections implementing one 12 / 18 / 24 dB per octave filter. */
struct FilterDesign
{
    bool active = false;
    int numSections = 0;
    std::array<BiquadCoeffs, 2> sections {};
};

enum class FilterType { LowPass, HighPass };

/**
    Builds the filter cascade:
      12 dB/oct -> one resonant biquad
      18 dB/oct -> one resonant biquad + one-pole
      24 dB/oct -> two biquads, Q split as sqrt(q) and sqrt(q) * 1.15

    A filter that would have no audible effect (high-pass at 20 Hz, or low-pass fully open
    with no emphasis) is reported as inactive so voices can skip it.
*/
FilterDesign designFilter (FilterType type, const FilterParams& params, double sampleRate) noexcept;

} // namespace obsidian
