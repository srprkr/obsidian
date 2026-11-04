#include "obsidian/Biquad.h"

#include <algorithm>
#include <cmath>

namespace obsidian
{

namespace
{
    constexpr double pi = 3.14159265358979323846;

    double clampCutoff (double cutoffHz, double sampleRate) noexcept
    {
        return std::clamp (cutoffHz, 10.0, sampleRate * 0.49);
    }

    double alphaFor (double w0, double qDb) noexcept
    {
        return std::sin (w0) / (2.0 * std::pow (10.0, qDb / 20.0));
    }
} // namespace

double emphasisToQ (float emphasis) noexcept
{
    return std::clamp (0.5 + std::pow (static_cast<double> (emphasis) / 2.6, 1.85), 0.5, 16.0);
}

BiquadCoeffs designLowPass (double cutoffHz, double qDb, double sampleRate) noexcept
{
    const double w0 = 2.0 * pi * clampCutoff (cutoffHz, sampleRate) / sampleRate;
    const double cosW0 = std::cos (w0);
    const double alpha = alphaFor (w0, qDb);
    const double a0 = 1.0 + alpha;

    BiquadCoeffs c;
    c.b0 = ((1.0 - cosW0) * 0.5) / a0;
    c.b1 = (1.0 - cosW0) / a0;
    c.b2 = c.b0;
    c.a1 = (-2.0 * cosW0) / a0;
    c.a2 = (1.0 - alpha) / a0;
    return c;
}

BiquadCoeffs designHighPass (double cutoffHz, double qDb, double sampleRate) noexcept
{
    const double w0 = 2.0 * pi * clampCutoff (cutoffHz, sampleRate) / sampleRate;
    const double cosW0 = std::cos (w0);
    const double alpha = alphaFor (w0, qDb);
    const double a0 = 1.0 + alpha;

    BiquadCoeffs c;
    c.b0 = ((1.0 + cosW0) * 0.5) / a0;
    c.b1 = -(1.0 + cosW0) / a0;
    c.b2 = c.b0;
    c.a1 = (-2.0 * cosW0) / a0;
    c.a2 = (1.0 - alpha) / a0;
    return c;
}

BiquadCoeffs designOnePoleLowPass (double cutoffHz, double sampleRate) noexcept
{
    const double k = std::tan (pi * clampCutoff (cutoffHz, sampleRate) / sampleRate);
    BiquadCoeffs c;
    c.b0 = k / (1.0 + k);
    c.b1 = c.b0;
    c.a1 = (k - 1.0) / (k + 1.0);
    return c;
}

BiquadCoeffs designOnePoleHighPass (double cutoffHz, double sampleRate) noexcept
{
    const double k = std::tan (pi * clampCutoff (cutoffHz, sampleRate) / sampleRate);
    BiquadCoeffs c;
    c.b0 = 1.0 / (1.0 + k);
    c.b1 = -c.b0;
    c.a1 = (k - 1.0) / (k + 1.0);
    return c;
}

FilterDesign designFilter (FilterType type, const FilterParams& params, double sampleRate) noexcept
{
    FilterDesign design;

    const bool isHighPass = type == FilterType::HighPass;
    const bool audible = isHighPass ? params.cutoffHz > 20.0f
                                    : (params.cutoffHz < 20000.0f || params.resonance > 1.0f);

    if (! params.enabled || ! audible || sampleRate <= 0.0)
        return design;

    const double q = emphasisToQ (params.resonance);
    const auto biquad = [&] (double qDb)
    {
        return isHighPass ? designHighPass (params.cutoffHz, qDb, sampleRate)
                          : designLowPass  (params.cutoffHz, qDb, sampleRate);
    };

    design.active = true;

    switch (params.slope)
    {
        case FilterSlope::Db12:
            design.numSections = 1;
            design.sections[0] = biquad (q);
            break;

        case FilterSlope::Db18:
            design.numSections = 2;
            design.sections[0] = biquad (q);
            design.sections[1] = isHighPass ? designOnePoleHighPass (params.cutoffHz, sampleRate)
                                            : designOnePoleLowPass  (params.cutoffHz, sampleRate);
            break;

        case FilterSlope::Db24:
            design.numSections = 2;
            design.sections[0] = biquad (std::sqrt (q));
            design.sections[1] = biquad (std::sqrt (q) * 1.15);
            break;
    }

    return design;
}

} // namespace obsidian
