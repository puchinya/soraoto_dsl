#ifndef SORAOTO_GENERATED_SUPER_SYNTH_GRAND_PROFILES_H
#define SORAOTO_GENERATED_SUPER_SYNTH_GRAND_PROFILES_H
#include <stdint.h>
#define SORAOTO_GRAND_PROFILE_COUNT 1
#define SORAOTO_GRAND_FACTORY_PRESET_COUNT 51
#define SORAOTO_GRAND_DEFAULT_PRESET_ID 2530738680u
typedef struct { uint32_t preset_id; uint16_t profile_index; } SoraotoGrandPresetProfileMap;
static const uint32_t soraoto_grand_profile_preset_ids[SORAOTO_GRAND_PROFILE_COUNT] = { 2530738680u };
static const GrandEngineConfig soraoto_grand_profiles[SORAOTO_GRAND_PROFILE_COUNT] = {
  {
    .hammer = { .force_scale = 300.0f, .initial_velocity_base = 0.41999999999999998f, .initial_velocity_velocity_scale = 1.05f, .initial_velocity_hardness_base = 0.78000000000000003f, .initial_velocity_hardness_scale = 0.41999999999999998f, .velocity_hardness_amount = 0.0f, .compression_scale = 0.001f, .compression_max_normalized = 1.75f, .stiffness_soft = 0.017999999999999999f, .stiffness_hard = 0.155f, .felt_exponent_soft = 2.0f, .felt_exponent_hard = 4.0f, .contact_loss_soft = 0.080000000000000002f, .contact_loss_hard = 0.28000000000000003f, .contact_loss_min = 0.0f, .contact_loss_max = 1.8f, .mass_soft = 0.01f, .mass_hard = 0.0064999999999999997f, .noise_filter_base = 0.040000000000000001f, .noise_filter_hardness_scale = 0.12f, .noise_gain_base = 0.012f, .noise_gain_hardness_scale = 0.028000000000000001f, .radiation_transient_gain = 0.002f },
    .string = { .strike_position_bass = 0.17199999999999999f, .strike_position_treble = 0.122f, .unison_activation_start_midi = 29.0f, .unison_activation_width_midi = 43.0f, .one_to_two_string_midi = 36.0f, .two_to_three_string_midi = 48.0f, .unison_detune_base_cents = 0.044999999999999998f, .unison_detune_amount = 1.02f, .unison_detune_key_base = 0.68000000000000005f, .unison_detune_key_scale = 0.46000000000000002f, .unison_offsets = { 0.0f, 1.0f, -0.83999999999999997f }, .strike_offsets = { 0.0f, 1.0f, -0.81999999999999995f }, .strike_offset_base = 0.0022000000000000001f, .strike_offset_unison_scale = 0.0064999999999999997f, .strike_position_min = 0.070000000000000007f, .strike_position_max = 0.17499999999999999f, .characteristic_impedance = { 1.0f, 0.96499999999999997f, 1.0349999999999999f }, .geometric_phase_delay_samples = 1.0f, .wound_reference_midi = 48.0f, .wound_transition_width_midi = 19.0f, .reference_pitches = { 21.0f, 24.0f, 27.0f, 30.0f, 33.0f, 36.0f, 39.0f, 42.0f, 45.0f, 48.0f, 51.0f, 54.0f, 57.0f, 60.0f, 63.0f, 66.0f, 69.0f, 72.0f, 75.0f, 78.0f, 81.0f, 84.0f, 87.0f, 90.0f, 93.0f, 96.0f, 99.0f, 102.0f, 105.0f, 108.0f }, .inharmonicity_b = { 0.02f, 0.010676f, 0.0f, 0.0076020000000000003f, 0.0f, 0.0010679999999999999f, 0.0021329999999999999f, 0.00019699999999999999f, 0.001588f, 0.0021570000000000001f, 0.0f, 0.0043369999999999997f, 4.1999999999999998e-05f, 0.0012310000000000001f, 0.000417f, 0.000718f, 0.000102f, 0.00085700000000000001f, 0.00085599999999999999f, 0.00089800000000000004f, 0.001449f, 0.002918f, 0.002117f, 0.0031489999999999999f, 0.0061549999999999999f, 0.0052950000000000002f, 0.0030639999999999999f, 0.0059649999999999998f, 0.0f, 0.017715999999999999f }, .reference_loss_base = 0.0019965984251968504f, .reference_loss_register_start = 0.68000000000000005f, .reference_loss_register_width = 0.45000000000000001f, .decay_reference_midi = 60.0f, .release_loss_base = 6.0000000000000002e-05f, .release_loss_damping_scale = 0.00025000000000000001f, .release_loss_key_scale = 8.0000000000000007e-05f, .dispersion_base = 0.017999999999999999f, .dispersion_inharmonicity_base = 0.044999999999999998f, .dispersion_inharmonicity_key_scale = 0.16f, .agraffe = { .lowpass_base = 0.79000000000000004f, .lowpass_damping_coefficient = 0.10000000000000001f, .lowpass_key_coefficient = 0.035000000000000003f, .high_frequency_loss_base = 0.002f, .high_frequency_loss_damping_coefficient = 0.012f, .high_frequency_loss_key_coefficient = 0.0030000000000000001f, .high_frequency_loss_wound_coefficient = 0.025999999999999999f, .reflection_loss_base = 0.99980000000000002f, .key_loss_base = 0.0001f, .key_loss_coefficient = 0.0011000000000000001f, .damping_base = 0.38f, .damping_coefficient = 1.05f, .reference_loss_multiplier = 1.0f, .passive_min = 0.96999999999999997f, .passive_max = 0.99980000000000002f, .dispersion_multiplier = 0.71999999999999997f }, .bridge_termination = { .lowpass_base = 0.76000000000000001f, .lowpass_damping_coefficient = 0.13f, .lowpass_key_coefficient = 0.055f, .high_frequency_loss_base = 0.0040000000000000001f, .high_frequency_loss_damping_coefficient = 0.02f, .high_frequency_loss_key_coefficient = 0.0060000000000000001f, .high_frequency_loss_wound_coefficient = 0.043999999999999997f, .reflection_loss_base = 0.99955000000000005f, .key_loss_base = 0.00025000000000000001f, .key_loss_coefficient = 0.002f, .damping_base = 0.41999999999999998f, .damping_coefficient = 1.1499999999999999f, .reference_loss_multiplier = 1.0800000000000001f, .passive_min = 0.93000000000000005f, .passive_max = 0.99960000000000004f, .dispersion_multiplier = 1.0f, .release_loss_multiplier = 1.0f } },
    .bridge = { .impedance_bass = 0.0030000000000000001f, .impedance_treble = 0.0040499999999999998f, .radiation_diff_base_bass = 5.0f, .radiation_diff_base_treble = 3.0f, .radiation_diff_velocity2 = 2.0f, .radiation_diff_key_velocity3 = 3.0f },
    .zones = { .bass_to_tenor_start = 0.0f, .bass_to_tenor_end = 0.5f, .tenor_to_treble_start = 0.5f, .tenor_to_treble_end = 1.0f, .low_bass_gate_start = 0.14000000000000001f, .low_bass_gate_end = 0.32000000000000001f },
    .soundboard = {
      .size_scale_min = 0.88f,
      .size_scale_max = 1.1200000000000001f,
      .mode_frequency_hz = { 41.917000000000002f, 46.030999999999999f, 50.548000000000002f, 55.509f, 60.956000000000003f, 66.938000000000002f, 73.507999999999996f, 80.721000000000004f, 88.643000000000001f, 97.343000000000004f, 106.896f, 117.386f, 128.90700000000001f, 141.55699999999999f, 360.99700000000001f, 576.48699999999997f, 1010.958f, 1470.1500000000001f, 2137.915f, 3749.1570000000002f, 5987.1409999999996f, 9561.0470000000005f, 11529.748f, 13903.822f },
      .mode_q = { 4.8564999999999996f, 5.3331f, 5.8564999999999996f, 4.0839999999999996f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.1189f, 2.0f, 5.3331f, 2.0f, 2.0f, 5.3331f, 2.0f, 5.3331f, 5.3331f, 2.0f, 2.0f, 2.0f },
      .mode_gain = { 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.88f, 0.19404289999999999f, 0.63403229999999999f, 0.41334860000000001f, 0.51590860000000005f, 0.60048919999999995f, 0.0f, 0.0f, 0.0f },
      .mode_pan = { 0.13902700000000001f, 0.14000499999999999f, 0.14235600000000001f, 0.14516599999999999f, 0.135793f, 0.135793f, 0.13183900000000001f, 0.13328300000000001f, 0.13370099999999999f, 0.13455700000000001f, 0.13356699999999999f, 0.133965f, 0.13456899999999999f, 0.13520199999999999f, 0.183896f, 0.13358200000000001f, 0.135793f, 0.135793f, 0.17880799999999999f, 0.18057699999999999f, 0.183896f, -0.0032239999999999999f, -0.0032239999999999999f, -0.0032239999999999999f },
      .mode_zone_b = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0085009000000000005f, 0.0053971000000000002f, 0.0044979f, 0.0026587f, 0.0047869999999999996f, 0.0039294000000000004f, 0.0028993999999999999f, 0.0018116f, 0.0f, 0.0047542000000000001f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.3333333f, 0.3333333f, 0.3333333f },
      .mode_zone_m = { 0.067234100000000005f, 0.087547799999999995f, 0.13643130000000001f, 0.19483919999999999f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0025942999999999999f, 0.0052367999999999998f, 1.0f, 0.0f, 0.0f, 0.0f, 0.89423189999999997f, 0.93100799999999995f, 1.0f, 0.3333333f, 0.3333333f, 0.3333333f },
      .mode_zone_t = { 0.93276590000000004f, 0.91245220000000005f, 0.86356869999999997f, 0.80516080000000001f, 1.0f, 1.0f, 0.99149909999999997f, 0.99460289999999996f, 0.99550209999999995f, 0.99734129999999999f, 0.99521300000000001f, 0.99607060000000003f, 0.99450629999999995f, 0.99295160000000005f, 0.0f, 0.99524579999999996f, 1.0f, 1.0f, 0.1057681f, 0.068991999999999998f, 0.0f, 0.3333333f, 0.3333333f, 0.3333333f },
      .mode_feedback_b = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.00050427700000000002f, 0.00081721599999999995f, 0.00078711299999999998f, 0.001074834f, 0.00086589800000000004f, 0.00083716800000000001f, 0.00096239000000000003f, 0.00066677200000000005f, 0.00054368600000000004f, 0.000348885f, 0.0025127249999999999f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },
      .mode_feedback_m = { 0.0f, 6.0900000000000001e-06f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.00030969199999999998f, 0.00023531f, 0.000354555f, 7.5376000000000005e-05f, 0.00055765000000000003f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },
      .mode_feedback_t = { 0.0132f, 0.01319391f, 0.0132f, 0.0132f, 0.0132f, 0.0132f, 0.012695723000000001f, 0.012382784000000001f, 0.012412886999999999f, 0.012125166f, 0.012334102f, 0.012362832000000001f, 0.01192792f, 0.012297918999999999f, 0.012301757999999999f, 0.012775738999999999f, 0.0079474209999999997f, 0.0093923319999999998f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },
      .zone_pan = { -0.32936100000000001f, 0.183896f, 0.135793f },
      .residual_alpha = { 2.0007999999999999e-05f, 4.0852000000000001e-05f, 0.000138262f },
      .residual_gain = { 0.80000000000000004f, 0.80000000000000004f, 0.111488f },
      .feedback_scale = { 0.01193785f, 0.037195039999999999f, 0.039790659999999999f },
      .radiation_scale = 0.0750281f,
      .excitation_pan_mode_weight = 0.10000000000000001f,
      .excitation_pan_zone_weight = 0.90000000000000002f,
      .excitation_pan_slew_per_second = 240.0f,
      .excitation_pan_slew_min = 0.001f,
      .excitation_pan_slew_max = 0.01f,
      .spatial_pan_limit = 0.80000000000000004f,
    },
    .sympathetic = { .excitation_gain = 0.50845200000000002f, .return_gain = 0.01f, .q_undamped = { 220.0f, 220.0f }, .q_damped = { 14.8324f, 14.8324f }, .gain_undamped = { 0.42571900000000001f, 0.2780049f }, .gain_damped = { 0.02870197072281f, 0.018743087577951002f }, .second_mode_ratio = 2.0f, .second_mode_inharmonicity_scale = 1.5f, .idle_energy_threshold = 1e-08f },
    .longitudinal = { .full_strength_until_midi = 45.0f, .fade_out_until_midi = 57.0f, .energy_dc_alpha = 0.0040000000000000001f, .reference_pitches = { 21.0f, 24.0f, 27.0f, 30.0f, 33.0f, 36.0f, 39.0f, 42.0f, 45.0f }, .frequency_hz = { { 665.03909999999996f, 896.48440000000005f }, { 706.05470000000003f, 987.52620000000002f }, { 671.11300000000006f, 711.91409999999996f }, { 650.39059999999995f, 697.26559999999995f }, { 662.10940000000005f, 828.26689999999996f }, { 850.9271f, 919.92190000000005f }, { 858.39840000000004f, 1016.6016f }, { 1968.75f, 2066.8944999999999f }, { 1552.7344000000001f, 1664.0625f } }, .q = { { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f }, { 80.0f, 80.0f } }, .gain = { { 1.0f, 0.83406409999999997f }, { 1.0f, 1.0f }, { 0.31128319999999998f, 0.679589f }, { 0.87994969999999995f, 0.63305959999999994f }, { 1.0f, 0.30687320000000001f }, { 0.50474549999999996f, 0.738124f }, { 0.1335799f, 0.11115849999999999f }, { 0.0182176f, 0.041965799999999998f }, { 0.0812967f, 0.058265299999999999f } } },
    .radiation = { .dry_transverse_gain = 0.01f, .dry_bridge_gain = 0.0040000000000000001f, .dry_longitudinal_gain = 0.0f, .contact_transient_gain = 1.0f, .voice_side_scale = 0.52000000000000002f },
    .velocity = { .output_gain_base = 0.69999999999999996f, .output_gain_velocity_scale = 0.29999999999999999f },
  },
};
static const SoraotoGrandPresetProfileMap soraoto_grand_preset_profiles[SORAOTO_GRAND_FACTORY_PRESET_COUNT] = {
  { 2470181992u, 0u },
  { 554093942u, 0u },
  { 939022642u, 0u },
  { 1500797838u, 0u },
  { 2972903164u, 0u },
  { 963889362u, 0u },
  { 2703662546u, 0u },
  { 125111596u, 0u },
  { 1180130270u, 0u },
  { 2530738680u, 0u },
  { 2458269434u, 0u },
  { 3573554742u, 0u },
  { 3622504252u, 0u },
  { 1342008220u, 0u },
  { 1660265658u, 0u },
  { 1837122960u, 0u },
  { 2476924332u, 0u },
  { 2104977048u, 0u },
  { 790394882u, 0u },
  { 463643058u, 0u },
  { 376609954u, 0u },
  { 272669298u, 0u },
  { 2247117436u, 0u },
  { 3661817190u, 0u },
  { 2321614792u, 0u },
  { 3186007998u, 0u },
  { 121745166u, 0u },
  { 519212732u, 0u },
  { 4104702862u, 0u },
  { 2401778806u, 0u },
  { 2071838856u, 0u },
  { 808610032u, 0u },
  { 215587484u, 0u },
  { 1548158526u, 0u },
  { 734979682u, 0u },
  { 25815508u, 0u },
  { 3117084896u, 0u },
  { 770408252u, 0u },
  { 4024454426u, 0u },
  { 1850126694u, 0u },
  { 2563599254u, 0u },
  { 1972536056u, 0u },
  { 1798781844u, 0u },
  { 1588551466u, 0u },
  { 1313448928u, 0u },
  { 3946615812u, 0u },
  { 213005780u, 0u },
  { 3797762006u, 0u },
  { 4218078144u, 0u },
  { 2508747746u, 0u },
  { 3152982532u, 0u },
};
static inline int soraoto_grand_profile_index_for_preset_id(uint32_t preset_id) {
  for (uint32_t i=0;i<SORAOTO_GRAND_PROFILE_COUNT;i++) if (soraoto_grand_profile_preset_ids[i]==preset_id) return (int)i;
  return -1;
}
static inline uint16_t soraoto_grand_profile_index_for_preset(uint32_t preset_id) {
  for (uint32_t i=0;i<SORAOTO_GRAND_FACTORY_PRESET_COUNT;i++) if (soraoto_grand_preset_profiles[i].preset_id==preset_id) return soraoto_grand_preset_profiles[i].profile_index;
  return (uint16_t)soraoto_grand_profile_index_for_preset_id(SORAOTO_GRAND_DEFAULT_PRESET_ID);
}
#endif
