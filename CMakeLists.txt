cmake_minimum_required(VERSION 3.22)

# Universal binary by default on macOS (must be set before project()).
if(APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "macOS architectures")
endif()
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")

# Windows: link the C++ runtime statically, so the plugin doesn't need the
# Visual C++ Redistributable (MSVCP140.dll) installed on the user's PC.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

project(ObsidianPlayer VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(OBSIDIAN_BUILD_PLUGIN "Build the JUCE plugin (needs JUCE and Node.js)" ON)
option(OBSIDIAN_BUILD_TESTS "Build the engine unit tests" ON)
set(OBSIDIAN_UI_DEV_SERVER_URL "" CACHE STRING "Load the UI from a Vite dev server, e.g. http://localhost:5173/ (development only)")
set(OBSIDIAN_JUCE_DIR "" CACHE PATH "Use a local JUCE checkout instead of downloading one")

# The DSP engine has no JUCE dependency.
add_subdirectory(engine)

if(OBSIDIAN_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

if(OBSIDIAN_BUILD_PLUGIN)
    if(OBSIDIAN_JUCE_DIR)
        add_subdirectory(${OBSIDIAN_JUCE_DIR} juce EXCLUDE_FROM_ALL)
    else()
        include(FetchContent)
        FetchContent_Declare(JUCE
            GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
            GIT_TAG 8.0.9
            GIT_SHALLOW TRUE)
        FetchContent_MakeAvailable(JUCE)
    endif()

    add_subdirectory(plugin)

    if(OBSIDIAN_BUILD_TESTS)
        add_subdirectory(tests/plugin-host)
    endif()
endif()
