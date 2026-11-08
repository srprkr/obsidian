# Loads the built VST3 in a minimal host, sends MIDI and checks that audio comes out.
juce_add_console_app(obsidian_plugin_host_test PRODUCT_NAME "obsidian_plugin_host_test")
target_sources(obsidian_plugin_host_test PRIVATE PluginHostTest.cpp)
target_compile_definitions(obsidian_plugin_host_test PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0)
target_link_libraries(obsidian_plugin_host_test PRIVATE
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_recommended_config_flags)

# Build the plugin first so the test always checks the current build.
add_dependencies(obsidian_plugin_host_test ObsidianPlayer_VST3)

# The VST3 bundle sits in a VST3 folder beside the plugin's shared-code library
# (ObsidianPlayer_artefacts/<config>/VST3/Obsidian Player.vst3).
add_test(NAME obsidian_plugin_midi
         COMMAND obsidian_plugin_host_test "$<TARGET_FILE_DIR:ObsidianPlayer>/VST3/Obsidian Player.vst3")
