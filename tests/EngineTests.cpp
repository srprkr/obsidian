// Behavioural tests for the DSP engine. Plain C++, no test framework required:
// each TEST registers itself, main() runs them all and returns non-zero on failure.

#include "obsidian/Arpeggiator.h"
#include "obsidian/Biquad.h"
#include "obsidian/Envelope.h"
#include "obsidian/RegionReader.h"
#include "obsidian/SamplerEngine.h"
#include "obsidian/StepClock.h"

#include <chrono>
#include <cmath>
#include <complex>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <vector>

using namespace obsidian;

//==============================================================================
namespace
{
    struct TestCase { const char* name; std::function<void()> body; };
    std::vector<TestCase>& registry() { static std::vector<TestCase> tests; return tests; }
    int failures = 0;

    struct Registrar
    {
        Registrar (const char* name, std::function<void()> body) { registry().push_back ({ name, std::move (body) }); }
    };

    void check (bool condition, const char* expression, const char* file, int line, const std::string& detail = {})
    {
        if (condition)
            return;
        ++failures;
        std::printf ("    FAILED %s:%d  %s %s\n", file, line, expression, detail.c_str());
    }
} // namespace

#define TEST(name) static void name(); static Registrar name##_registrar (#name, name); static void name()
#define CHECK(expr) check ((expr), #expr, __FILE__, __LINE__)
#define CHECK_NEAR(a, b, tolerance) \
    check (std::abs ((a) - (b)) <= (tolerance), #a " ~= " #b, __FILE__, __LINE__, \
           "(" + std::to_string (a) + " vs " + std::to_string (b) + ")")

//==============================================================================
namespace
{
    constexpr double testRate = 48000.0;
    constexpr double pi = 3.14159265358979323846;

    SamplePtr makeSine (double frequency, double seconds, double rate = testRate)
    {
        auto sample = std::make_shared<SampleData>();
        sample->sampleRate = rate;
        sample->name = "sine";
        sample->channels.resize (1);
        const auto frames = static_cast<size_t> (seconds * rate);
        sample->channels[0].resize (frames);
        for (size_t i = 0; i < frames; ++i)
            sample->channels[0][i] = static_cast<float> (0.5 * std::sin (2.0 * pi * frequency * static_cast<double> (i) / rate));
        return sample;
    }

    struct Render
    {
        std::vector<float> left, right;
    };

    /** Runs the engine for `seconds`, applying events at the given absolute sample times. */
    Render run (SamplerEngine& engine, double seconds, std::vector<std::pair<int, NoteEvent>> timedEvents = {},
                TransportInfo transport = {}, int blockSize = 256)
    {
        const int total = static_cast<int> (seconds * testRate);
        Render out;
        out.left.resize (static_cast<size_t> (total));
        out.right.resize (static_cast<size_t> (total));

        for (int start = 0; start < total; start += blockSize)
        {
            const int n = std::min (blockSize, total - start);
            std::vector<NoteEvent> events;
            for (auto& [time, event] : timedEvents)
                if (time >= start && time < start + n)
                {
                    NoteEvent e = event;
                    e.sampleOffset = time - start;
                    events.push_back (e);
                }

            engine.process (out.left.data() + start, out.right.data() + start, n, transport,
                            events.data(), static_cast<int> (events.size()));

            if (transport.isPlaying)
                transport.ppqPosition += n / testRate * transport.bpm / 60.0;
        }
        return out;
    }

    NoteEvent noteOn (int note, int velocity = 127) { return { NoteEvent::Type::NoteOn, 0, note, velocity, 0.0f }; }
    NoteEvent noteOff (int note) { return { NoteEvent::Type::NoteOff, 0, note, 0, 0.0f }; }

    /** Frequency estimate from upward zero crossings in [from, to). */
    double estimateFrequency (const std::vector<float>& signal, size_t from, size_t to)
    {
        int crossings = 0;
        size_t first = 0, last = 0;
        for (size_t i = from + 1; i < to; ++i)
            if (signal[i - 1] < 0.0f && signal[i] >= 0.0f)
            {
                if (crossings == 0) first = i;
                last = i;
                ++crossings;
            }
        if (crossings < 2)
            return 0.0;
        return (crossings - 1) * testRate / static_cast<double> (last - first);
    }

    double rms (const std::vector<float>& signal, size_t from, size_t to)
    {
        double sum = 0.0;
        for (size_t i = from; i < to; ++i)
            sum += signal[i] * signal[i];
        return std::sqrt (sum / static_cast<double> (std::max<size_t> (1, to - from)));
    }

    /** Index of the last sample louder than threshold. */
    size_t lastAudibleSample (const std::vector<float>& signal, float threshold = 1.0e-3f)
    {
        for (size_t i = signal.size(); i-- > 0;)
            if (std::abs (signal[i]) > threshold)
                return i;
        return 0;
    }

    /** Sample indices where the signal rises from silence. */
    std::vector<size_t> onsets (const std::vector<float>& signal, float threshold = 0.02f, size_t minGap = 2000)
    {
        std::vector<size_t> result;
        size_t quietRun = minGap;
        for (size_t i = 0; i < signal.size(); ++i)
        {
            if (std::abs (signal[i]) > threshold)
            {
                if (quietRun >= minGap)
                    result.push_back (i);
                quietRun = 0;
            }
            else
            {
                ++quietRun;
            }
        }
        return result;
    }

    double magnitudeDb (const FilterDesign& design, double frequency, double rate)
    {
        const std::complex<double> z = std::polar (1.0, -2.0 * pi * frequency / rate);
        std::complex<double> h = 1.0;
        for (int s = 0; s < design.numSections; ++s)
        {
            const auto& c = design.sections[static_cast<size_t> (s)];
            h *= (c.b0 + c.b1 * z + c.b2 * z * z) / (1.0 + c.a1 * z + c.a2 * z * z);
        }
        return 20.0 * std::log10 (std::abs (h));
    }

    SamplerEngine makeEngine (SamplePtr sample, EngineParams params = {})
    {
        SamplerEngine engine;
        engine.prepare (testRate, 256);
        engine.setParams (params);
        engine.setSamples (std::move (sample), nullptr);
        return engine;
    }

    EngineParams plainParams()
    {
        EngineParams p;
        p.tempoSync = false;
        p.preserveSpeed = false;
        p.decaySec = 0.01f;
        p.sustainLevel = 1.0f;
        p.releaseSec = 0.05f;
        return p;
    }
} // namespace

//==============================================================================
TEST (filtersPassAndRejectTheRightBands)
{
    for (auto slope : { FilterSlope::Db12, FilterSlope::Db18, FilterSlope::Db24 })
    {
        const auto lowPass = designFilter (FilterType::LowPass, { true, 1000.0f, 1.0f, slope }, testRate);
        const auto highPass = designFilter (FilterType::HighPass, { true, 1000.0f, 1.0f, slope }, testRate);

        CHECK (lowPass.active && highPass.active);
        CHECK_NEAR (magnitudeDb (lowPass, 20.0, testRate), 0.0, 1.5);
        CHECK (magnitudeDb (lowPass, 8000.0, testRate) < -30.0);
        CHECK_NEAR (magnitudeDb (highPass, 15000.0, testRate), 0.0, 1.5);
        CHECK (magnitudeDb (highPass, 125.0, testRate) < -30.0);
    }

    // Steeper slopes attenuate more two octaves above the cutoff.
    const auto at = [] (FilterSlope s) { return magnitudeDb (designFilter (FilterType::LowPass, { true, 1000.0f, 1.0f, s }, testRate), 4000.0, testRate); };
    CHECK (at (FilterSlope::Db12) > at (FilterSlope::Db18));
    CHECK (at (FilterSlope::Db18) > at (FilterSlope::Db24));
}

TEST (inaudibleFiltersAreSkipped)
{
    CHECK (! designFilter (FilterType::HighPass, { true, 20.0f, 1.0f, FilterSlope::Db12 }, testRate).active);
    CHECK (! designFilter (FilterType::LowPass, { true, 20000.0f, 1.0f, FilterSlope::Db24 }, testRate).active);
    CHECK (designFilter (FilterType::LowPass, { true, 20000.0f, 4.0f, FilterSlope::Db24 }, testRate).active);
    CHECK (! designFilter (FilterType::LowPass, { false, 500.0f, 4.0f, FilterSlope::Db24 }, testRate).active);
}

TEST (envelopeFollowsLinearSegments)
{
    LinearAdsr env;
    env.setSampleRate (1000.0);
    env.noteOn (0.1f, 0.1f, 0.5f);

    float level = 0.0f;
    for (int i = 0; i < 50; ++i) level = env.next();
    CHECK_NEAR (level, 0.5f, 0.02f);                 // halfway up the attack
    for (int i = 0; i < 100; ++i) level = env.next();
    CHECK_NEAR (level, 0.75f, 0.02f);                // halfway down the decay
    for (int i = 0; i < 100; ++i) level = env.next();
    CHECK (env.getStage() == LinearAdsr::Stage::Sustain);
    CHECK_NEAR (level, 0.5f, 1.0e-4f);

    env.release (0.2f);
    for (int i = 0; i < 100; ++i) level = env.next();
    CHECK_NEAR (level, 0.25f, 0.02f);
    for (int i = 0; i < 110; ++i) env.next();
    CHECK (! env.isActive());
}

TEST (loopSeamIsContinuous)
{
    // A ramp makes any discontinuity obvious.
    SampleData ramp;
    ramp.sampleRate = testRate;
    ramp.channels.resize (1);
    for (int i = 0; i < 48000; ++i)
        ramp.channels[0].push_back (static_cast<float> (std::sin (i * 0.01)));

    for (double loopStart : { 0.0, 10000.0 })
    {
        PlaybackRegion region;
        region.start = 0.0;
        region.end = 47999.0;
        region.looping = true;
        region.loopStart = loopStart;
        region.loopEnd = 30000.0;
        region.crossfade = 2000.0;

        const RegionReader reader (ramp, region);
        float previous = 0.0f, l, r;
        float largestStep = 0.0f;
        for (double v = 0.0; v < 200000.0; v += 1.0)
        {
            reader.read (v, l, r);
            if (v > 0.0)
                largestStep = std::max (largestStep, std::abs (l - previous));
            previous = l;
        }
        // sin(i * 0.01) changes by at most ~0.01 per sample; a click would be far larger.
        CHECK (largestStep < 0.05f);
    }
}

TEST (oneShotPlaysTheRegionAtRootPitch)
{
    auto engine = makeEngine (makeSine (440.0, 1.0), plainParams());
    const auto out = run (engine, 1.5, { { 0, noteOn (60) } });

    CHECK_NEAR (estimateFrequency (out.left, 4800, 40000), 440.0, 2.0);
    // Mono sources are panned centre with the equal-power law (-3 dB per side).
    CHECK_NEAR (rms (out.left, 4800, 40000), 0.5 / std::sqrt (2.0) * std::sqrt (0.5), 0.02);
    CHECK_NEAR (static_cast<double> (lastAudibleSample (out.left)), 48000.0, 400.0);
}

TEST (keysTransposeAndChangeSpeedWithoutPreserveSpeed)
{
    auto engine = makeEngine (makeSine (440.0, 1.0), plainParams());
    const auto out = run (engine, 1.5, { { 0, noteOn (72) } });

    CHECK_NEAR (estimateFrequency (out.left, 2000, 20000), 880.0, 4.0);
    CHECK_NEAR (static_cast<double> (lastAudibleSample (out.left)), 24000.0, 400.0); // twice as fast
}

TEST (preserveSpeedKeepsDurationWhileTransposing)
{
    auto params = plainParams();
    params.preserveSpeed = true;

    for (int note : { 72, 53 })
    {
        auto engine = makeEngine (makeSine (440.0, 1.0), params);
        const auto out = run (engine, 1.5, { { 0, noteOn (note) } });
        const double expected = 440.0 * std::pow (2.0, (note - 60) / 12.0);

        CHECK_NEAR (estimateFrequency (out.left, 4800, 40000), expected, expected * 0.01);
        CHECK_NEAR (static_cast<double> (lastAudibleSample (out.left)), 48000.0, 2500.0);
    }
}

TEST (tempoSyncStretchesToHostTempo)
{
    auto params = plainParams();
    params.preserveSpeed = true;
    params.tempoSync = true;
    params.sampleBpm = 120.0f;

    TransportInfo transport;
    transport.bpm = 60.0; // half the sample tempo -> twice as long, same pitch

    auto engine = makeEngine (makeSine (440.0, 1.0), params);
    const auto out = run (engine, 2.5, { { 0, noteOn (60) } }, transport);

    CHECK_NEAR (estimateFrequency (out.left, 4800, 80000), 440.0, 5.0);
    CHECK_NEAR (static_cast<double> (lastAudibleSample (out.left)), 96000.0, 3000.0);
}

TEST (loopModeSustainsWhileHeldAndReleasesOnNoteOff)
{
    auto params = plainParams();
    params.playbackMode = PlaybackMode::Loop;
    params.loopStartPos = 0.25f;
    params.loopEndPos = 0.75f;

    auto engine = makeEngine (makeSine (440.0, 0.5), params);
    const auto out = run (engine, 3.0, { { 0, noteOn (60) }, { 96000, noteOff (60) } });

    CHECK (rms (out.left, 80000, 90000) > 0.1);                 // still sounding long after the sample's end
    CHECK (lastAudibleSample (out.left) < 96000 + 0.06 * testRate); // 50 ms release
}

TEST (velocityScalesLevel)
{
    auto loud = makeEngine (makeSine (440.0, 1.0), plainParams());
    auto soft = makeEngine (makeSine (440.0, 1.0), plainParams());
    const auto a = run (loud, 0.5, { { 0, noteOn (60, 127) } });
    const auto b = run (soft, 0.5, { { 0, noteOn (60, 64) } });

    CHECK_NEAR (rms (b.left, 4800, 20000) / rms (a.left, 4800, 20000), std::pow (64.0 / 127.0, 1.25), 0.01);
}

TEST (releaseTriggerPlaysATailOnNoteOff)
{
    auto params = plainParams();
    params.releaseTriggerEnabled = true;
    params.releaseTriggerPos = 0.5f;
    params.releaseSec = 0.01f;

    auto engine = makeEngine (makeSine (440.0, 2.0), params);
    const auto out = run (engine, 2.5, { { 0, noteOn (60) }, { 24000, noteOff (60) } });

    // Note releases in 10 ms, but the tail (1 s of sample from the halfway point) keeps going.
    CHECK (rms (out.left, 40000, 60000) > 0.1);
    CHECK_NEAR (static_cast<double> (lastAudibleSample (out.left)), 24000.0 + 48000.0, 1500.0);
}

TEST (extremeFilterSettingsStayFinite)
{
    auto params = plainParams();
    params.lowPass = { true, 20.0f, 10.0f, FilterSlope::Db24 };
    params.highPass = { true, 19000.0f, 10.0f, FilterSlope::Db18 };

    auto engine = makeEngine (makeSine (440.0, 1.0), params);
    const auto out = run (engine, 1.0, { { 0, noteOn (60) } });

    bool finite = true;
    for (float s : out.left) finite = finite && std::isfinite (s);
    CHECK (finite);
}

TEST (freeRunningClockTicksImmediatelyThenEvenly)
{
    StepClock clock;
    TransportInfo transport;
    std::vector<int64_t> tickTimes;

    for (int block = 0; block < 100; ++block)
    {
        clock.beginBlock (transport, 120.0, 0.125, testRate, true);
        if (block == 2)
            clock.start (100);

        for (int offset; (offset = clock.nextTickOffset (512)) >= 0;)
        {
            clock.consumeTick();
            tickTimes.push_back (block * 512 + offset);
        }
        clock.endBlock (512);
    }

    CHECK (tickTimes.size() > 10);
    CHECK (tickTimes[0] == 2 * 512 + 100);
    for (size_t i = 1; i < tickTimes.size(); ++i)
        CHECK_NEAR (static_cast<double> (tickTimes[i] - tickTimes[i - 1]), 3000.0, 1.0); // 1/32 note at 120 BPM
}

TEST (hostSyncedClockFollowsSongPosition)
{
    StepClock clock;
    TransportInfo transport;
    transport.isPlaying = true;
    transport.hasPpqPosition = true;
    transport.bpm = 120.0;
    transport.ppqPosition = 3.9; // just before beat 4

    std::vector<double> tickBeats;
    clock.beginBlock (transport, 120.0, 0.25, testRate, true);
    clock.start (0);

    for (int block = 0; block < 60; ++block)
    {
        if (block > 0)
            clock.beginBlock (transport, 120.0, 0.25, testRate, true);

        for (int offset; (offset = clock.nextTickOffset (512)) >= 0;)
        {
            const auto index = clock.consumeTick();
            tickBeats.push_back (static_cast<double> (index) * 0.25);
            (void) offset;
        }
        clock.endBlock (512);
        transport.ppqPosition += 512 / testRate * 2.0;
    }

    CHECK (! tickBeats.empty());
    CHECK_NEAR (tickBeats.front(), 4.0, 1.0e-9); // waits for the grid, doesn't fire at 3.9
}

TEST (sequencerPlaysEnabledStepsOnTheGrid)
{
    auto params = plainParams();
    params.sequencerEnabled = true;
    params.sequencerSteps = 8;
    params.sequencerHostSync = false;
    params.sequencerBpm = 120.0f; // sixteenth = 6000 samples

    StepPattern pattern {};
    pattern[0].first.on = true;
    pattern[4].first.on = true;

    auto engine = makeEngine (makeSine (440.0, 0.05), params);
    engine.setPattern (pattern);
    const auto out = run (engine, 1.1, { { 1000, noteOn (60) } });

    const auto hits = onsets (out.left);
    CHECK (hits.size() >= 3);
    if (hits.size() >= 3)
    {
        CHECK_NEAR (static_cast<double> (hits[0]), 1000.0, 60.0);
        CHECK_NEAR (static_cast<double> (hits[1] - hits[0]), 24000.0, 60.0);
        CHECK_NEAR (static_cast<double> (hits[2] - hits[1]), 24000.0, 60.0);
    }
}

TEST (sequencerStopsWhenKeysAreReleased)
{
    auto params = plainParams();
    params.sequencerEnabled = true;
    params.sequencerHostSync = false;

    StepPattern pattern {};
    for (auto& step : pattern) step.first.on = true;

    auto engine = makeEngine (makeSine (440.0, 0.05), params);
    engine.setPattern (pattern);
    const auto out = run (engine, 1.0, { { 0, noteOn (60) }, { 20000, noteOff (60) } });

    CHECK (lastAudibleSample (out.left) < 20000 + 3000);
}

TEST (arpeggiatorOrdersNotes)
{
    NoteList held, out;
    held.add (64);
    held.add (60);
    held.add (67);

    buildArpSequence (held, 1, ArpPattern::Up, out);
    CHECK (out.size == 3 && out.notes[0] == 60 && out.notes[1] == 64 && out.notes[2] == 67);

    buildArpSequence (held, 2, ArpPattern::Down, out);
    CHECK (out.size == 6 && out.notes[0] == 79 && out.notes[5] == 60);

    buildArpSequence (held, 1, ArpPattern::UpDown, out);
    CHECK (out.size == 4 && out.notes[3] == 64); // 60 64 67 64
}

TEST (arpeggiatorStepsThroughHeldNotes)
{
    auto params = plainParams();
    params.arpEnabled = true;
    params.arpOctaves = 1;
    params.arpDivisionBeats = 0.25f;
    params.arpGate = 0.5f;

    auto engine = makeEngine (makeSine (440.0, 1.0), params);
    const auto out = run (engine, 0.5, { { 0, noteOn (60) }, { 0, noteOn (72) } });

    // Step 1 (0..6000) plays 60 at 440 Hz, step 2 plays 72 at 880 Hz.
    CHECK_NEAR (estimateFrequency (out.left, 300, 2800), 440.0, 10.0);
    CHECK_NEAR (estimateFrequency (out.left, 6300, 8800), 880.0, 15.0);
}

TEST (sixteenStretchedVoicesRunFasterThanRealTime)
{
    auto params = plainParams();
    params.preserveSpeed = true;
    params.playbackMode = PlaybackMode::Loop;
    params.lowPass = { true, 3000.0f, 3.0f, FilterSlope::Db24 };

    auto engine = makeEngine (makeSine (220.0, 4.0), params);
    std::vector<std::pair<int, NoteEvent>> chord;
    for (int i = 0; i < 16; ++i)
        chord.push_back ({ 0, noteOn (48 + i * 2) });

    const auto begin = std::chrono::steady_clock::now();
    run (engine, 4.0, chord);
    const double elapsed = std::chrono::duration<double> (std::chrono::steady_clock::now() - begin).count();

    std::printf ("    16 stretched voices: %.1f%% of real time\n", elapsed / 4.0 * 100.0);
    CHECK (elapsed < 4.0); // generous: must at least keep up, even in debug builds
}

//==============================================================================
int main()
{
    for (const auto& test : registry())
    {
        const int before = failures;
        test.body();
        std::printf ("%s %s\n", failures == before ? "[ ok ]" : "[FAIL]", test.name);
    }

    std::printf ("\n%zu tests, %d failed checks\n", registry().size(), failures);
    return failures == 0 ? 0 : 1;
}
