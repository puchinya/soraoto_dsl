(() => {
"use strict";

// soraotoDSL MIDI Export v2
const PPQ = 480;
const MAX_GARAGEBAND_TRACKS = 32;

const GM_PROGRAMS = {
  piano:0, epiano:4, "e.piano":4, bass:33, guitar:25,
  synth:80, strings:48, lead:80,
};
const GM_DRUM_NOTES = {
  kick:36,bassdrum:36,snare:38,clap:39,rim:37,
  hat:42,hihat:42,"hi-hat":42,tom:45,crash:49,ride:51,
};
const AUTOMATION_CC = {
  gain:7, volume:7, pan:10, expression:11,
  modulation:1, mod:1, sustain:64,
};

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function utf8Bytes(t){return Array.from(new TextEncoder().encode(String(t)));}
function u16be(n){return [(n>>>8)&255,n&255];}
function u32be(n){return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function strBytes(s){return Array.from(s,ch=>ch.charCodeAt(0)&255);}

function vlq(value){
  let v=Math.max(0,Math.floor(value))>>>0;
  let buffer=v&0x7f;
  const out=[];
  while((v>>=7)){buffer<<=8;buffer|=((v&0x7f)|0x80);}
  while(true){
    out.push(buffer&255);
    if(buffer&0x80)buffer>>=8;
    else break;
  }
  return out;
}

function meta(type,data){
  const bytes=Array.isArray(data)?data:utf8Bytes(data);
  return [0xff,type,...vlq(bytes.length),...bytes];
}

function chunk(id,data){return [...strBytes(id),...u32be(data.length),...data];}
function beatToTick(b){return Math.max(0,Math.round((Number(b)||0)*PPQ));}
function velocity7(v){return clamp(Math.round((Number(v)||.8)*127),1,127);}

function resolveProgram(i){
  const s=String(i||"synth").toLowerCase();
  for(const [k,p] of Object.entries(GM_PROGRAMS)) if(s.includes(k)) return p;
  return 80;
}

function resolveDrumNote(n){
  const s=String(n||"").toLowerCase().replace(/\s+/g,"");
  for(const [k,v] of Object.entries(GM_DRUM_NOTES)) if(s.includes(k)) return v;
  return 42;
}

function safeFilename(name){
  return String(name||"soraotoDSL").trim()
    .replace(/[\\/:*?"<>|]+/g,"-")
    .replace(/\s+/g,"-")
    .replace(/-+/g,"-")
    .replace(/^-|-$/g,"")||"soraotoDSL";
}

function push(events,tick,order,bytes){events.push({tick,order,bytes});}

function encodeTrack(events){
  events.sort((a,b)=>(a.tick-b.tick)||(a.order-b.order));
  const bytes=[];
  let prev=0;
  for(const e of events){
    bytes.push(...vlq(Math.max(0,e.tick-prev)),...e.bytes);
    prev=e.tick;
  }
  bytes.push(0,0xff,0x2f,0);
  return chunk("MTrk",bytes);
}

function automationToCC(target,value){
  const t=String(target).toLowerCase();
  const cc=AUTOMATION_CC[t];
  if(cc==null) return null;
  if(t==="pan"){
    return {cc,value:clamp(Math.round((Number(value)+1)*63.5),0,127)};
  }
  if(t==="sustain"){
    return {cc,value:Number(value)>=.5?127:0};
  }
  return {cc,value:clamp(Math.round(Number(value)*127),0,127)};
}

function pitchBendBytes(channel,semitones,range){
  const r=Math.max(1,Number(range)||2);
  const normalized=clamp(Number(semitones)/r,-1,1);
  const value=clamp(Math.round(8192+normalized*8191),0,16383);
  return [0xe0|channel,value&0x7f,(value>>7)&0x7f];
}

function addPitchBendRange(events,channel,range){
  const semis=clamp(Math.round(Number(range)||2),1,24);
  // RPN 0,0 = Pitch Bend Sensitivity.
  push(events,0,2,[0xb0|channel,101,0]);
  push(events,0,3,[0xb0|channel,100,0]);
  push(events,0,4,[0xb0|channel,6,semis]);
  push(events,0,5,[0xb0|channel,38,0]);
  push(events,0,6,[0xb0|channel,101,127]);
  push(events,0,7,[0xb0|channel,100,127]);
}

function tempoMeta(bpm){
  const micros=Math.round(60000000/clamp(Number(bpm)||120,20,400));
  return [0xff,0x51,0x03,(micros>>16)&255,(micros>>8)&255,micros&255];
}
function meterMeta(meter){
  const num=meter?.[0]||4, den=meter?.[1]||4;
  let pow=0,d=1;while(d<den){d*=2;pow++;}
  return [0xff,0x58,0x04,num&255,pow&255,24,8];
}
function makeTempoTrack(ir,title){
  const events=[{tick:0,order:0,bytes:meta(0x03,`${title} Tempo / Meter`)}];
  const tmap=(ir.tempoMap&&ir.tempoMap.length)?ir.tempoMap:[{kind:"step",beat:0,bpm:ir.tempo||120}];
  for(const seg of tmap){
    if(seg.kind==="step") push(events,beatToTick(seg.beat||0),1,tempoMeta(seg.bpm));
    else if(seg.kind==="ramp"){
      const samples=32;
      for(let i=0;i<=samples;i++){
        const t=i/samples,beat=seg.startBeat+(seg.endBeat-seg.startBeat)*t;
        let shaped=t;if(seg.curve==="ease_in")shaped=t*t;else if(seg.curve==="ease_out")shaped=1-(1-t)*(1-t);
        const bpm=seg.startBpm+(seg.endBpm-seg.startBpm)*shaped;
        push(events,beatToTick(beat),1,tempoMeta(bpm));
      }
    }
  }
  const mmap=(ir.meterMap&&ir.meterMap.length)?ir.meterMap:[{beat:0,meter:ir.meter||ir.timeSignature||[4,4]}];
  for(const m of mmap) push(events,beatToTick(m.beat||0),2,meterMeta(m.meter));
  return encodeTrack(events);
}
function guitarMeta(event){
  if(event.stringIndex==null || event.fret==null) return null;
  return `soraotoDSL:guitar:string=${event.stringIndex};fret=${event.fret};pitch=${event.pitches?.[0] ?? ""}`;
}

function makeMusicalTrack(track,channel){
  const events=[];
  const trackEvents=track.events||[];
  const controls=track.controls||[];

  push(events,0,0,meta(0x03,String(track.name||"Track")));

  const isDrum=trackEvents.length>0 && trackEvents.every(e=>e.type==="drum");
  const midiChannel=isDrum?9:channel;

  if(!isDrum){
    push(events,0,1,[0xc0|midiChannel,resolveProgram(track.instrument)]);
    addPitchBendRange(events,midiChannel,track.pitchBendRange||2);
    push(events,0,8,[0xb0|midiChannel,7,clamp(Math.round((track.gain??.8)*100),0,127)]);
    push(events,0,9,[0xb0|midiChannel,10,clamp(Math.round(((track.pan??0)+1)*63.5),0,127)]);
  }

  for(const c of controls){
    const tick=beatToTick(c.time);
    if(c.type==="cc"){
      push(events,tick,31,[0xb0|midiChannel,clamp(Math.round(c.cc),0,127),clamp(Math.round(c.value),0,127)]);
    } else if(c.type==="pitchBend"){
      push(events,tick,32,pitchBendBytes(midiChannel,c.semitones,c.range||track.pitchBendRange||2));
    } else if(c.type==="automation"){
      const mapped=automationToCC(c.target,c.value);
      if(mapped){
        push(events,tick,30,[0xb0|midiChannel,mapped.cc,mapped.value]);
      } else {
        push(events,tick,33,meta(0x01,`soraotoDSL:automation:${c.target}=${c.value}`));
      }
    }
  }

  for(const e of trackEvents){
    const start=beatToTick(e.time);
    const end=start+Math.max(1,beatToTick(e.duration||.125));
    const vel=velocity7(e.velocity);

    if(e.type==="drum"){
      const note=resolveDrumNote(e.drum);
      push(events,start,50,[0x99,note,vel]);
      push(events,end,40,[0x89,note,0]);
      continue;
    }

    if(e.type==="note"){
      const gm=guitarMeta(e);
      if(gm) push(events,start,34,meta(0x01,gm));
      if(e.lyric){
        const l=e.lyric;
        if(l.kind==="lyric") push(events,start,35,meta(0x05,l.surface||l.reading||""));
        else if(l.kind==="melisma") push(events,start,35,meta(0x05,"_"));
        if(l.phraseBoundaryBefore) push(events,start,36,meta(0x06,"phrase"));
      }
      for(const p of e.pitches||[]){
        const note=clamp(Math.round(p),0,127);
        push(events,start,50,[0x90|midiChannel,note,vel]);
        push(events,end,40,[0x80|midiChannel,note,0]);
      }
    }
  }

  return encodeTrack(events);
}

function buildType1(ir,options={}){
  if(!ir||!Array.isArray(ir.tracks)){
    throw new Error("No compiled soraotoDSL song is available.");
  }

  const tracks=ir.tracks.filter(t=>(t.events?.length||0)||(t.controls?.length||0));
  if(options.garageBand&&tracks.length>MAX_GARAGEBAND_TRACKS){
    throw new Error(`GarageBand import limit exceeded: ${tracks.length} tracks (max ${MAX_GARAGEBAND_TRACKS}).`);
  }

  const title=options.title||ir.title||"soraotoDSL";
  const chunks=[makeTempoTrack(ir,title)];
  const channels=[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15];
  let ci=0;

  for(const t of tracks){
    const isDrum=t.events?.length&&t.events.every(e=>e.type==="drum");
    const ch=isDrum?9:channels[ci++%channels.length];
    chunks.push(makeMusicalTrack(t,ch));
  }

  const header=chunk("MThd",[...u16be(1),...u16be(chunks.length),...u16be(PPQ)]);
  return new Uint8Array([...header,...chunks.flat()]);
}

function downloadBytes(bytes,name,mime="audio/midi"){
  const blob=new Blob([bytes],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function exportMidi(ir,options={}){
  const title=options.title||ir.title||"soraotoDSL";
  const bytes=buildType1(ir,options);
  const suffix=options.garageBand?"-garageband":"";
  const name=`${safeFilename(title)}${suffix}.mid`;
  downloadBytes(bytes,name);
  return {filename:name,byteLength:bytes.byteLength};
}

window.SoraotoMidi={
  version:2,
  PPQ,
  MAX_GARAGEBAND_TRACKS,
  buildType1,
  exportMidi,
};
})();
