# Framework-independent DSP core. Builds and tests on any platform without JUCE.
add_library(obsidian_engine STATIC
    src/Arpeggiator.cpp
    src/Biquad.cpp
    src/RegionReader.cpp
    src/SamplerEngine.cpp
    src/StepClock.cpp
    src/StretchPlayer.cpp
    src/Voice.cpp)

target_include_directories(obsidian_engine PUBLIC include)
target_compile_features(obsidian_engine PUBLIC cxx_std_17)
set_target_properties(obsidian_engine PROPERTIES POSITION_INDEPENDENT_CODE ON)

if(MSVC)
    target_compile_options(obsidian_engine PRIVATE /W4)
else()
    target_compile_options(obsidian_engine PRIVATE -Wall -Wextra -Wshadow -Wconversion -Wno-sign-conversion)
endif()
