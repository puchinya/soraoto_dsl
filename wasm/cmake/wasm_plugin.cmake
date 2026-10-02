set(SORAOTO_PLUGIN_EXPORTS
  soraoto_plugin_abi_version
  soraoto_plugin_init
  soraoto_plugin_terminate
  soraoto_alloc
  soraoto_free
  soraoto_plugin_control
  soraoto_plugin_activate
  soraoto_plugin_deactivate
  soraoto_plugin_start_processing
  soraoto_plugin_stop_processing
  soraoto_plugin_process
  soraoto_plugin_reset
  soraoto_plugin_latency_samples
  soraoto_plugin_tail_samples)

function(soraoto_add_wasm_plugin group plugin)
  string(MAKE_C_IDENTIFIER "soraoto_${group}_${plugin}" target)
  set(plugin_dir "${CMAKE_CURRENT_SOURCE_DIR}")
  set(plugin_output_dir "${CMAKE_BINARY_DIR}/plugins/${group}/${plugin}")
  set(generated_dir "${CMAKE_BINARY_DIR}/generated")
  set(descriptor "${generated_dir}/${plugin}_descriptor.cbor")
  set(initial_memory 8388608)

  if(plugin STREQUAL "super-synth")
    set(initial_memory 16777216)
  endif()

  add_executable(${target} src/plugin.c)
  add_dependencies(${target} wasm_plugin_metadata)
  target_include_directories(${target} PRIVATE
    "${CMAKE_BINARY_DIR}"
    "${PROJECT_SOURCE_DIR}/shared")
  target_compile_options(${target} PRIVATE -O3 -nostdlib -fno-builtin)
  target_compile_definitions(${target} PRIVATE
    "PLUGIN_DESCRIPTOR_HEADER=\"${generated_dir}/${plugin}_descriptor.h\"")

  if(plugin STREQUAL "super-synth")
    option(SORAOTO_SUPERSYNTH_SIMD_DIAGNOSTICS
      "Emit local SuperSynth Wasm loop/SLP vectorization remarks" OFF)
    option(SORAOTO_FORCE_SCALAR_GRAND
      "Build a local scalar reference for the SuperSynth concert-grand kernels" OFF)
    if(BUILD_TESTING)
      set(SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS_DEFAULT ON)
    else()
      set(SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS_DEFAULT OFF)
    endif()
    option(SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS
      "Expose SuperSynth guard, voice-count and kernel-benchmark hooks in local diagnostics"
      ${SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS_DEFAULT})
    option(SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS
      "Build test-only Stage2M factor attribution controls for SuperSynth"
      OFF)
    target_compile_options(${target} PRIVATE -msimd128 -fvectorize -fslp-vectorize)
    if(SORAOTO_SUPERSYNTH_SIMD_DIAGNOSTICS)
      target_compile_options(${target} PRIVATE
        -Rpass=loop-vectorize
        -Rpass-missed=loop-vectorize
        -Rpass=slp-vectorizer
        -Rpass-missed=slp-vectorizer)
    endif()
    if(SORAOTO_FORCE_SCALAR_GRAND)
      target_compile_definitions(${target} PRIVATE SORAOTO_FORCE_SCALAR_GRAND=1)
      target_compile_options(${target} PRIVATE -fno-vectorize -fno-slp-vectorize)
    endif()
    if(SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS)
      target_compile_definitions(${target} PRIVATE SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=1)
    endif()
    if(SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS)
      if(NOT SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS)
        message(FATAL_ERROR "Stage2M diagnostics require SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS=ON")
      endif()
      target_compile_definitions(${target} PRIVATE SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS=1)
    endif()
  elseif(plugin STREQUAL "reverb")
    target_compile_options(${target} PRIVATE -O2)
  endif()

  set(link_options
    -nostdlib
    -Wl,--no-entry
    -Wl,--export-memory
    "-Wl,--initial-memory=${initial_memory}"
    -Wl,--max-memory=33554432
    -Wl,--stack-first
    -Wl,-z,stack-size=131072)
  foreach(symbol IN LISTS SORAOTO_PLUGIN_EXPORTS)
    list(APPEND link_options "-Wl,--export=${symbol}")
  endforeach()
  if(plugin STREQUAL "super-synth" AND SORAOTO_SUPERSYNTH_GUARD_DIAGNOSTICS)
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_guard_hit_count")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_active_voice_count")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_benchmark_soundboard")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_benchmark_sympathetic")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_soundboard_diag_reset")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_soundboard_diag_sum_squares")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_soundboard_diag_peak")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_soundboard_diag_frames")
    list(APPEND link_options "-Wl,--export=soraoto_supersynth_diagnostic_set_ablation_mask")
    if(SORAOTO_SUPERSYNTH_STAGE2M_DIAGNOSTICS)
      list(APPEND link_options
        "-Wl,--export=soraoto_supersynth_stage2m_set_factor_mask"
        "-Wl,--export=soraoto_supersynth_stage2m_get_factor_mask"
        "-Wl,--export=soraoto_supersynth_stage2m_hammer_diag_reset"
        "-Wl,--export=soraoto_supersynth_stage2m_hammer_diag_value")
    endif()
  endif()
  target_link_options(${target} PRIVATE ${link_options})

  set_target_properties(${target} PROPERTIES
    OUTPUT_NAME plugin
    SUFFIX .wasm
    RUNTIME_OUTPUT_DIRECTORY "${plugin_output_dir}")
  foreach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set_target_properties(${target} PROPERTIES
      "RUNTIME_OUTPUT_DIRECTORY_${config}" "${plugin_output_dir}")
  endforeach()
  set_property(TARGET ${target} APPEND PROPERTY LINK_DEPENDS "${descriptor}")

  set(postprocess_args
    --input "$<TARGET_FILE:${target}>"
    --output "$<TARGET_FILE:${target}>"
    --descriptor "${descriptor}")
  if(plugin STREQUAL "super-synth")
    list(APPEND postprocess_args
      --interface "${plugin_dir}/interface.soraoto")
    set_property(TARGET ${target} APPEND PROPERTY LINK_DEPENDS
      "${plugin_dir}/interface.soraoto")
  endif()
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND "${Python3_EXECUTABLE}"
      "${PROJECT_SOURCE_DIR}/cmake/append_custom_sections.py"
      ${postprocess_args}
    VERBATIM)

  if(BUILD_TESTING AND SORAOTO_NODE_EXECUTABLE)
    file(GLOB plugin_tests CONFIGURE_DEPENDS
      "${plugin_dir}/test/*.test.js")
    foreach(test_file IN LISTS plugin_tests)
      get_filename_component(test_name "${test_file}" NAME_WE)
      add_test(NAME "wasm.${group}.${plugin}.${test_name}"
        COMMAND "${SORAOTO_NODE_EXECUTABLE}" "${test_file}")
      set_tests_properties("wasm.${group}.${plugin}.${test_name}" PROPERTIES
        ENVIRONMENT "SORAOTO_WASM_BUILD_DIR=${CMAKE_BINARY_DIR}")
    endforeach()
  endif()
endfunction()
