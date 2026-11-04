#pragma once

#include <array>

namespace obsidian
{

enum class PlaybackMode { OneShot, Loop };
enum class FilterSlope  { Db12, Db18, Db24 };
enum class ArpPattern   { Up, Down, UpDown, Random, Chord };

struct FilterParams
{
    bool enabled = false;
    float cutoffHz = 1000.0f;
    float resonance = 1.0f; // "emphasis", 0.1 .. 10
    FilterSlope slope = FilterSlope::Db12;
};

/** A plain snapshot of every automatable setting, copied into the engine once per block. */
struct EngineParams
{
    float masterGain = 1.0f;

    // Sample region. Positions are fractions (0..1) of the loaded sample's length.
    PlaybackMode playbackMode = PlaybackMode::OneShot;
    float startPos = 0.0f;
    float endPos = 1.0f;
    float loopStartPos = 0.0f;
    float loopEndPos = 1.0f;
    float loopCrossfadeSec = 0.02f;

    // Release trigger: a tail played when a key is released.
    bool releaseTriggerEnabled = false;
    float releaseTriggerPos = 0.8f; // fraction of the release source (custom release sample, or the main sample)
    float releaseTriggerGain = 1.0f;

    // Amplitude envelope.
    float attackSec = 0.001f;
    float decaySec = 0.8f;
    float sustainLevel = 0.8f;
    float releaseSec = 0.5f;

    // Pitch & tempo.
    int rootNote = 60;
    bool preserveSpeed = true; // pitch changes per key, playback speed does not
    bool tempoSync = true;     // stretch playback by hostBpm / sampleBpm
    float sampleBpm = 120.0f;

    FilterParams highPass { false, 20.0f, 1.0f, FilterSlope::Db12 };
    FilterParams lowPass  { false, 20000.0f, 1.0f, FilterSlope::Db24 };

    // Step sequencer.
    bool sequencerEnabled = false;
    int sequencerSteps = 8;
    float sequencerRate = 1.0f; // 1 = sixteenth notes
    bool sequencerHostSync = true;
    float sequencerBpm = 120.0f; // used when not synced to the host

    // Arpeggiator (one-shot mode only).
    bool arpEnabled = false;
    float arpDivisionBeats = 0.25f;
    ArpPattern arpPattern = ArpPattern::Up;
    int arpOctaves = 2;
    float arpRate = 1.0f;
    float arpGate = 0.8f; // fraction of a step the note is held for
};

//==============================================================================
constexpr int kMaxSequencerSteps = 16;

struct StepHalf
{
    bool on = false;
    int velocity = 100;  // 0..127 (0 is treated as 100, matching the original app)
    int pitchOffset = 0; // semitones, -24..24
    float pan = 0.0f;    // -1..1
};

struct SequencerStep
{
    StepHalf first;
    StepHalf second; // only used when split
    bool split = false;
};

using StepPattern = std::array<SequencerStep, kMaxSequencerSteps>;

//==============================================================================
struct TransportInfo
{
    double bpm = 120.0;
    bool isPlaying = false;
    bool hasPpqPosition = false;
    double ppqPosition = 0.0; // quarter notes since the start of the song
};

} // namespace obsidian
