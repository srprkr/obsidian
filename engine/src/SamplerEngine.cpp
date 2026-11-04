#include "obsidian/SamplerEngine.h"

#include <algorithm>
#include <cmath>

namespace obsidian
{

namespace
{
    constexpr double auditionGateSec = 0.15;
    constexpr int arpVelocity = 105;
    constexpr float filterSmoothingSec = 0.02f;

    float velocityToGain (int velocity) noexcept
    {
        return static_cast<float> (std::pow (std::clamp (velocity, 0, 127) / 127.0, 1.25));
    }

    int positiveModulo (int64_t value, int64_t divisor) noexcept
    {
        return static_cast<int> (((value % divisor) + divisor) % divisor);
    }
} // namespace

//==============================================================================
void SamplerEngine::prepare (double newSampleRate, int /*maxBlockSize*/)
{
    sampleRate = newSampleRate > 0.0 ? newSampleRate : 44100.0;
    grainWindow.build (sampleRate);

    for (auto& voice : voices)
        voice.kill();

    sequencerClock.stop();
    arpClock.stop();
    renderContext.sampleRate = sampleRate;
    smoothedHighPassCutoff = params.highPass.cutoffHz;
    smoothedLowPassCutoff = params.lowPass.cutoffHz;
    smoothedMasterGain = params.masterGain;
}

void SamplerEngine::setSamples (SamplePtr newMain, SamplePtr newRelease) noexcept
{
    for (auto& voice : voices)
        voice.kill();

    mainSample = std::move (newMain);
    releaseSample = std::move (newRelease);
}

//==============================================================================
void SamplerEngine::process (float* left, float* right, int numSamples, const TransportInfo& newTransport,
                             const NoteEvent* events, int numEvents) noexcept
{
    std::fill (left, left + numSamples, 0.0f);
    std::fill (right, right + numSamples, 0.0f);

    transport = newTransport;
    if (transport.bpm <= 0.0)
        transport.bpm = 120.0;

    updateFilters (numSamples);

    const double sequencerTickBeats = 0.25 / std::max (0.125f, params.sequencerRate) / 2.0; // half steps
    const double arpTickBeats = params.arpDivisionBeats / std::max (0.125f, params.arpRate);
    sequencerClock.beginBlock (transport, sequencerBpm(), sequencerTickBeats, sampleRate, params.sequencerHostSync);
    arpClock.beginBlock (transport, transport.bpm, arpTickBeats, sampleRate, true);

    // Split the block at every MIDI event and clock tick so both land sample-accurately.
    int position = 0;
    int eventIndex = 0;

    for (;;)
    {
        while (eventIndex < numEvents && events[eventIndex].sampleOffset <= position)
            handleEvent (events[eventIndex++]);

        updateRunStates (position);

        for (int offset; (offset = sequencerClock.nextTickOffset (numSamples)) >= 0 && offset <= position;)
            onSequencerTick (sequencerClock.consumeTick(), position);

        for (int offset; (offset = arpClock.nextTickOffset (numSamples)) >= 0 && offset <= position;)
        {
            arpClock.consumeTick();
            onArpTick (position);
        }

        if (position >= numSamples)
            break;

        int next = numSamples;
        if (eventIndex < numEvents)
            next = std::min (next, std::max (position + 1, events[eventIndex].sampleOffset));
        if (const int tick = sequencerClock.nextTickOffset (numSamples); tick > position)
            next = std::min (next, tick);
        if (const int tick = arpClock.nextTickOffset (numSamples); tick > position)
            next = std::min (next, tick);

        renderVoices (left + position, right + position, next - position);
        position = next;
    }

    sequencerClock.endBlock (numSamples);
    arpClock.endBlock (numSamples);

    // Master gain, ramped across the block to avoid zipper noise.
    const float startGain = smoothedMasterGain;
    const float endGain = params.masterGain;
    float peakLeft = 0.0f, peakRight = 0.0f;

    for (int i = 0; i < numSamples; ++i)
    {
        const float gain = startGain + (endGain - startGain) * (static_cast<float> (i + 1) / static_cast<float> (numSamples));
        left[i] *= gain;
        right[i] *= gain;
        peakLeft = std::max (peakLeft, std::abs (left[i]));
        peakRight = std::max (peakRight, std::abs (right[i]));
    }
    smoothedMasterGain = endGain;

    telemetry.peakLeft = peakLeft;
    telemetry.peakRight = peakRight;
    writeTelemetry();
}

//==============================================================================
void SamplerEngine::handleEvent (const NoteEvent& event) noexcept
{
    const bool sequencerMode = params.sequencerEnabled;
    const bool arpMode = ! sequencerMode && params.arpEnabled && params.playbackMode == PlaybackMode::OneShot;

    switch (event.type)
    {
        case NoteEvent::Type::NoteOn:
            if (event.velocity <= 0)
            {
                handleEvent ({ NoteEvent::Type::NoteOff, event.sampleOffset, event.note, 0, 0.0f });
                return;
            }

            heldNotes.add (event.note);

            // With the sequencer or arpeggiator on, held keys drive the pattern instead of playing directly.
            if (! sequencerMode && ! arpMode)
                triggerNote (event.note, event.velocity, 0.0f, TriggerSource::Key, -1);
            break;

        case NoteEvent::Type::NoteOff:
            heldNotes.remove (event.note);

            if (! arpMode)
                releaseNote (event.note, true);
            break;

        case NoteEvent::Type::AllNotesOff:
            heldNotes.clear();
            releaseAllNotes (false);
            break;

        case NoteEvent::Type::Audition:
            triggerNote (event.note, event.velocity, event.pan, TriggerSource::Audition,
                         static_cast<int> (auditionGateSec * sampleRate));
            break;
    }
}

void SamplerEngine::updateRunStates (int offset) noexcept
{
    const bool runSequencer = sequencerShouldRun();

    if (runSequencer && ! sequencerClock.isRunning())
    {
        sequencerClock.start (offset);
        sequencerStep = sequencerHalf = 0;
    }
    else if (! runSequencer && sequencerClock.isRunning())
    {
        sequencerClock.stop();
        sequencerStep = sequencerHalf = 0;

        // Letting go of the keys lets notes release naturally (with release trigger); stopping
        // the transport or disabling the sequencer cuts them, as in the original app.
        const bool keysReleased = params.sequencerEnabled && ! manualRunRequested && heldNotes.size == 0;
        releaseAllNotes (keysReleased);
    }

    const bool runArp = arpShouldRun();

    if (runArp && ! arpClock.isRunning())
    {
        arpClock.start (offset);
        arpStepIndex = 0;
    }
    else if (! runArp && arpClock.isRunning())
    {
        arpClock.stop();
    }
}

void SamplerEngine::onSequencerTick (int64_t tickIndex, int /*offset*/) noexcept
{
    const int steps = std::clamp (params.sequencerSteps, 1, kMaxSequencerSteps);
    const int local = positiveModulo (tickIndex, static_cast<int64_t> (steps) * 2);
    sequencerStep = local / 2;
    sequencerHalf = local % 2;

    if (! patternHasAnyStep())
    {
        releaseAllNotes (false);
        return;
    }

    const auto& step = pattern[static_cast<size_t> (sequencerStep)];
    const StepHalf* half = sequencerHalf == 0 ? &step.first : (step.split ? &step.second : nullptr);

    if (half == nullptr || ! half->on)
        return;

    const double halfSamples = halfStepSamples();
    const int gate = static_cast<int> (std::lround (step.split ? halfSamples : halfSamples * 2.0));
    const int velocity = half->velocity > 0 ? half->velocity : 100;

    if (heldNotes.size > 0)
    {
        for (int i = 0; i < heldNotes.size; ++i)
            triggerNote (heldNotes.notes[i] + half->pitchOffset, velocity, half->pan, TriggerSource::Sequencer, gate);
    }
    else
    {
        triggerNote (params.rootNote + half->pitchOffset, velocity, half->pan, TriggerSource::Sequencer, gate);
    }
}

void SamplerEngine::onArpTick (int /*offset*/) noexcept
{
    buildArpSequence (heldNotes, params.arpOctaves, params.arpPattern, arpSequence);
    if (arpSequence.size == 0)
        return;

    const double stepSamples = 60.0 / transport.bpm * params.arpDivisionBeats / std::max (0.125f, params.arpRate) * sampleRate;
    const int gate = std::max (1, static_cast<int> (stepSamples * std::clamp (params.arpGate, 0.05f, 1.0f)));

    switch (params.arpPattern)
    {
        case ArpPattern::Chord:
            for (int i = 0; i < arpSequence.size; ++i)
                triggerNote (arpSequence.notes[i], arpVelocity, 0.0f, TriggerSource::Arpeggiator, gate);
            break;

        case ArpPattern::Random:
        {
            std::uniform_int_distribution<int> pick (0, arpSequence.size - 1);
            triggerNote (arpSequence.notes[pick (random)], arpVelocity, 0.0f, TriggerSource::Arpeggiator, gate);
            break;
        }

        case ArpPattern::Up:
        case ArpPattern::Down:
        case ArpPattern::UpDown:
            triggerNote (arpSequence.notes[arpStepIndex % arpSequence.size], arpVelocity, 0.0f, TriggerSource::Arpeggiator, gate);
            break;
    }

    arpStepIndex = (arpStepIndex + 1) % arpSequence.size;
}

//==============================================================================
bool SamplerEngine::computeRates (int note, const SampleData& sample, double& pitchRate, double& contentRate) const noexcept
{
    if (sample.sampleRate <= 0.0 || sampleRate <= 0.0)
        return false;

    const double pitch = std::pow (2.0, (note - params.rootNote) / 12.0);
    const double tempoFactor = (params.tempoSync && params.sampleBpm > 0.0f)
                                   ? transport.bpm / static_cast<double> (params.sampleBpm)
                                   : 1.0;

    // Preserve Speed: every key plays at the same tempo, only the pitch changes.
    const double speed = params.preserveSpeed ? tempoFactor : pitch * tempoFactor;
    const double sourceToOutput = sample.sampleRate / sampleRate;

    pitchRate = pitch * sourceToOutput;
    contentRate = speed * sourceToOutput;
    return true;
}

void SamplerEngine::triggerNote (int note, int velocity, float pan, TriggerSource source, int gateSamples) noexcept
{
    if (mainSample == nullptr || mainSample->numFrames() < 2)
        return;

    note = std::clamp (note, 0, 127);

    // Retriggering a note releases the one already sounding on it (without a release tail).
    for (auto& voice : voices)
        if (voice.isActive() && ! voice.isReleaseTail() && ! voice.isReleasing() && voice.getNote() == note)
            releaseVoice (voice, false);

    const SampleData& sample = *mainSample;
    VoiceStartInfo info;
    if (! computeRates (note, sample, info.pitchRate, info.contentRate))
        return;

    const double lastFrame = static_cast<double> (sample.numFrames() - 1);
    const bool oneShot = params.playbackMode == PlaybackMode::OneShot;
    const bool fromKey = source == TriggerSource::Key;

    info.kind = VoiceStartInfo::Kind::Note;
    info.note = note;
    info.sample = &sample;
    info.gain = velocityToGain (velocity);
    info.pan = pan;
    info.attackSec = params.attackSec;
    info.decaySec = params.decaySec;
    info.sustainLevel = params.sustainLevel;

    info.region.start = params.startPos * lastFrame;
    info.region.end = std::max (info.region.start + 0.01 * sample.sampleRate, params.endPos * lastFrame);

    // Loop mode loops held keys; pattern-driven notes play the region once, gated.
    info.region.looping = ! oneShot && fromKey;
    info.region.loopStart = params.loopStartPos * lastFrame;
    info.region.loopEnd = params.loopEndPos * lastFrame;
    info.region.crossfade = std::max (0.005f, params.loopCrossfadeSec) * sample.sampleRate;

    switch (source)
    {
        case TriggerSource::Key:
            info.gateSamples = -1;
            break;

        case TriggerSource::Sequencer:
        case TriggerSource::Audition:
            // One-shot steps ring out; loop-mode steps are cut at the end of the step.
            info.gateSamples = oneShot ? -1 : std::max (1, gateSamples);
            info.gateEndsWithQuickFade = true;
            break;

        case TriggerSource::Arpeggiator:
            info.gateSamples = std::max (1, gateSamples);
            info.gateEndsWithQuickFade = false;
            break;
    }

    allocateVoice().start (info, grainWindow, sampleRate, ++voiceCounter);
}

void SamplerEngine::spawnReleaseTail (int note, float velocityGain) noexcept
{
    const SampleData* source = releaseSample != nullptr ? releaseSample.get() : mainSample.get();
    if (source == nullptr || source->numFrames() < 2 || mainSample == nullptr)
        return;

    VoiceStartInfo info;
    if (! computeRates (note, *source, info.pitchRate, info.contentRate))
        return;

    const double lastFrame = static_cast<double> (source->numFrames() - 1);

    info.kind = VoiceStartInfo::Kind::ReleaseTail;
    info.note = note;
    info.sample = source;
    info.gain = velocityGain * params.releaseTriggerGain;
    info.region.start = params.releaseTriggerPos * lastFrame;

    // A custom release sample plays to its end; a slice of the main sample stops at the End marker.
    info.region.end = releaseSample != nullptr
                          ? lastFrame
                          : std::max (info.region.start + 0.01 * source->sampleRate,
                                      params.endPos * static_cast<double> (mainSample->numFrames() - 1));

    allocateVoice().start (info, grainWindow, sampleRate, ++voiceCounter);
}

void SamplerEngine::releaseVoice (Voice& voice, bool withReleaseTrigger) noexcept
{
    if (! voice.isActive() || voice.isReleaseTail() || voice.isReleasing())
        return;

    voice.release (params.releaseSec);

    if (withReleaseTrigger && params.releaseTriggerEnabled)
        spawnReleaseTail (voice.getNote(), voice.getVelocityGain());
}

void SamplerEngine::releaseNote (int note, bool withReleaseTrigger) noexcept
{
    for (auto& voice : voices)
        if (voice.getNote() == note)
            releaseVoice (voice, withReleaseTrigger);
}

void SamplerEngine::releaseAllNotes (bool withReleaseTrigger) noexcept
{
    for (auto& voice : voices)
        releaseVoice (voice, withReleaseTrigger);
}

Voice& SamplerEngine::allocateVoice() noexcept
{
    Voice* oldestReleasing = nullptr;
    Voice* oldest = nullptr;

    for (auto& voice : voices)
    {
        if (! voice.isActive())
            return voice;

        if (voice.isReleasing() && (oldestReleasing == nullptr || voice.getOrder() < oldestReleasing->getOrder()))
            oldestReleasing = &voice;

        if (oldest == nullptr || voice.getOrder() < oldest->getOrder())
            oldest = &voice;
    }

    return oldestReleasing != nullptr ? *oldestReleasing : *oldest;
}

//==============================================================================
void SamplerEngine::updateFilters (int numSamples) noexcept
{
    // Glide cutoffs exponentially (in log-frequency) so automation and knob moves don't zipper.
    const float amount = 1.0f - std::exp (-static_cast<float> (numSamples) / (filterSmoothingSec * static_cast<float> (sampleRate)));

    const auto glide = [amount] (float current, float target)
    {
        current = std::max (current, 1.0f);
        return current * std::pow (std::max (target, 1.0f) / current, amount);
    };

    smoothedHighPassCutoff = glide (smoothedHighPassCutoff, params.highPass.cutoffHz);
    smoothedLowPassCutoff = glide (smoothedLowPassCutoff, params.lowPass.cutoffHz);

    FilterParams highPass = params.highPass;
    FilterParams lowPass = params.lowPass;
    highPass.cutoffHz = smoothedHighPassCutoff;
    lowPass.cutoffHz = smoothedLowPassCutoff;

    renderContext.sampleRate = sampleRate;
    renderContext.highPass = designFilter (FilterType::HighPass, highPass, sampleRate);
    renderContext.lowPass = designFilter (FilterType::LowPass, lowPass, sampleRate);
    renderContext.releaseSec = params.releaseSec;
}

void SamplerEngine::renderVoices (float* left, float* right, int numSamples) noexcept
{
    for (auto& voice : voices)
        voice.render (left, right, numSamples, renderContext);
}

void SamplerEngine::writeTelemetry() noexcept
{
    for (size_t i = 0; i < voices.size(); ++i)
    {
        const auto& voice = voices[i];
        auto& info = telemetry.voices[i];
        info.active = voice.isActive();
        info.isReleaseTail = voice.isReleaseTail();
        info.usesReleaseSample = voice.isReleaseTail() && releaseSample != nullptr && voice.getSample() == releaseSample.get();
        info.position = info.active ? voice.getPlayheadFraction() : 0.0f;
        info.progress = info.active ? voice.getRegionProgress() : 0.0f;
    }

    telemetry.sequencerStep = sequencerStep;
    telemetry.sequencerHalf = sequencerHalf;
    telemetry.sequencerRunning = sequencerClock.isRunning();
    telemetry.arpRunning = arpClock.isRunning();
    telemetry.heldNoteCount = heldNotes.size;
    telemetry.hostBpm = transport.bpm;
}

//==============================================================================
bool SamplerEngine::sequencerShouldRun() const noexcept
{
    return params.sequencerEnabled && (heldNotes.size > 0 || manualRunRequested);
}

bool SamplerEngine::arpShouldRun() const noexcept
{
    return params.arpEnabled && ! params.sequencerEnabled
        && params.playbackMode == PlaybackMode::OneShot && heldNotes.size > 0;
}

bool SamplerEngine::patternHasAnyStep() const noexcept
{
    const int steps = std::clamp (params.sequencerSteps, 1, kMaxSequencerSteps);
    for (int i = 0; i < steps; ++i)
    {
        const auto& step = pattern[static_cast<size_t> (i)];
        if (step.first.on || (step.split && step.second.on))
            return true;
    }
    return false;
}

double SamplerEngine::sequencerBpm() const noexcept
{
    return params.sequencerHostSync ? transport.bpm : std::max (1.0f, params.sequencerBpm);
}

double SamplerEngine::halfStepSamples() const noexcept
{
    const double stepBeats = 0.25 / std::max (0.125f, params.sequencerRate);
    return 60.0 / sequencerBpm() * stepBeats * 0.5 * sampleRate;
}

} // namespace obsidian
