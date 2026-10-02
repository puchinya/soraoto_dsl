#!/usr/bin/env python3
from __future__ import annotations
import math, re, struct
from pathlib import Path
import json

DSP=Path(__file__).resolve().parents[1]
PLUGIN=DSP/'plugins'/'dsp'/'super-synth'; SRC=PLUGIN/'src'; SHARED=DSP/'shared'; GEN=SHARED/'generated'
ABI=0x00010000

# Presets are stored directly in the current SuperSynth parameter model; no legacy runtime translation is required.
PRESETS=json.loads((PLUGIN/'presets.json').read_text(encoding='utf-8'))

GRAND_PROFILE_KIND='grand_piano_v1'
GRAND_PROFILE_REVISION=2
GRAND_SB_MODE_COUNT=24
GRAND_PROFILE_HEADER=SHARED/'generated'/'super-synth_grand_profiles.h'

def _array(length,item):
    return ('array',length,item)

_TERMINATION_SCHEMA={
  'lowpass_base':'number','lowpass_damping_coefficient':'number','lowpass_key_coefficient':'number',
  'high_frequency_loss_base':'number','high_frequency_loss_damping_coefficient':'number',
  'high_frequency_loss_key_coefficient':'number','high_frequency_loss_wound_coefficient':'number',
  'reflection_loss_base':'number','key_loss_base':'number','key_loss_coefficient':'number',
  'damping_base':'number','damping_coefficient':'number','reference_loss_multiplier':'number',
  'passive_min':'number','passive_max':'number','dispersion_multiplier':'number',
}
_BRIDGE_TERMINATION_SCHEMA={**_TERMINATION_SCHEMA,'release_loss_multiplier':'number'}
_SOUNDBOARD_MODE_SCHEMA={
  'frequency_hz':'number','q':'number','gain':'number','pan':'number',
  'zone_b':'number','zone_m':'number','zone_t':'number',
  'feedback_b':'number','feedback_m':'number','feedback_t':'number',
}
_GRAND_PROFILE_SCHEMA={
  'hammer':{
    'force_scale':'number','initial_velocity_base':'number','initial_velocity_velocity_scale':'number',
    'initial_velocity_hardness_base':'number','initial_velocity_hardness_scale':'number',
    'velocity_hardness_amount':'number',
    'compression_scale':'number','compression_max_normalized':'number','stiffness_soft':'number',
    'stiffness_hard':'number','felt_exponent_soft':'number','felt_exponent_hard':'number',
    'contact_loss_soft':'number','contact_loss_hard':'number','contact_loss_min':'number',
    'contact_loss_max':'number','mass_soft':'number','mass_hard':'number','noise_filter_base':'number',
    'noise_filter_hardness_scale':'number','noise_gain_base':'number','noise_gain_hardness_scale':'number',
    'radiation_transient_gain':'number',
  },
  'string':{
    'strike_position_bass':'number','strike_position_treble':'number',
    'unison_activation_start_midi':'number','unison_activation_width_midi':'number',
    'one_to_two_string_midi':'number','two_to_three_string_midi':'number',
    'unison_detune_base_cents':'number','unison_detune_amount':'number',
    'unison_detune_key_base':'number','unison_detune_key_scale':'number',
    'unison_offsets':_array(3,'number'),'strike_offsets':_array(3,'number'),
    'strike_offset_base':'number','strike_offset_unison_scale':'number',
    'strike_position_min':'number','strike_position_max':'number',
    'characteristic_impedance':_array(3,'number'),'geometric_phase_delay_samples':'number',
    'wound_reference_midi':'number','wound_transition_width_midi':'number',
    'reference_pitches':_array(30,'number'),'inharmonicity_b':_array(30,'number'),
    'reference_loss_base':'number','reference_loss_register_start':'number',
    'reference_loss_register_width':'number','decay_reference_midi':'number',
    'release_loss_base':'number',
    'release_loss_damping_scale':'number','release_loss_key_scale':'number',
    'dispersion_base':'number','dispersion_inharmonicity_base':'number',
    'dispersion_inharmonicity_key_scale':'number','agraffe':_TERMINATION_SCHEMA,
    'bridge_termination':_BRIDGE_TERMINATION_SCHEMA,
  },
  'bridge':{
    'impedance_bass':'number','impedance_treble':'number',
    'radiation_diff_base_bass':'number','radiation_diff_base_treble':'number',
    'radiation_diff_velocity2':'number','radiation_diff_key_velocity3':'number',
  },
  'zones':{
    'bass_to_tenor_start':'number','bass_to_tenor_end':'number',
    'tenor_to_treble_start':'number','tenor_to_treble_end':'number',
    'low_bass_gate_start':'number','low_bass_gate_end':'number',
  },
  'soundboard':{
    'size_scale_min':'number','size_scale_max':'number',
    'modes':_array(24,_SOUNDBOARD_MODE_SCHEMA),
    'zone_pan':_array(3,'number'),'residual_alpha':_array(3,'number'),
    'residual_gain':_array(3,'number'),'feedback_scale':_array(3,'number'),
    'radiation_scale':'number','excitation_pan_mode_weight':'number',
    'excitation_pan_zone_weight':'number','excitation_pan_slew_per_second':'number',
    'excitation_pan_slew_min':'number','excitation_pan_slew_max':'number',
    'spatial_pan_limit':'number',
  },
  'sympathetic':{
    'excitation_gain':'number','return_gain':'number','q_undamped':_array(2,'number'),
    'q_damped':_array(2,'number'),'gain_undamped':_array(2,'number'),
    'gain_damped':_array(2,'number'),'second_mode_ratio':'number',
    'second_mode_inharmonicity_scale':'number','idle_energy_threshold':'number',
  },
  'longitudinal':{
    'full_strength_until_midi':'number','fade_out_until_midi':'number',
    'energy_dc_alpha':'number','reference_pitches':_array(9,'number'),
    'frequency_hz':_array(9,_array(2,'number')),'q':_array(9,_array(2,'number')),
    'gain':_array(9,_array(2,'number')),
  },
  'radiation':{
    'dry_transverse_gain':'number','dry_bridge_gain':'number','dry_longitudinal_gain':'number',
    'contact_transient_gain':'number','voice_side_scale':'number',
  },
  'velocity':{'output_gain_base':'number','output_gain_velocity_scale':'number'},
}

def _validate_profile_shape(path,value,schema):
    if isinstance(schema,dict):
        if not isinstance(value,dict):raise ValueError(f'{path} must be an object')
        expected=set(schema);actual=set(value)
        missing=sorted(expected-actual);unknown=sorted(actual-expected)
        if missing:raise ValueError(f'{path} missing fields: {", ".join(missing)}')
        if unknown:raise ValueError(f'{path} has unknown fields: {", ".join(unknown)}')
        for key,child in schema.items():_validate_profile_shape(f'{path}.{key}',value[key],child)
    elif isinstance(schema,tuple) and schema[0]=='array':
        if not isinstance(value,list) or len(value)!=schema[1]:raise ValueError(f'{path} must contain exactly {schema[1]} entries')
        for index,child in enumerate(value):_validate_profile_shape(f'{path}[{index}]',child,schema[2])
    else:
        if schema!='number' or isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(float(value)):
            raise ValueError(f'{path} must be a finite number')

def validate_grand_profile(name,config):
    if not isinstance(config,dict):raise ValueError(f'{name}.engine_config must be an object')
    expected={'kind','revision',*_GRAND_PROFILE_SCHEMA}
    missing=sorted(expected-set(config));unknown=sorted(set(config)-expected)
    if missing:raise ValueError(f'{name}.engine_config missing fields: {", ".join(missing)}')
    if unknown:raise ValueError(f'{name}.engine_config has unknown fields: {", ".join(unknown)}')
    if config['kind']!=GRAND_PROFILE_KIND:raise ValueError(f'{name}.engine_config.kind must be {GRAND_PROFILE_KIND}')
    if type(config['revision']) is not int or config['revision']!=GRAND_PROFILE_REVISION:
        raise ValueError(f'{name}.engine_config.revision must be {GRAND_PROFILE_REVISION}')
    for key,schema in _GRAND_PROFILE_SCHEMA.items():_validate_profile_shape(f'{name}.engine_config.{key}',config[key],schema)
    h=config['hammer'];s=config['string'];b=config['bridge'];z=config['zones'];sb=config['soundboard'];sy=config['sympathetic'];lo=config['longitudinal']
    if h['force_scale']<=0 or h['compression_scale']<=0 or h['compression_max_normalized']<=0:raise ValueError(f'{name}: hammer scale values must be positive')
    if h['initial_velocity_base']!=0.42 or h['initial_velocity_velocity_scale']!=1.05:raise ValueError(f'{name}: hammer launch intercept/slope are FIXED_ARCHITECTURE at 0.42/1.05')
    if not (0.0<=h['velocity_hardness_amount']<=1.0):raise ValueError(f'{name}: hammer.velocity_hardness_amount must be in [0,1]')
    if min(h['mass_soft'],h['mass_hard'])<=0 or h['stiffness_soft']<=0 or h['stiffness_hard']<=0:raise ValueError(f'{name}: hammer mass and stiffness must be positive')
    if not (2.0<=h['felt_exponent_soft']<=h['felt_exponent_hard']<=4.0):raise ValueError(f'{name}: felt exponents must be ordered within [2,4]')
    if h['contact_loss_min']<0 or h['contact_loss_max']<h['contact_loss_min'] or h['contact_loss_soft']<0 or h['contact_loss_hard']<0:raise ValueError(f'{name}: invalid hammer contact-loss range')
    if s['one_to_two_string_midi']>=s['two_to_three_string_midi'] or not (21<=s['one_to_two_string_midi']<s['two_to_three_string_midi']<=108):raise ValueError(f'{name}: string-count transitions must increase within MIDI 21..108')
    if s['unison_activation_width_midi']<=0 or s['strike_position_min']<=0 or s['strike_position_max']<s['strike_position_min']:raise ValueError(f'{name}: invalid string geometry range')
    if min(s['characteristic_impedance'])<=0:raise ValueError(f'{name}: characteristic impedances must be positive')
    if any(a>=b for a,b in zip(s['reference_pitches'],s['reference_pitches'][1:])):raise ValueError(f'{name}: string reference pitches must increase')
    if any(x<0 for x in s['inharmonicity_b']):raise ValueError(f'{name}: inharmonicity values must be nonnegative')
    for termination_name in ('agraffe','bridge_termination'):
        t=s[termination_name]
        if not (0<=t['passive_min']<=t['reflection_loss_base']<=t['passive_max']<=1):raise ValueError(f'{name}: invalid {termination_name} passive range')
        if not (0<=t['lowpass_base']<=1) or t['dispersion_multiplier']<0:raise ValueError(f'{name}: invalid {termination_name} filter/dispersion range')
    if min(b['impedance_bass'],b['impedance_treble'])<=0:raise ValueError(f'{name}: bridge impedances must be positive')
    if not (z['bass_to_tenor_start']<z['bass_to_tenor_end']<=z['tenor_to_treble_start']<z['tenor_to_treble_end']):raise ValueError(f'{name}: zone transitions must be ordered')
    if not (z['low_bass_gate_start']<z['low_bass_gate_end']):raise ValueError(f'{name}: low-bass gate must be ordered')
    if not (0<sb['size_scale_min']<=sb['size_scale_max']) or sb['radiation_scale']<=0:raise ValueError(f'{name}: soundboard scales must be positive')
    if not (0<sb['excitation_pan_slew_min']<=sb['excitation_pan_slew_max']) or sb['spatial_pan_limit']<0 or sb['spatial_pan_limit']>1:raise ValueError(f'{name}: invalid soundboard spatial limits')
    for mode_index,mode in enumerate(sb['modes']):
        if not (0<mode['frequency_hz']<24000) or mode['q']<=0 or mode['gain']<0:raise ValueError(f'{name}: invalid soundboard mode {mode_index} frequency/Q/gain')
        if not all(-1<=mode[k]<=1 for k in ('pan',)) or min(mode[k] for k in ('zone_b','zone_m','zone_t'))<0:raise ValueError(f'{name}: invalid soundboard mode {mode_index} pan/zones')
        if abs(mode['zone_b']+mode['zone_m']+mode['zone_t']-1.0)>1e-4:raise ValueError(f'{name}: soundboard mode {mode_index} zone weights must sum to one')
        if min(mode['feedback_b'],mode['feedback_m'],mode['feedback_t'])<0:raise ValueError(f'{name}: soundboard feedback must be nonnegative')
    if any(not -1<=x<=1 for x in sb['zone_pan']) or any(not 0<=x<=1 for x in sb['residual_alpha']):raise ValueError(f'{name}: invalid soundboard pan/residual alpha')
    if any(x<0 for x in sb['residual_gain']+sb['feedback_scale']):raise ValueError(f'{name}: soundboard gains must be nonnegative')
    if any(x<=0 for x in sy['q_undamped']+sy['q_damped']) or any(x<0 for x in sy['gain_undamped']+sy['gain_damped']):raise ValueError(f'{name}: invalid sympathetic Q/gain')
    if sy['second_mode_ratio']<=0 or sy['idle_energy_threshold']<0:raise ValueError(f'{name}: invalid sympathetic mode/cutoff')
    if not (lo['full_strength_until_midi']<lo['fade_out_until_midi']<=108) or lo['energy_dc_alpha']<0 or lo['energy_dc_alpha']>1:raise ValueError(f'{name}: invalid longitudinal range/filter')
    if any(a>=b for a,b in zip(lo['reference_pitches'],lo['reference_pitches'][1:])):raise ValueError(f'{name}: longitudinal reference pitches must increase')
    for table in (lo['frequency_hz'],lo['q']):
        if any(value<=0 or value>=24000 for row in table for value in row):raise ValueError(f'{name}: longitudinal frequencies/Q values are invalid')
    if any(value<0 for row in lo['gain'] for value in row):raise ValueError(f'{name}: longitudinal gains must be nonnegative')
    if config['velocity']['output_gain_base']<0 or config['velocity']['output_gain_velocity_scale']<0:raise ValueError(f'{name}: velocity gain curve must be nonnegative')
    for key,value in config['radiation'].items():
        if value<0:raise ValueError(f'{name}: radiation.{key} must be nonnegative')
    if config['radiation']['dry_longitudinal_gain'] != 0.0:
        raise ValueError(f'{name}: radiation.dry_longitudinal_gain is FIXED_ARCHITECTURE and must be 0.0')
    return config

def validate_grand_profiles(presets):
    grand=[]
    for name in sorted(presets):
        preset=presets[name]
        is_grand=preset.get('engine_model','wavetable')=='concert_grand'
        if is_grand:
            if 'engine_config' not in preset:raise ValueError(f'{name}: concert_grand preset requires engine_config')
            grand.append((name,validate_grand_profile(name,preset['engine_config'])))
        elif 'engine_config' in preset:
            raise ValueError(f'{name}: engine_config is only valid for a concert_grand preset')
    if not grand:raise ValueError('at least one concert_grand preset profile is required')
    if not any(name=='concert_grand' for name,_ in grand):raise ValueError('default concert_grand profile is required')
    return grand

def grand_profile_header(presets):
    profiles=validate_grand_profiles(presets)
    ids=stable_preset_ids(presets.keys())
    default_id=ids['concert_grand']
    all_names=sorted(presets)
    profile_index={name:i for i,(name,_) in enumerate(profiles)}
    mapping=[]
    for name in all_names:mapping.append((ids[name],profile_index.get(name,profile_index['concert_grand'])))
    def cf(value):
        text=format(float(value),'.17g')
        if '.' not in text and 'e' not in text.lower():text += '.0'
        return text+'f'
    def array(values,item_schema):
        if isinstance(item_schema,dict):
            return '{ '+', '.join('.'+key+' = '+array(values[key],child) for key,child in item_schema.items())+' }'
        if isinstance(item_schema,tuple) and item_schema[0]=='array':
            return '{ '+', '.join(array(value,item_schema[2]) for value in values)+' }'
        return cf(values)
    lines=['#ifndef SORAOTO_GENERATED_SUPER_SYNTH_GRAND_PROFILES_H','#define SORAOTO_GENERATED_SUPER_SYNTH_GRAND_PROFILES_H','#include <stdint.h>',
      f'#define SORAOTO_GRAND_PROFILE_COUNT {len(profiles)}',f'#define SORAOTO_GRAND_FACTORY_PRESET_COUNT {len(mapping)}',
      f'#define SORAOTO_GRAND_DEFAULT_PRESET_ID {default_id}u',
      'typedef struct { uint32_t preset_id; uint16_t profile_index; } SoraotoGrandPresetProfileMap;',
      'static const uint32_t soraoto_grand_profile_preset_ids[SORAOTO_GRAND_PROFILE_COUNT] = { '+', '.join(f'{ids[name]}u' for name,_ in profiles)+' };',
      'static const GrandEngineConfig soraoto_grand_profiles[SORAOTO_GRAND_PROFILE_COUNT] = {']
    for _,config in profiles:
        lines.append('  {')
        for key,schema in _GRAND_PROFILE_SCHEMA.items():
            if key=='soundboard':
                lines.append('    .soundboard = {')
                for field in ('size_scale_min','size_scale_max'):
                    lines.append('      .'+field+' = '+cf(config['soundboard'][field])+',')
                for field in _SOUNDBOARD_MODE_SCHEMA:
                    values=[mode[field] for mode in config['soundboard']['modes']]
                    lines.append('      .mode_'+field+' = '+array(values,_array(GRAND_SB_MODE_COUNT,'number'))+',')
                for field,child in schema.items():
                    if field not in ('size_scale_min','size_scale_max','modes'):
                        lines.append('      .'+field+' = '+array(config['soundboard'][field],child)+',')
                lines.append('    },')
            else:lines.append('    .'+key+' = '+array(config[key],schema)+',')
        lines.append('  },')
    lines += ['};','static const SoraotoGrandPresetProfileMap soraoto_grand_preset_profiles[SORAOTO_GRAND_FACTORY_PRESET_COUNT] = {']
    lines += [f'  {{ {preset_id}u, {index}u }},' for preset_id,index in mapping]
    lines += ['};','static inline int soraoto_grand_profile_index_for_preset_id(uint32_t preset_id) {','  for (uint32_t i=0;i<SORAOTO_GRAND_PROFILE_COUNT;i++) if (soraoto_grand_profile_preset_ids[i]==preset_id) return (int)i;','  return -1;','}','static inline uint16_t soraoto_grand_profile_index_for_preset(uint32_t preset_id) {','  for (uint32_t i=0;i<SORAOTO_GRAND_FACTORY_PRESET_COUNT;i++) if (soraoto_grand_preset_profiles[i].preset_id==preset_id) return soraoto_grand_preset_profiles[i].profile_index;','  return (uint16_t)soraoto_grand_profile_index_for_preset_id(SORAOTO_GRAND_DEFAULT_PRESET_ID);','}','#endif']
    return '\n'.join(lines)+'\n'

def cbor_head(major,n):
    if n<24:return bytes([(major<<5)|n])
    if n<=0xff:return bytes([(major<<5)|24,n])
    if n<=0xffff:return bytes([(major<<5)|25])+struct.pack('>H',n)
    if n<=0xffffffff:return bytes([(major<<5)|26])+struct.pack('>I',n)
    return bytes([(major<<5)|27])+struct.pack('>Q',n)

def cbor(v):
    if v is None:return b'\xf6'
    if v is False:return b'\xf4'
    if v is True:return b'\xf5'
    if isinstance(v,int):return cbor_head(0,v) if v>=0 else cbor_head(1,-1-v)
    if isinstance(v,float):
        if not math.isfinite(v):raise ValueError('non-finite')
        if v==0:v=0.0
        return b'\xfb'+struct.pack('>d',v)
    if isinstance(v,(bytes,bytearray)):
        b=bytes(v);return cbor_head(2,len(b))+b
    if isinstance(v,str):
        b=v.encode();return cbor_head(3,len(b))+b
    if isinstance(v,(list,tuple)):return cbor_head(4,len(v))+b''.join(cbor(x) for x in v)
    if isinstance(v,dict):
        items=sorted(((str(k).encode(),str(k),x) for k,x in v.items()),key=lambda z:z[0])
        return cbor_head(5,len(items))+b''.join(cbor(k)+cbor(x) for _,k,x in items)
    raise TypeError(type(v))

def uleb(n):
    out=bytearray()
    while True:
        b=n&0x7f;n>>=7
        if n:out.append(b|0x80)
        else:out.append(b);return bytes(out)

def append_custom(wasm,name,payload):
    nb=name.encode();body=uleb(len(nb))+nb+payload
    return wasm+b'\x00'+uleb(len(body))+body

def write_if_changed(path,data):
    raw=data.encode('utf-8') if isinstance(data,str) else data
    if not path.exists() or path.read_bytes()!=raw:path.write_bytes(raw)

def blocks(src, keyword):
    # yields (header, body) for keyword ... { ... }
    pos=0
    pat=re.compile(r'\b'+re.escape(keyword)+r'\b')
    while True:
        m=pat.search(src,pos)
        if not m:break
        op=src.find('{',m.end())
        if op<0:break
        d=1;i=op+1
        while i<len(src) and d:
            d += (src[i]=='{')-(src[i]=='}'); i+=1
        if d:raise ValueError('unbalanced interface source')
        yield src[m.start():op].strip(),src[op+1:i-1]
        pos=i

def parse_scalar(tok, typ, enums):
    s=tok.strip().rstrip(',')
    if typ=='Bool': return s=='true'
    if typ.startswith('Enum<'):
        en=typ[5:-1]; vals=enums[en]; return vals.index(s)
    mult=1.0
    for suf,m in [('khz',1000.0),('hz',1.0),('ms',0.001),('s',1.0)]:
        if s.lower().endswith(suf):
            s=s[:-len(suf)];mult=m;break
    v=float(s)
    if typ=='Int':return int(round(v*mult))
    return v*mult

def parse_interface(path):
    src=path.read_text(encoding='utf-8')
    enums={m.group(1):m.group(2).split() for m in re.finditer(r'\benum\s+(\w+)\s*\{([^}]*)\}',src)}
    params=[]
    pre=src.split('parameter ',1)[0]
    def root_text(k,default=None):
        m=re.search(r'\b'+re.escape(k)+r'\s*:\s*"([^"]*)"',pre);return m.group(1) if m else default
    kind_m=re.search(r'\bkind\s*:\s*([A-Za-z_][\w-]*)',pre)
    if not kind_m: raise ValueError('plugin interface kind is required')
    kinds=[kind_m.group(1)]
    mq_m=re.search(r'\bcontrol_modulation_max_quantum\s*:\s*(\d+)',pre)
    control_max_quantum=int(mq_m.group(1)) if mq_m else 64
    if control_max_quantum < 1: raise ValueError('control_modulation_max_quantum must be >= 1')
    for head,body in blocks(src,'parameter'):
        m=re.match(r'parameter\s+([A-Za-z_][\w.]*)\s*:\s*([^\s{]+)',head)
        if not m:continue
        name,typ=m.group(1),m.group(2)
        def prop(pattern,default=None):
            mm=re.search(pattern,body);return mm.group(1) if mm else default
        pid=int(prop(r'\bid\s*:\s*(\d+)'))
        default_tok=prop(r'\bdefault\s*:\s*([^\s}]+)')
        rr=re.search(r'\brange\s*:\s*([^\s}]+)\.\.([^\s}]+)',body)
        enum_vals=enums.get(typ[5:-1],[]) if typ.startswith('Enum<') else None
        default=parse_scalar(default_tok,typ,enums)
        lo=hi=None
        if rr:lo=parse_scalar(rr.group(1),typ,enums);hi=parse_scalar(rr.group(2),typ,enums)
        elif typ=='Bool': pass
        elif enum_vals is not None: lo=0;hi=len(enum_vals)-1
        unit={'Norm':'norm','Hz':'hz','Db':'db','Time':'seconds','Semitone':'semitone','Cent':'cent','Pan':'pan','Width':'width'}.get(typ,'none')
        ptype='enum' if typ.startswith('Enum<') else {'Bool':'bool','Int':'int','String':'string'}.get(typ,'float')
        scale_s=prop(r'\bscale\s*:\s*([A-Za-z_]+)','linear')
        scale={'kind':'log' if scale_s=='logarithmic' else 'linear'}
        automation=prop(r'\bautomation\s*:\s*([A-Za-z_]+)','none')
        mod=prop(r'\bmodulation\s*:\s*([A-Za-z_]+)','none')
        modulation={'kind':mod}
        if mod=='control':modulation['max_quantum_samples']=control_max_quantum
        if ptype in ('bool','int','enum'):modulation={'kind':'none'}
        params.append({
            'id':pid,'path':name,'name':name.replace('_',' ').title(),'unit_id':0,
            'type':ptype,'unit':unit,'default':default,'min':lo,'max':hi,
            'enum_values':enum_vals,'scale':scale,
            'interpolation':'step' if ptype in ('bool','int','enum','string') else 'linear',
            'automation':automation,'modulation':modulation,
            'read_only':False,'hidden':False,'meter':False,'bypass':False,'program_selector':False,
            'wrap_around':False,'list':ptype in ('bool','int','enum'),'function':None,'display_precision':None,
        })
    params.sort(key=lambda p:p['id'])
    return src,{
        'abi_major':1,'abi_minor':0,'id':root_text('id'),'vendor':root_text('vendor','soraotoDSL'),
        'name':root_text('name','SuperSynth v9'),'version':root_text('version','9.0.0'),'kinds':kinds,
        'parameters':params,
    }

def preset_map(p):
    out={}
    if p.get('category') is not None: out['category']=p.get('category')
    if p.get('description') is not None: out['description']=p.get('description')
    def setv(k,v):
        if v is not None: out[k]=v
    setv('master_gain',p.get('master'));setv('filter_cutoff',p.get('cutoff'));setv('filter_resonance',p.get('resonance'))
    setv('amp_attack',p.get('attack'));setv('amp_decay',p.get('decay'));setv('amp_sustain',p.get('sustain'));setv('amp_release',p.get('release'))
    setv('unison_detune',p.get('detune'));setv('unison_voices',min(8,int(p.get('unison',3))))
    setv('stereo_spread',p.get('spread'));setv('filter_env_amount',p.get('filter_env'));setv('lfo1_rate',p.get('lfo_rate'));setv('lfo1_pitch',p.get('lfo_pitch'))
    setv('portamento',p.get('portamento'));setv('noise_level',p.get('noise_mix'));setv('osc_a_level',p.get('osc1_mix'))
    blevel=p.get('osc2_mix'); trim=p.get('osc2_level_trim',1.0)
    if blevel is not None:setv('osc_b_level',max(0,min(1,float(blevel)*float(trim))))
    setv('osc_b_semitones',p.get('osc2_semitones'));setv('ring_mix',p.get('ring_mod'));setv('fm_amount',p.get('fm_amount'));setv('pulse_width',p.get('pulse_width'))
    setv('filter_drive',p.get('filter_drive'));setv('saturation',p.get('drive'));setv('phase_random',p.get('phase_random'));setv('pan',p.get('output_pan'))
    setv('lfo2_rate',p.get('lfo2_rate'))
    if 'lfo1_cutoff' in p:setv('lfo1_cutoff',max(-1,min(1,float(p['lfo1_cutoff'])/2)))
    if 'lfo2_cutoff' in p:setv('lfo2_position',max(-1,min(1,float(p['lfo2_cutoff'])/2)))
    if 'velocity_filter' in p:setv('velocity_to_filter',max(0,min(1,float(p['velocity_filter'])/2)))
    if 'aftertouch_filter' in p:setv('pressure_to_filter',max(0,min(1,float(p['aftertouch_filter'])/2)))
    if 'timbre_filter' in p:setv('timbre_to_position',max(0,min(1,float(p['timbre_filter'])/2)))
    if 'keytrack' in p:setv('keytrack',max(0,min(1,float(p['keytrack']))))
    fm={0:'lowpass',1:'bandpass',2:'highpass'}
    if 'filter_type' in p:
        raw=p['filter_type']
        if isinstance(raw,str):
            setv('filter_mode', raw if raw in ('lowpass','bandpass','highpass') else 'lowpass')
        else:
            setv('filter_mode',fm.get(int(raw),'lowpass'))
    wave={'sine':0.0,'triangle':1/7,'saw':2/7,'square':3/7,'pulse':3.5/7}
    if 'waveform' in p:setv('osc_a_position',wave.get(str(p['waveform']),2/7))
    if 'osc2_waveform' in p:setv('osc_b_position',wave.get(str(p['osc2_waveform']),1/7))
    if 'pwm_depth' in p:setv('osc_a_warp',max(0,min(1,float(p['pwm_depth'])*0.5)))
    for old,new in [('filter_attack','filter_attack'),('filter_decay','filter_decay'),('filter_sustain','filter_sustain'),('filter_release','filter_release')]:
        if old in p and float(p[old])>=0:setv(new,p[old])
    return out

def note_exprs():
    def num(i,name,unit,default,lo,hi,bip=False,absolute=False):
        return {'id':i,'name':name,'short_name':None,'unit_id':0,'value':{'kind':'numeric','unit':unit,'default':float(default),'min':float(lo),'max':float(hi),'step_count':0,'display_precision':None,'flags':{'bipolar':bip,'one_shot':False,'absolute':absolute}},'associated_parameter_id':None}
    return [num(1,'Pitch','semitone',0,-48,48,True,False),num(2,'Pressure','norm',0,0,1),num(3,'Timbre','norm',0.5,0,1),num(4,'Volume','norm',1,0,1),num(5,'Pan','pan',0,-1,1,True,True)]

def normalized_value(p, value):
    t=p['type']; lo=p['min']; hi=p['max']
    if t=='bool': return 1.0 if bool(value) else 0.0
    if t=='enum':
        vals=p['enum_values'] or []
        if isinstance(value,str):
            if value not in vals: raise ValueError(f"unknown enum value {p['path']}={value}")
            idx=vals.index(value)
        else: idx=int(round(float(value)))
        return 0.0 if len(vals)<=1 else max(0.0,min(1.0,idx/(len(vals)-1)))
    if t=='int':
        v=max(int(lo),min(int(hi),int(round(float(value))))); n=int(hi-lo+1)
        return 0.0 if n<=1 else (v-lo)/(n-1)
    v=float(value)
    if p['scale']['kind']=='log':
        if v<=0 or lo<=0 or hi<=lo: raise ValueError(f"invalid log value {p['path']}={value}")
        return max(0.0,min(1.0,math.log(v/lo)/math.log(hi/lo)))
    return max(0.0,min(1.0,(v-lo)/(hi-lo))) if hi is not None and lo is not None and hi>lo else max(0.0,min(1.0,v))

def normalized_default(p):
    return normalized_value(p,p['default'])

def stable_preset_ids(names):
    import hashlib
    used=set(); out={}
    for name in sorted(names):
        raw=int.from_bytes(hashlib.sha256(("soraoto-factory-preset-v1:"+name).encode('utf-8')).digest()[:4],'big') & 0xfffffffe
        if raw==0: raw=2
        while raw in used or raw==0xffffffff: raw=(raw+2)&0xfffffffe or 2
        used.add(raw);out[name]=raw
    return out

def preset_cpu_class(p):
    uni=int(p.get('unison_voices',3) or 3); engine=str(p.get('engine_model','wavetable'))
    os=str(p.get('oversample','x2'))
    score=(2 if os=='x4' else 1 if os=='x2' else 0)+(2 if uni>=5 else 1 if uni>=3 else 0)+(1 if engine in ('piano','concert_grand','tine','bowed','flute','reed','brass','vocal') else 0)
    return 'high' if score>=4 else 'medium' if score>=2 else 'low'

def recommended_range(category):
    return {
      'Bass':'C1-C4','Lead':'C3-C7','Pad':'C2-C7','Pluck':'C2-C7','Keys':'A0-C8','Brass':'E2-C6',
      'Strings':'C2-C7','Motion':'C2-C7','Guitar':'E2-E6','Wind':'C4-C7','Vocal':'C3-C6','Organ':'C2-C7','Harp':'C2-C7'
    }.get(str(category),'C2-C7')

def make_preset_tables(model,presets):
    by_path={p['path']:p for p in model['parameters']}
    ids=stable_preset_ids(presets.keys()); factory=[]; programs=[]; values=[]
    for name in sorted(presets):
        src=presets[name]; category=src.get('category'); engine=str(src.get('engine_model','wavetable'))
        tags=sorted(set(x for x in [str(category).lower() if category else None,engine,'factory'] if x))
        meta={
          'name':name,'category':category,'tags':tags,'author':'soraotoDSL','comment':src.get('description'),
          'instrument':category,'style':None,'character':None,'preset_type':'normal_preset','source_file_name':None,
        }
        pid=ids[name];factory.append({'id':pid,'meta':meta})
        attrs={
          'soraoto.family':str(category or 'General'),'soraoto.engine':engine,'soraoto.recommended_range':recommended_range(category),
          'soraoto.polyphony':str(int(src.get('polyphony_limit',32))),'soraoto.cpu_class':preset_cpu_class(src),'soraoto.preset_version':model['version'],
        }
        programs.append({'id':pid,'name':name,'category':category,'instrument':category,'style':None,'character':None,'tags':tags,'attributes':attrs})
        row=[]
        for p in model['parameters']:
            row.append(normalized_value(p,src[p['path']]) if p['path'] in src else normalized_default(p))
        values.append(row)
    return ids,factory,programs,values

def descriptor(model,presets):
    validate_grand_profiles(presets)
    L={'kind':'speakers','channels':['L','R']}
    browser_params={}
    for p in model['parameters']:
        browser_params[p['path']]={'id':p['id'],'type':p['type'],'unit':p['unit'],'min':p['min'],'max':p['max'],'default':p['default'],'enum_values':p['enum_values'],'scale':p['scale']}
    preset_ids,factory,programs,values=make_preset_tables(model,presets)
    browser_presets={name:{key:value for key,value in preset.items() if key!='engine_config'} for name,preset in presets.items()}
    return {
      'abi_major':1,'abi_minor':0,'id':model['id'],'vendor':model['vendor'],'name':model['name'],'version':model['version'],
      'kinds':model['kinds'],'max_instances':64,'compatible_plugin_ids':[],'required_wasm_features':['simd128'],'required_host_features':[],'optional_host_features':[],
      'process_context_requirements':[],'supports_f64':False,'supports_in_place':False,'deterministic_dsp':True,'distributable':False,
      'process_modes':['realtime','offline'],'io_modes':['simple','offline'],
      'units':[{'id':0,'parent_id':None,'name':'Root','program_list_id':1}],
      'audio_buses':[{'id':2,'name':'Main Out','unit_id':0,'direction':'output','role':'main','sample_semantics':'audio','default_active':True,'required':True,'supported_layouts':[L]}],
      'event_buses':[{'id':1,'name':'Notes','direction':'input','unit_id':0,'channel_count':16,'channel_unit_overrides':[],'dialects':['soraoto-note-v1']}],
      'routing_hints':[],'parameters':model['parameters'],'controllers':[],'note_expressions':note_exprs(),'articulations':[],'key_switches':[],
      'physical_ui_mappings':[],'orchestral_articulations':[],'controller_mappings':[],'remote_representations':[],'data_exchange_queues':[],
      'parameter_aliases':[],'factory_presets':factory,
      'program_lists':[{'id':1,'unit_id':0,'name':'SuperSynth Factory','mutable_program_names':False,'programs':programs}],
      'prefetch_support':'never','max_event_output_per_block':0,'max_host_requests_per_block':0,'max_asset_requests_per_block':0,'max_data_exchange_packets_per_block':0,
      'x-net.daradara.soraotodsl-browser':{'parameters':browser_params,'preset_ids':preset_ids,'presets':browser_presets},
      '_factory_values':values,'_program_infos':programs,
    }

def header(desc):
    ps=desc['parameters']; values=desc.pop('_factory_values'); program_infos=desc.pop('_program_infos'); b=cbor(desc)
    type_code={'float':0,'int':1,'enum':2,'bool':3}
    scale_code={'linear':0,'log':1,'power':2,'piecewise':3}
    ids=[p['id'] for p in ps];mins=[0 if p['min'] is None else p['min'] for p in ps];maxs=[1 if p['max'] is None else p['max'] for p in ps]
    defs=[normalized_default(p) for p in ps];types=[type_code[p['type']] for p in ps];scales=[scale_code[p['scale']['kind']] for p in ps];interpolations=[1 if p.get('interpolation')=='linear' else 0 for p in ps]
    aux=[]
    for p in ps:
        if p['scale']['kind']=='log':aux.append(math.log2(float(p['max'])/float(p['min'])))
        elif p['scale']['kind']=='power':aux.append(float(p['scale']['exponent']))
        else:aux.append(0.0)
    arr=lambda xs:','.join(repr(float(x))+'f' for x in xs)
    ia=lambda xs:','.join(str(int(x)) for x in xs)
    factory_ids=[x['id'] for x in desc['factory_presets']]
    matrix=',\n'.join('{ '+arr(row)+' }' for row in values)
    pbytes=[];offsets=[0]
    for info in program_infos:
        x=cbor(info);pbytes.extend(x);offsets.append(len(pbytes))
    lines=['#ifndef SORAOTO_GENERATED_PLUGIN_DESCRIPTOR_H','#define SORAOTO_GENERATED_PLUGIN_DESCRIPTOR_H','#define PLUGIN_IS_INSTRUMENT 1','#define PLUGIN_INPUT_BUS_COUNT 0','#define PLUGIN_OUTPUT_BUS_COUNT 1',f'#define PLUGIN_PARAM_COUNT {len(ps)}']
    lines += [f'static const unsigned int soraoto_param_ids[{len(ps)}]={{ {ia(ids)} }};',f'static const float soraoto_param_min[{len(ps)}]={{ {arr(mins)} }};',f'static const float soraoto_param_max[{len(ps)}]={{ {arr(maxs)} }};',f'static const float soraoto_param_default_norm[{len(ps)}]={{ {arr(defs)} }};',f'static const unsigned char soraoto_param_type[{len(ps)}]={{ {ia(types)} }};',f'static const unsigned char soraoto_param_scale[{len(ps)}]={{ {ia(scales)} }};',f'static const unsigned char soraoto_param_interpolation[{len(ps)}]={{ {ia(interpolations)} }};',f'static const float soraoto_param_scale_aux[{len(ps)}]={{ {arr(aux)} }};']
    lines += [f'#define PLUGIN_FACTORY_PRESET_COUNT {len(factory_ids)}',f'static const unsigned int soraoto_factory_preset_ids[{len(factory_ids)}]={{ {ia(factory_ids)} }};',f'static const float soraoto_factory_preset_norm[{len(factory_ids)}][{len(ps)}]={{\n{matrix}\n}};']
    lines += [f'#define PLUGIN_PROGRAM_LIST_ID 1',f'#define PLUGIN_PROGRAM_COUNT {len(program_infos)}',f'static const unsigned int soraoto_program_ids[{len(factory_ids)}]={{ {ia(factory_ids)} }};',f'static const unsigned int soraoto_program_info_offsets[{len(offsets)}]={{ {ia(offsets)} }};',f'static const unsigned char soraoto_program_info_bytes[{len(pbytes)}]={{'+','.join(str(x) for x in pbytes)+'};']
    lines += [f'static const unsigned char soraoto_descriptor_bytes[{len(b)}]={{'+','.join(str(x) for x in b)+'};',f'#define SORAOTO_DESCRIPTOR_LEN {len(b)}','#endif']
    return '\n'.join(lines)+'\n',b

def build():
    GEN.mkdir(parents=True,exist_ok=True)
    interface_src,model=parse_interface(PLUGIN/'interface.soraoto')
    presets=PRESETS
    desc=descriptor(model,presets); h,db=header(desc)
    write_if_changed(GEN/'super-synth_descriptor.h',h)
    write_if_changed(GEN/'super-synth_descriptor.cbor',db)
    write_if_changed(GEN/'super-synth_interface.soraoto',interface_src)
    write_if_changed(GRAND_PROFILE_HEADER,grand_profile_header(presets))
    print('super-synth-v9',len(model['parameters']),len(presets),'descriptor generated')

if __name__=='__main__':build()
