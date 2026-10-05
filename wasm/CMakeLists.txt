cmake_minimum_required(VERSION 3.21)
project(soraoto_wasm_plugins LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

include(CTest)
find_package(Python3 COMPONENTS Interpreter REQUIRED)
find_program(SORAOTO_NODE_EXECUTABLE NAMES node)
option(SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS
  "Build the isolated test-only Stage3D SuperSynth source"
  OFF)
include(cmake/wasm_plugin.cmake)

set(SORAOTO_GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")
set(SORAOTO_PLUGIN_PATHS
  plugins/effects/gain
  plugins/effects/stereo-delay
  plugins/effects/channel-strip
  plugins/effects/sidechain
  plugins/effects/reverb
  plugins/effects/master-limiter
  plugins/dsp/drum-machine
  plugins/dsp/super-synth)
set(SORAOTO_METADATA_OUTPUTS)
set(SORAOTO_METADATA_INPUTS
  "${CMAKE_CURRENT_SOURCE_DIR}/cmake/generate_plugin_metadata.py"
  "${CMAKE_CURRENT_SOURCE_DIR}/cmake/super_synth_metadata.py")
foreach(plugin_path IN LISTS SORAOTO_PLUGIN_PATHS)
  get_filename_component(plugin "${plugin_path}" NAME)
  list(APPEND SORAOTO_METADATA_OUTPUTS
    "${SORAOTO_GENERATED_DIR}/${plugin}_descriptor.h"
    "${SORAOTO_GENERATED_DIR}/${plugin}_descriptor.cbor")
  list(APPEND SORAOTO_METADATA_INPUTS
    "${CMAKE_CURRENT_SOURCE_DIR}/${plugin_path}/descriptor.json")
endforeach()
list(APPEND SORAOTO_METADATA_OUTPUTS
  "${CMAKE_CURRENT_SOURCE_DIR}/shared/generated/super-synth_grand_profiles.h")
list(APPEND SORAOTO_METADATA_INPUTS
  "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dsp/super-synth/presets.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dsp/super-synth/interface.soraoto")

add_custom_command(OUTPUT ${SORAOTO_METADATA_OUTPUTS}
  COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/cmake/generate_plugin_metadata.py"
    "${CMAKE_BINARY_DIR}"
  DEPENDS ${SORAOTO_METADATA_INPUTS}
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "Generating plugin descriptors from JSON sources"
  VERBATIM)
add_custom_target(wasm_plugin_metadata DEPENDS ${SORAOTO_METADATA_OUTPUTS})

add_subdirectory(plugins/effects/gain)
add_subdirectory(plugins/effects/stereo-delay)
add_subdirectory(plugins/effects/channel-strip)
add_subdirectory(plugins/effects/sidechain)
add_subdirectory(plugins/effects/reverb)
add_subdirectory(plugins/effects/master-limiter)
add_subdirectory(plugins/dsp/drum-machine)
add_subdirectory(plugins/dsp/super-synth)

if(SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS)
  if(NOT SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS OR NOT SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS)
    message(FATAL_ERROR "Stage3D diagnostics require SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON and SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=ON")
  endif()
  if(SORAOTO_SUPERSYNTH_STAGE3B_DIAGNOSTICS OR SORAOTO_SUPERSYNTH_STAGE3C_DIAGNOSTICS)
    message(FATAL_ERROR "Stage3B, Stage3C, and Stage3D diagnostics are mutually exclusive")
  endif()
  set(stage3d_target soraoto_dsp_super_synth)
  set_property(TARGET ${stage3d_target} PROPERTY SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dsp/super-synth/src/plugin_stage3d.c")
  target_compile_definitions(${stage3d_target} PRIVATE SORAOTO_SUPERSYNTH_STAGE3D_DIAGNOSTICS=1)
  target_link_options(${stage3d_target} PRIVATE
    "-Wl,--export=soraoto_supersynth_stage3d_set_variant"
    "-Wl,--export=soraoto_supersynth_stage3d_get_variant")
endif()

if(BUILD_TESTING AND SORAOTO_NODE_EXECUTABLE)
  file(GLOB SORAOTO_SHARED_WASM_TESTS CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/test/*.test.js")
  foreach(test_file IN LISTS SORAOTO_SHARED_WASM_TESTS)
    get_filename_component(test_name "${test_file}" NAME_WE)
    add_test(NAME "wasm.${test_name}"
      COMMAND "${SORAOTO_NODE_EXECUTABLE}" "${test_file}")
    set_tests_properties("wasm.${test_name}" PROPERTIES
      ENVIRONMENT "SORAOTO_WASM_BUILD_DIR=${CMAKE_BINARY_DIR}")
  endforeach()
  add_test(NAME wasm.dsp.super-synth.supersynth-v9-production-lifecycle
    COMMAND "${SORAOTO_NODE_EXECUTABLE}"
      "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dsp/super-synth/test/tools/verify-supersynth-v9-production-lifecycle.cjs"
      --production-dir "${CMAKE_BINARY_DIR}"
      --output "${CMAKE_BINARY_DIR}/test-results/supersynth-v9-production-lifecycle.json")
  add_test(NAME wasm.dsp.super-synth.salamander-board-fit-scale
    COMMAND "${SORAOTO_NODE_EXECUTABLE}"
      "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dsp/super-synth/test/fit-salamander-board.test.cjs")
  add_test(NAME wasm.dsp.super-synth.salamander-pitch-detector
    COMMAND "${SORAOTO_NODE_EXECUTABLE}"
      "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dsp/super-synth/test/tools/salamander-metrics.test.cjs")
endif()

if(BUILD_TESTING)
  add_test(NAME wasm.super-synth-grand-profile-schema
    COMMAND "${Python3_EXECUTABLE}"
      "${CMAKE_CURRENT_SOURCE_DIR}/cmake/test_super_synth_metadata.py")
endif()
