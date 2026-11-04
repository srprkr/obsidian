#==============================================================================
# Web UI: built by Vite into one self-contained index.html, then embedded as binary data.

set(UI_DIR "${PROJECT_SOURCE_DIR}/ui")
set(UI_HTML "${UI_DIR}/dist/index.html")
set(UI_INSTALL_STAMP "${UI_DIR}/node_modules/.package-lock.json")

find_program(NPM_EXECUTABLE NAMES npm.cmd npm REQUIRED)

file(GLOB_RECURSE UI_SOURCES CONFIGURE_DEPENDS "${UI_DIR}/src/*")
list(APPEND UI_SOURCES
    "${UI_DIR}/index.html"
    "${UI_DIR}/vite.config.ts"
    "${UI_DIR}/tailwind.config.js"
    "${UI_DIR}/postcss.config.js"
    "${UI_DIR}/tsconfig.json")

add_custom_command(
    OUTPUT "${UI_INSTALL_STAMP}"
    COMMAND "${NPM_EXECUTABLE}" ci --no-audit --no-fund
    WORKING_DIRECTORY "${UI_DIR}"
    DEPENDS "${UI_DIR}/package.json" "${UI_DIR}/package-lock.json"
    COMMENT "Installing UI dependencies (npm ci)"
    VERBATIM)

add_custom_command(
    OUTPUT "${UI_HTML}"
    COMMAND "${NPM_EXECUTABLE}" run build
    WORKING_DIRECTORY "${UI_DIR}"
    DEPENDS "${UI_INSTALL_STAMP}" ${UI_SOURCES}
    COMMENT "Building the web UI (npm run build)"
    VERBATIM)

juce_add_binary_data(ObsidianUiAssets SOURCES "${UI_HTML}")

#==============================================================================
juce_add_plugin(ObsidianPlayer
    PRODUCT_NAME "Obsidian Player"
    COMPANY_NAME "Obsidian Player"
    BUNDLE_ID "com.obsidianplayer.sampler"
    PLUGIN_MANUFACTURER_CODE Obsp
    PLUGIN_CODE ObPl
    FORMATS VST3 Standalone
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    NEEDS_WEB_BROWSER TRUE   # Linux: WebKitGTK headers
    NEEDS_WEBVIEW2 TRUE      # Windows: statically linked WebView2 loader
    VST3_CATEGORIES Instrument Sampler
    COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(ObsidianPlayer PRIVATE
    source/Parameters.cpp
    source/PatternSerialization.cpp
    source/PluginEditor.cpp
    source/PluginProcessor.cpp
    source/PresetManager.cpp
    source/SampleLibrary.cpp
    source/WebUiBridge.cpp)

target_compile_definitions(ObsidianPlayer PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_USE_MP3AUDIOFORMAT=1
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

if(WIN32)
    target_compile_definitions(ObsidianPlayer PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

if(OBSIDIAN_UI_DEV_SERVER_URL)
    target_compile_definitions(ObsidianPlayer PRIVATE OBSIDIAN_UI_DEV_SERVER_URL="${OBSIDIAN_UI_DEV_SERVER_URL}")
endif()

target_link_libraries(ObsidianPlayer
    PRIVATE
        ObsidianUiAssets
        obsidian_engine
        juce::juce_audio_utils
        juce::juce_audio_formats
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)
