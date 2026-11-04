# Obsidian Player

A sample-playback instrument plugin (VST3, plus a Standalone app) for Windows and macOS, ported from the Google Flow web app in [`flow_source_materials/`](flow_source_materials/).

The interface is the original React UI, cleaned up and running inside the plugin window. The sound comes from a new C++ engine, because a plugin can't use the browser's Web Audio.

## Features

- **Sample playback.** One-shot or seamless loop modes, with Start/End/Loop markers that you can drag on the waveform. Loops use a pre-roll crossfade.
- **Preserve Speed and tempo sync.** Each key changes pitch without changing playback speed. The sample stretches to the host tempo, relative to its own BPM.
- **Release trigger.** Plays a tail when you let go of a key. The tail can be a slice of the main sample or a separate file.
- **ADSR envelope.** Includes a draggable envelope graph.
- **Filters.** Moog-style high-pass and low-pass filters at 12, 18 or 24 dB/oct. The response graph is calculated from the same formulas as the audio filters.
- **Step sequencer.** 8 or 16 steps, each with on/off, velocity, pitch offset and pan. Any step can be split into two halves. The sequencer runs while you hold keys or after you press Play.
- **Arpeggiator.** Up, Down, Up/Down, Random and Chord patterns; division, octaves, rate and gate controls. One-shot mode only.
- **Presets.** Search, favourites, save and delete. The presets are JSON files.
- **Host integration.** Every control is an automatable host parameter. The step sequencer and arpeggiator follow the song position while the host is playing.
- **Computer keyboard.** Keys `A`–`K` play C4–C5, `Z`–`B` play C3–G3, and Space plays the root note.

## Project layout

```
engine/    C++ DSP engine, no framework dependency (sampler voices, time-stretch, filters, sequencer, arp)
tests/     Engine unit tests (plain C++, run with ctest)
plugin/    JUCE plugin: parameters, state, presets, sample loading, and the web-view bridge to the UI
ui/        React + TypeScript + Tailwind UI (Vite), built into one self-contained index.html
flow_source_materials/   The original web-app code, kept for reference
```

### How the parts fit together

```
 Host (DAW) ── MIDI / automation ──▶ ObsidianPlayerProcessor ──▶ obsidian::SamplerEngine ──▶ audio
                                           ▲          │
                         native functions  │          │ events (parameters, playheads, meter)
                                           │          ▼
                           React UI in JUCE WebBrowserComponent (WebView2 / WKWebView)
```

- **UI to plugin.** The UI calls "native functions" such as `setParameter`, `setPattern`, `browseForSample` and `savePreset`. The C++ side is [plugin/source/WebUiBridge.cpp](plugin/source/WebUiBridge.cpp); the typed TypeScript side is [ui/src/bridge/api.ts](ui/src/bridge/api.ts).
- **Plugin to UI.** About 30 times a second the plugin sends parameter changes made by the host, plus playheads, meter levels and the sequencer position.
- **Audio thread safety.** The audio thread never waits on a lock or allocates memory. Samples and patterns are handed over through a mutex that the audio thread only try-locks. Old samples are freed on the main thread.
- **Where things are saved.** Parameter values, sample file paths, the step pattern and the UI view settings are all stored in the DAW project.

## Building

Requirements:
- CMake 3.22 or newer
- A C++20 compiler: Visual Studio 2022 on Windows, Xcode 15 or newer on macOS
- Node.js 20 or newer (the version is pinned in `ui/.tool-versions`)
- Internet access on the first build (CMake downloads JUCE 8.0.9; npm installs the UI packages)

### macOS

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release        # universal binary (arm64 + x86_64) by default
cmake --build build --config Release --parallel
cp -R "build/plugin/ObsidianPlayer_artefacts/Release/VST3/Obsidian Player.vst3" ~/Library/Audio/Plug-Ins/VST3/
```

### Windows

JUCE needs the WebView2 SDK from NuGet. Install it once from PowerShell:

```powershell
Register-PackageSource -provider NuGet -name nugetRepository -location https://www.nuget.org/api/v2
Install-Package Microsoft.Web.WebView2 -Scope CurrentUser -RequiredVersion 1.0.1901.177 -Source nugetRepository
```

Then build:

```powershell
cmake -S . -B build
cmake --build build --config Release --parallel
# Copy the bundle into C:\Program Files\Common Files\VST3\
```

The WebView2 runtime ships with Windows 10 and 11, so users don't need to install anything.

### Continuous integration

[.github/workflows/build.yml](.github/workflows/build.yml) builds both platforms on every push, runs the engine tests, and uploads the VST3 and Standalone builds as downloadable artifacts. This is the easiest way to get Windows and macOS binaries if you develop on Linux.

### Engine tests only

The tests don't need JUCE or Node:

```bash
cmake -S . -B build -DOBSIDIAN_BUILD_PLUGIN=OFF && cmake --build build && ctest --test-dir build
```

## Working on the UI

```bash
cd ui
npm install
npm run dev        # http://localhost:5173 — runs against an in-browser mock (no sound)
```

In a normal browser, the mock backend keeps state in memory and decodes dropped files so the waveform shows. To see UI changes live inside the real plugin, configure with `-DOBSIDIAN_UI_DEV_SERVER_URL=http://localhost:5173/`. The plugin then loads the UI from the Vite dev server instead of the embedded copy.

A normal build runs `npm ci` and `npm run build` automatically, then embeds `ui/dist/index.html` in the plugin binary.

## Changes from the web app

**Fixes:**
- Master gain used to be applied twice (once per voice and once on the output), so it now applies once. At the default 100% there is no difference.
- The Filters graph now uses the same formulas as the audio filters; the old graph used different maths. The "18 dB" slope is now a true 3-pole filter, as its comment intended.
- Loops keep their exact length. The crossfade now blends the audio just before Loop Start (the "Pre X-Fade" the UI shows), so loops stay in time.
- The arpeggiator's Rate buttons were never connected; they now work. A **Gate** knob was added because arp notes previously had no length.
- Clicking a preset's delete button now asks for a second click. `window.confirm` doesn't work inside the macOS web view.

**Behaviour changes for the plugin context:**
- The time-stretch now runs in real time, using overlapping grains aligned to the waveform (WSOLA). The web app rendered a whole stretched copy of the sample on every key press, which a plugin can't do inside its audio callback.
- Tempo comes from the DAW. The BPM box next to **Sync DAW** is now the sample's own tempo; the web app used it as a stand-in for the host tempo.
- The sequencer and arpeggiator turn on with their tab LEDs, not by opening their tabs. Otherwise closing the plugin window would change the sound. If both are on, the sequencer takes priority. Pressing **Play** turns the sequencer on.
- While the host transport is playing, sequencer and arp steps line up with the song's beat grid. With the transport stopped, the pattern starts the moment a key is pressed, as before.
- Arpeggiator notes now end after their gate time. In one-shot mode, sequencer steps still play to the end of the sample.
- Samples are loaded with the plugin's own file dialog, or by dragging a file onto the waveform or the release-sample slot. Dropped files are copied to the user application-data folder (`Obsidian Player/Imported Samples`) so the project can reload them later.

**Removed** because they did nothing in the original:
- The delay effect, which was never connected to the audio.
- The per-filter "drive" setting, which was never used.
- The Key and Mode dropdowns on the Arpeggiator tab.
- The unused A/B comparison state and the hidden alternative tab bars.

## Distribution notes

- **Licence.** JUCE 8 is dual-licensed: AGPLv3, or a commercial licence (including a free tier for small companies). If you distribute closed-source binaries you need a JUCE licence.
- **macOS.** Sign the bundle with a Developer ID and notarise it, otherwise Gatekeeper will block it. If you need Logic Pro support, add `AU` to `FORMATS` in [plugin/CMakeLists.txt](plugin/CMakeLists.txt).
- **Plugin codes.** The manufacturer code is `Obsp` and the plugin code is `ObPl`. Change them before release if you have your own; DAWs use them to identify the plugin.
