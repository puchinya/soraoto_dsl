(() => {
"use strict";

const NOTE_PC = {c:0,d:2,e:4,f:5,g:7,a:9,b:11};

const CHORDS = {
  "C":[48,52,55,60,64,67],
  "G":[43,47,50,55,59,67],
  "Am":[45,52,57,60,64],
  "F":[41,48,53,57,60,65],
  "Dm":[50,53,57,62],
  "Em":[40,47,52,55,59,64],
  "E":[40,47,52,56,59,64],
  "A":[45,52,57,61,64],
  "D":[50,57,62,66],
};

const STANDARD_GUITAR_TUNING = [40,45,50,55,59,64]; // low E2 .. high E4

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function stripComments(src) {
  return String(src).replace(/\/\/.*$/gm, "").replace(/^\s*#.*$/gm, "");
}

function findBlocks(src, keyword) {
  const out = [];
  const re = new RegExp("\\b" + keyword + "\\s+([^\\s{]+)?\\s*\\{", "g");
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf("{", m.index);
    let depth = 1, i = open + 1, quote = null, esc = false;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth !== 0) throw new Error(`Unclosed ${keyword} block near offset ${m.index}`);
    out.push({
      name: (m[1] || "").trim(),
      body: src.slice(open + 1, i - 1),
      start: m.index,
      end: i,
    });
    re.lastIndex = i;
  }
  return out;
}

function getScalar(body, key, fallback = null) {
  const re = new RegExp("\\b" + key + "\\s*:\\s*([^\\n\\r}]+)");
  const m = body.match(re);
  if (!m) return fallback;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function removeBlocks(body, blocks) {
  let s = body;
  for (const b of [...blocks].sort((a,b) => b.start-a.start)) {
    s = s.slice(0,b.start) + " ".repeat(b.end-b.start) + s.slice(b.end);
  }
  return s;
}

function midiFromNote(token) {
  const m = String(token).match(/^([a-gA-G])([#b]?)(-?\d+)$/);
  if (!m) return null;
  let pc = NOTE_PC[m[1].toLowerCase()];
  if (m[2] === "#") pc++;
  if (m[2] === "b") pc--;
  return (Number(m[3]) + 1) * 12 + pc;
}

function noteNameFromMidi(midi) {
  const names = ["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"];
  const n = Math.round(midi);
  return `${names[(n % 12 + 12) % 12]}${Math.floor(n/12)-1}`;
}

function durationBeats(denom) {
  const n = Number(denom);
  return Number.isFinite(n) && n > 0 ? 4 / n : null;
}

function expandRepeats(text) {
  let s = text;
  for (let pass=0; pass<8; pass++) {
    const re = /\(([^()]*)\)\s*\*\s*(\d+)/g;
    const next = s.replace(re, (_, body, n) => Array(Number(n)).fill(body).join(" "));
    if (next === s) break;
    s = next;
  }
  return s;
}

function tokenizeSequence(text) {
  text = expandRepeats(String(text).replace(/\r/g, " ").replace(/\n/g, " "));
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]) || text[i] === ",") {
      if (text[i] === ",") tokens.push(",");
      i++;
      continue;
    }
    const bracketAt = text.indexOf("[", i);
    const nextSpace = text.slice(i).search(/[\s,]/);
    const tokenEnd = nextSpace < 0 ? text.length : i + nextSpace;
    if (text[i] === "[" || (bracketAt >= i && bracketAt < tokenEnd)) {
      let j = bracketAt + 1, depth = 1;
      while (j < text.length && depth) {
        if (text[j] === "[") depth++;
        else if (text[j] === "]") depth--;
        j++;
      }
      tokens.push(text.slice(i,j));
      i = j;
      continue;
    }
    let j = i;
    while (j < text.length && !/[\s,]/.test(text[j])) j++;
    tokens.push(text.slice(i,j));
    i = j;
  }
  return tokens.filter(Boolean);
}

function parseChord(inner, lastPitch) {
  const parts = inner.trim().split(/\s+/).filter(Boolean);
  let anchor = lastPitch;
  const pitches = [];
  for (const p of parts) {
    const abs = midiFromNote(p);
    if (abs != null) {
      anchor = abs;
      pitches.push(abs);
    } else if (/^[+-]\d+$/.test(p)) {
      if (anchor == null) throw new Error(`Relative chord tone "${p}" has no anchor`);
      pitches.push(anchor + Number(p));
    } else {
      throw new Error(`Invalid chord tone "${p}"`);
    }
  }
  return {pitches, lastPitch: pitches[0] ?? lastPitch};
}

function parseNotes(text, trackName, voiceName = "main") {
  const tokens = tokenizeSequence(text);
  let dur = 0.5, vel = 0.8, lastPitch = null, time = 0;
  const events = [], warnings = [];

  for (let raw of tokens) {
    if (!raw || raw === ",") continue;
    let m = raw.match(/^@(\d+):$/);
    if (m) { dur = durationBeats(m[1]) ?? dur; continue; }
    m = raw.match(/^!(\d*\.?\d+):$/);
    if (m) { vel = clamp(Number(m[1]),0,1); continue; }

    let tokenDur = dur, tokenVel = vel;
    m = raw.match(/^@(\d+)(.+)$/);
    if (m) { tokenDur = durationBeats(m[1]) ?? dur; raw = m[2]; }
    m = raw.match(/^!(\d*\.?\d+)(.+)$/);
    if (m) { tokenVel = clamp(Number(m[1]),0,1); raw = m[2]; }

    if (raw === "_") { time += tokenDur; continue; }
    if (raw === "~") {
      const prev = events[events.length-1];
      if (prev) prev.duration += tokenDur;
      else warnings.push(`Track ${trackName}: tie "~" ignored without previous event`);
      time += tokenDur;
      continue;
    }

    let pitches = [];
    if (raw === ".") {
      if (lastPitch == null) throw new Error(`Track ${trackName}: "." has no previous pitch`);
      pitches = [lastPitch];
    } else if (/^[+-]\d+$/.test(raw)) {
      if (lastPitch == null) throw new Error(`Track ${trackName}: relative note ${raw} has no previous pitch`);
      lastPitch += Number(raw);
      pitches = [lastPitch];
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      const parsed = parseChord(raw.slice(1,-1), lastPitch);
      pitches = parsed.pitches;
      lastPitch = parsed.lastPitch;
    } else {
      const abs = midiFromNote(raw);
      if (abs == null) {
        warnings.push(`Track ${trackName}: unsupported note token "${raw}"`);
        continue;
      }
      lastPitch = abs;
      pitches = [abs];
    }

    if (pitches.length) {
      events.push({type:"note", time, duration:tokenDur, pitches, velocity:tokenVel, track:trackName, voice:voiceName});
    }
    time += tokenDur;
  }
  return {events, length:time, warnings};
}

function parseDrums(body, trackName) {
  const events = [], warnings = [];
  let maxSteps = 0;
  const lineRe = /([A-Za-z][\w-]*)\s+"([^"]+)"/g;
  let m;
  while ((m = lineRe.exec(body))) {
    const inst = m[1], pattern = m[2].replace(/\s/g,"");
    maxSteps = Math.max(maxSteps, pattern.length);
    [...pattern].forEach((ch,i) => {
      if (ch === ".") return;
      const mapVel = {x:.72,X:1,g:.38,o:.78,c:.82,r:.65,f:.9};
      events.push({type:"drum", drum:inst, symbol:ch, time:i*0.5, duration:.12, velocity:mapVel[ch] ?? .7, track:trackName});
      if (!(ch in mapVel)) warnings.push(`Track ${trackName}: unknown drum symbol "${ch}"`);
    });
  }
  return {events, length:maxSteps*.5, warnings};
}

function chordNameToPitches(name) {
  const m = String(name).match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return CHORDS.C;
  let pc = NOTE_PC[m[1].toLowerCase()];
  if (m[2] === "#") pc++;
  if (m[2] === "b") pc--;
  const root = 48 + ((pc + 12) % 12);
  const minor = m[3].startsWith("m") && !m[3].startsWith("maj");
  const seventh = m[3].includes("7");
  const intervals = minor ? [0,7,12,15,19] : [0,7,12,16,19];
  if (seventh) intervals.push(minor ? 22 : 23);
  return intervals.map(x => root+x);
}

function parseTuning(text) {
  if (!text) return [...STANDARD_GUITAR_TUNING];
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 6) throw new Error(`Guitar tuning must contain 6 notes (low-to-high), got ${parts.length}`);
  const tuning = parts.map(midiFromNote);
  if (tuning.some(x => x == null)) throw new Error(`Invalid guitar tuning "${text}"`);
  return tuning;
}

function positionToPitch(stringIndex, fret, tuning) {
  const s = Number(stringIndex), f = Number(fret);
  if (!Number.isInteger(s) || s < 1 || s > 6) throw new Error(`Guitar string must be 1..6, got ${stringIndex}`);
  if (!Number.isInteger(f) || f < 0 || f > 36) throw new Error(`Guitar fret must be 0..36, got ${fret}`);
  return tuning[6-s] + f;
}

function parseGuitarPosition(token, tuning) {
  const m = String(token).match(/^s([1-6]):(\d{1,2})$/i);
  if (!m) return null;
  const stringIndex = Number(m[1]), fret = Number(m[2]);
  return {stringIndex, fret, pitch:positionToPitch(stringIndex,fret,tuning)};
}

function parseGuitarTab(text, trackName, tuning) {
  const tokens = tokenizeSequence(text);
  let dur=.5, vel=.78, time=0, lastPositions=null;
  const events=[], warnings=[];

  for (let raw of tokens) {
    if (!raw || raw === ",") continue;
    let m = raw.match(/^@(\d+):$/);
    if (m) { dur=durationBeats(m[1]) ?? dur; continue; }
    m = raw.match(/^!(\d*\.?\d+):$/);
    if (m) { vel=clamp(Number(m[1]),0,1); continue; }

    let tokenDur=dur, tokenVel=vel;
    m = raw.match(/^@(\d+)(.+)$/);
    if (m) { tokenDur=durationBeats(m[1]) ?? dur; raw=m[2]; }
    m = raw.match(/^!(\d*\.?\d+)(.+)$/);
    if (m) { tokenVel=clamp(Number(m[1]),0,1); raw=m[2]; }

    if (raw === "_") { time += tokenDur; continue; }
    if (raw === "~") {
      const affected = [];
      for (let i=events.length-1; i>=0; i--) {
        if (Math.abs(events[i].time - (time-tokenDur)) < 1e-9) affected.push(events[i]);
        else if (affected.length) break;
      }
      if (affected.length) affected.forEach(e => e.duration += tokenDur);
      else warnings.push(`Track ${trackName}: guitar tie "~" ignored`);
      time += tokenDur; continue;
    }

    let positions=[];
    if (raw === ".") {
      if (!lastPositions) throw new Error(`Track ${trackName}: guitar "." has no previous position`);
      positions=lastPositions.map(x=>({...x}));
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      positions=raw.slice(1,-1).trim().split(/\s+/).filter(Boolean).map(t=>{
        const pos=parseGuitarPosition(t,tuning);
        if (!pos) throw new Error(`Track ${trackName}: invalid guitar position "${t}"`);
        return pos;
      });
    } else {
      const pos=parseGuitarPosition(raw,tuning);
      if (!pos) {
        warnings.push(`Track ${trackName}: unsupported guitar tab token "${raw}"`);
        continue;
      }
      positions=[pos];
    }

    lastPositions=positions;
    positions.forEach((pos,i)=>{
      events.push({
        type:"note", time:time+i*0.012, duration:Math.max(.08, tokenDur-i*.005),
        pitches:[pos.pitch], velocity:tokenVel, track:trackName, voice:"guitar-tab",
        stringIndex:pos.stringIndex, fret:pos.fret, noteName:noteNameFromMidi(pos.pitch),
        articulation:positions.length>1?"tab-chord":"picked"
      });
    });
    time += tokenDur;
  }
  return {events,length:time,warnings};
}

function parseGuitar(body, trackName) {
  const tuning = parseTuning(getScalar(body,"tuning","E2 A2 D3 G3 B3 E4"));
  const tabBlocks = findBlocks(body,"tab");
  const events=[], warnings=[];
  let length=0;

  for (const tb of tabBlocks) {
    const r=parseGuitarTab(tb.body,trackName,tuning);
    events.push(...r.events); length=Math.max(length,r.length); warnings.push(...r.warnings);
  }

  const cleanBody = removeBlocks(body,tabBlocks);
  const rhythm = getScalar(cleanBody,"rhythm",null);
  if (rhythm) {
    const bodyWithoutScalars = cleanBody
      .replace(/\brhythm\s*:\s*"[^"]*"/g," ")
      .replace(/\btuning\s*:\s*"[^"]*"/g," ");
    const chordTokens = bodyWithoutScalars.match(/\b(?:[A-G](?:#|b)?(?:m|maj7|m7|7|sus2|sus4)?)\b/g) || [];
    let time=0;
    for (const chord of chordTokens.length ? chordTokens : ["C"]) {
      const pitches=CHORDS[chord] || chordNameToPitches(chord);
      for (let i=0;i<rhythm.length;i++) {
        const ch=rhythm[i];
        if (ch === ".") {time+=.5; continue;}
        if (ch === "D" || ch === "U") {
          const ordered=ch==="D"?pitches:[...pitches].reverse();
          ordered.forEach((pitch,si)=>{
            events.push({
              type:"note", time:time+si*.018, duration:Math.max(.12,.425-si*.01),
              pitches:[pitch], velocity:i===0?.85:.68, track:trackName, voice:"guitar",
              articulation:"strum-"+ch
            });
          });
        } else warnings.push(`Track ${trackName}: unsupported guitar rhythm symbol "${ch}"`);
        time+=.5;
      }
    }
    length=Math.max(length,time);
  }

  return {events,length,warnings,tuning};
}

function parseCurve(text, target, diagnostics, trackName) {
  const points=[];
  const tokens=String(text).trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const m=token.match(/^(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      diagnostics.push({kind:"warning",message:`Track ${trackName}: invalid ${target} point "${token}"`});
      continue;
    }
    points.push({time:Number(m[1]),value:Number(m[2])});
  }
  points.sort((a,b)=>a.time-b.time);
  return points;
}

function parseNamedCurves(body, trackName, diagnostics) {
  const out=[];
  const re=/([A-Za-z_][\w.-]*)\s*:?\s*"([^"]*)"/g;
  let m;
  while ((m=re.exec(body))) {
    const target=m[1];
    const points=parseCurve(m[2],target,diagnostics,trackName);
    for (const p of points) out.push({type:"automation",target,time:p.time,value:p.value});
  }
  return out;
}

function parseCCBlock(body, trackName, diagnostics) {
  const out=[];
  const re=/(?:cc)?(\d{1,3})\s*:?\s*"([^"]*)"/gi;
  let m;
  while ((m=re.exec(body))) {
    const cc=Number(m[1]);
    if (cc<0 || cc>127) {
      diagnostics.push({kind:"warning",message:`Track ${trackName}: CC ${cc} is outside 0..127`});
      continue;
    }
    const points=parseCurve(m[2],`CC${cc}`,diagnostics,trackName);
    for (const p of points) out.push({type:"cc",cc,time:p.time,value:clamp(Math.round(p.value),0,127)});
  }
  return out;
}

function parsePitchBendBlock(body, trackName, diagnostics, fallbackRange) {
  const range=clamp(Number(getScalar(body,"range",fallbackRange ?? 2))||2,1,24);
  const curveMatch=body.match(/\bcurve\s*:?\s*"([^"]*)"/);
  const points=curveMatch?parseCurve(curveMatch[1],"pitch_bend",diagnostics,trackName):[];
  return {
    range,
    events:points.map(p=>({type:"pitchBend",time:p.time,semitones:clamp(p.value,-range,range),range}))
  };
}

function compile(src) {
  const diagnostics=[];
  const source=stripComments(src);
  const title=(source.match(/\btitle\s*:\s*["']([^"']+)["']/)||[])[1] || "soraotoDSL";
  let tempo=Number((source.match(/\btempo\s*:\s*(\d+(?:\.\d+)?)/)||[])[1] || 120);
  if (!Number.isFinite(tempo) || tempo<20 || tempo>320) {
    diagnostics.push({kind:"error",message:`tempo must be 20..320 (got ${tempo})`});
    tempo=120;
  }

  let trackBlocks;
  try {trackBlocks=findBlocks(source,"track");}
  catch(e){return {title,tempo,tracks:[],events:[],diagnostics:[{kind:"error",message:e.message}],length:0};}
  if (!trackBlocks.length) diagnostics.push({kind:"error",message:"No track blocks found"});

  const tracks=[], allEvents=[];
  let maxLen=0;

  for (const tb of trackBlocks) {
    const name=tb.name || `Track${tracks.length+1}`;
    const instrument=String(getScalar(tb.body,"instrument","synth")).toLowerCase();
    const gain=clamp(Number(getScalar(tb.body,"gain","0.8"))||.8,0,2);
    const pan=clamp(Number(getScalar(tb.body,"pan","0"))||0,-1,1);
    const tevents=[], controls=[];
    let tlen=0, tuning=null;
    let pitchBendRange=clamp(Number(getScalar(tb.body,"pitch_bend_range","2"))||2,1,24);

    try {
      for (const nb of findBlocks(tb.body,"notes")) {
        const voices=findBlocks(nb.body,"voice");
        if (voices.length) {
          for (const vb of voices) {
            const r=parseNotes(vb.body,name,vb.name||"voice");
            tevents.push(...r.events); tlen=Math.max(tlen,r.length);
            r.warnings.forEach(message=>diagnostics.push({kind:"warning",message}));
          }
          const remainder=removeBlocks(nb.body,voices);
          const r=parseNotes(remainder,name,"main");
          tevents.push(...r.events); tlen=Math.max(tlen,r.length);
          r.warnings.forEach(message=>diagnostics.push({kind:"warning",message}));
        } else {
          const r=parseNotes(nb.body,name,"main");
          tevents.push(...r.events); tlen=Math.max(tlen,r.length);
          r.warnings.forEach(message=>diagnostics.push({kind:"warning",message}));
        }
      }

      for (const db of findBlocks(tb.body,"drums")) {
        const r=parseDrums(db.body,name);
        tevents.push(...r.events); tlen=Math.max(tlen,r.length);
        r.warnings.forEach(message=>diagnostics.push({kind:"warning",message}));
      }

      for (const gb of findBlocks(tb.body,"guitar")) {
        const r=parseGuitar(gb.body,name);
        tevents.push(...r.events); tlen=Math.max(tlen,r.length);
        tuning=r.tuning;
        r.warnings.forEach(message=>diagnostics.push({kind:"warning",message}));
      }

      for (const ab of findBlocks(tb.body,"automation")) {
        controls.push(...parseNamedCurves(ab.body,name,diagnostics));
      }

      for (const cb of findBlocks(tb.body,"cc")) {
        controls.push(...parseCCBlock(cb.body,name,diagnostics));
      }

      for (const pb of findBlocks(tb.body,"pitch_bend")) {
        const r=parsePitchBendBlock(pb.body,name,diagnostics,pitchBendRange);
        pitchBendRange=r.range;
        controls.push(...r.events);
      }
    } catch(e) {
      diagnostics.push({kind:"error",message:e.message});
    }

    controls.sort((a,b)=>a.time-b.time);
    if (controls.length) tlen=Math.max(tlen,...controls.map(e=>e.time));
    const track={name,instrument,gain,pan,pitchBendRange,tuning,events:tevents,controls,length:tlen};
    tracks.push(track);
    allEvents.push(...tevents);
    maxLen=Math.max(maxLen,tlen);
  }

  allEvents.sort((a,b)=>a.time-b.time);
  return {title,tempo,timeSignature:[4,4],tracks,events:allEvents,diagnostics,length:maxLen};
}

window.SoraotoCompiler = {
  compile,
  helpers: {
    midiFromNote,
    noteNameFromMidi,
    durationBeats,
    positionToPitch,
    STANDARD_GUITAR_TUNING:[...STANDARD_GUITAR_TUNING],
  }
};
})();

/* soraotoDSL Harmony Timeline extension — current spec subset */
(() => {
"use strict";
if (!window.SoraotoCompiler || window.SoraotoCompiler._core) return;

const baseCompile = window.SoraotoCompiler.compile;
const midiFromNote = window.SoraotoCompiler.helpers.midiFromNote;
const NOTE_PC = {c:0,d:2,e:4,f:5,g:7,a:9,b:11};
const MAJOR=[0,2,4,5,7,9,11], MINOR=[0,2,3,5,7,8,10];
const GUITAR_TUNING=[40,45,50,55,59,64]; // string 6..1

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function findBlocks(src, keyword){
  const out=[], re=new RegExp("\\b"+keyword+"\\s+([^\\s{]+)?\\s*\\{","g");
  let m;
  while((m=re.exec(src))){
    const open=src.indexOf("{",m.index); let depth=1,i=open+1,quote=null,esc=false;
    for(;i<src.length&&depth>0;i++){
      const ch=src[i];
      if(quote){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch===quote)quote=null;continue;}
      if(ch==='"'||ch==="'"){quote=ch;continue;}
      if(ch==="{")depth++; else if(ch==="}")depth--;
    }
    if(depth!==0)throw new Error(`Unclosed ${keyword} block`);
    out.push({name:(m[1]||"").trim(),body:src.slice(open+1,i-1),start:m.index,end:i});
    re.lastIndex=i;
  }
  return out;
}
function meterOf(src){const m=src.match(/\bmeter\s*:\s*(\d+)\s*\/\s*(\d+)/);return m?[+m[1],+m[2]]:[4,4];}
function keyOf(src){
  const m=src.match(/\bkey\s*:\s*([A-Ga-g])([#b]?)\.(major|minor)/); if(!m)return null;
  let pc=NOTE_PC[m[1].toLowerCase()]; if(m[2]==="#")pc++;if(m[2]==="b")pc--;
  return {rootPc:(pc+12)%12,mode:m[3],name:`${m[1].toUpperCase()}${m[2]}.${m[3]}`};
}
function dur(tok){const m=String(tok).match(/^@(\d+)(d?)(t?)$/);if(!m)return null;let b=4/+m[1];if(m[2])b*=1.5;if(m[3])b*=2/3;return b;}
function tokenize(s){
  s=String(s).replace(/\/\/.*$/gm,"").replace(/\r?\n/g," ");const out=[];let i=0;
  while(i<s.length){if(/\s/.test(s[i])){i++;continue;}if(s[i]===","){out.push(",");i++;continue;}
    let j=i;while(j<s.length&&!/[\s,]/.test(s[j]))j++;out.push(s.slice(i,j));i=j;}
  return out;
}
function qualityIntervals(q){
  q=String(q||"");
  if(/^m7b5/.test(q))return[0,3,6,10];if(/^maj7/.test(q))return[0,4,7,11];if(/^m7/.test(q))return[0,3,7,10];
  if(/^m(?!aj)/.test(q))return[0,3,7];if(/^dim7/.test(q))return[0,3,6,9];if(/^dim/.test(q))return[0,3,6];
  if(/^aug/.test(q))return[0,4,8];if(/^sus2/.test(q))return[0,2,7];if(/^sus4/.test(q))return[0,5,7];
  if(/^7#9/.test(q))return[0,4,7,10,15];if(/^7/.test(q))return[0,4,7,10];if(/^add9/.test(q))return[0,4,7,14];
  return[0,4,7];
}
function absoluteChord(s){
  const m=String(s).match(/^([A-Ga-g])([#b]?)([^\/]*)((?:\/)([A-Ga-g])([#b]?))?$/);if(!m)return null;
  let root=NOTE_PC[m[1].toLowerCase()];if(m[2]==="#")root++;if(m[2]==="b")root--;root=(root+12)%12;
  let bass=root;if(m[5]){bass=NOTE_PC[m[5].toLowerCase()];if(m[6]==="#")bass++;if(m[6]==="b")bass--;bass=(bass+12)%12;}
  const q=m[3]||"";return{symbol:String(s),rootPc:root,bassPc:bass,quality:q,intervals:qualityIntervals(q),sourceMode:"absolute"};
}
function romanDeg(s){return({I:0,II:1,III:2,IV:3,V:4,VI:5,VII:6})[String(s).toUpperCase()];}
function romanChord(s,key){
  if(!key)return null;const m=String(s).match(/^([b#]?)([ivIV]+)(maj7|m7|7)?(?:\/([ivIV]+))?$/);if(!m)return null;
  const scale=key.mode==="minor"?MINOR:MAJOR;let root;
  if(m[4]){const d=romanDeg(m[4]);if(d==null)return null;root=(key.rootPc+scale[d]+7)%12;}
  else{const d=romanDeg(m[2]);if(d==null)return null;root=(key.rootPc+scale[d])%12;if(m[1]==="b")root=(root+11)%12;if(m[1]==="#")root=(root+1)%12;}
  let q=m[3]||"";if(!q&&m[2]===m[2].toLowerCase())q="m";
  return{symbol:String(s),rootPc:root,bassPc:root,quality:q,intervals:qualityIntervals(q),sourceMode:"roman"};
}
function nashChord(s,key){
  if(!key)return null;const m=String(s).match(/^([b#]?)([1-7])(maj7|m7|m|7)?$/);if(!m)return null;
  const scale=key.mode==="minor"?MINOR:MAJOR;let root=(key.rootPc+scale[+m[2]-1])%12;if(m[1]==="b")root=(root+11)%12;if(m[1]==="#")root=(root+1)%12;
  const q=m[3]||"";return{symbol:String(s),rootPc:root,bassPc:root,quality:q,intervals:qualityIntervals(q),sourceMode:"nashville"};
}
function chordOf(s,key){return absoluteChord(s)||romanChord(s,key)||nashChord(s,key);}
function parseHarmony(block,key,meter,diagnostics){
  const bar=meter[0]*(4/meter[1]);let d=bar,time=0,barStart=0;const events=[];
  for(let raw of tokenize(block.body)){
    if(raw===","){if(time-barStart>bar+1e-6)diagnostics.push({kind:"error",message:`Harmony ${block.name}: bar exceeds meter`});time=barStart+bar;barStart=time;continue;}
    let m=raw.match(/^(@\d+(?:d|t)?):$/);if(m){d=dur(m[1])||d;continue;}
    let one=null;m=raw.match(/^(@\d+(?:d|t)?)(.+)$/);if(m){one=dur(m[1]);raw=m[2];}
    const c=chordOf(raw,key);if(!c){diagnostics.push({kind:"warning",message:`Harmony ${block.name}: unsupported chord ${raw}`});continue;}
    const cd=one||d;events.push({...c,type:"chord",time,duration:cd,index:events.length,harmony:block.name});time+=cd;
  }
  return{name:block.name||"Harmony",type:"harmony",events,length:time,key};
}
function argsOf(s){
  const out={};if(!s)return out;let buf="",depth=0,parts=[];
  for(const ch of s){if(ch==="[")depth++;else if(ch==="]")depth--;if(ch===","&&depth===0){parts.push(buf);buf="";}else buf+=ch;}if(buf.trim())parts.push(buf);
  for(const p of parts){const i=p.indexOf(":");if(i<0)continue;out[p.slice(0,i).trim()]=p.slice(i+1).trim().replace(/^['"]|['"]$/g,"");}return out;
}
function pipelineOf(body){
  const m=body.match(/\b([A-Za-z_]\w*)\s*((?:\|>\s*[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*)+)/s);if(!m)return null;
  const steps=[];const re=/\|>\s*([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/g;let x;while((x=re.exec(m[2])))steps.push({name:x[1],args:argsOf(x[2]||"")});
  return{source:m[1],steps};
}
function pcNear(pc,center){let n=Math.round(center);while(((n%12)+12)%12!==pc)n++;const c=[n-24,n-12,n,n+12,n+24];return c.reduce((a,b)=>Math.abs(b-center)<Math.abs(a-center)?b:a,c[0]);}
function pcOct(pc,oct){return(+oct+1)*12+pc;}
function tonePc(c,i){return(c.rootPc+c.intervals[(i-1)%c.intervals.length])%12;}
function degreePc(c,n){const target={3:4,5:7,7:10,9:14}[n];if(target==null)return c.rootPc;let best=c.intervals[0],dist=99;for(const iv of c.intervals){const d=Math.abs(iv-target);if(d<dist){dist=d;best=iv;}}if(dist>2)return null;return(c.rootPc+best)%12;}
function genBass(h,t,a){const oct=+(a.octave||2),mode=a.mode||"chord_bass";return h.events.map((c,i)=>({type:"note",time:c.time,duration:c.duration,pitches:[pcOct(mode==="root"?c.rootPc:c.bassPc,oct)],velocity:.76,track:t,voice:"generated",generatedBy:`${h.name}|>BassRoot`,harmonyIndex:i}));}
function genWalk(h,t,a){const oct=+(a.octave||2),out=[];h.events.forEach((c,i)=>{const next=h.events[i+1]||c,step=c.duration/4,root=pcOct(c.bassPc,oct),third=pcNear(degreePc(c,3),root+3),fifth=pcNear(degreePc(c,5),root+7),target=pcNear(next.bassPc,root),approach=a.approach==="chromatic"?target+(target>=root?-1:1):target;[root,third,fifth,approach].forEach((p,j)=>out.push({type:"note",time:c.time+j*step,duration:step*.86,pitches:[p],velocity:j? .66:.82,track:t,voice:"generated",generatedBy:`${h.name}|>WalkingBass`,harmonyIndex:i}));});return out;}
function rangeOf(s,def){const m=String(s||"").match(/^([a-gA-G][#b]?\d+)\.\.([a-gA-G][#b]?\d+)$/);return m?[midiFromNote(m[1]),midiFromNote(m[2])]:def;}
function voicing(c,range,prev,voices){
  const center=(range[0]+range[1])/2, pcs=c.intervals.map(iv=>(c.rootPc+iv)%12);let base=pcs.slice(0,voices).map(pc=>pcNear(pc,center)).sort((a,b)=>a-b);
  while(base.length<Math.min(voices,4))base.push(base[base.length-1]+12);
  const candidates=[];for(let inv=0;inv<base.length;inv++){let v=[...base];for(let i=0;i<inv;i++)v[i]+=12;v.sort((a,b)=>a-b);for(const sh of[-12,0,12]){const w=v.map(x=>x+sh);if(w.every(x=>x>=range[0]&&x<=range[1]))candidates.push(w);}}
  if(!candidates.length)candidates.push(base.map(x=>clamp(x,range[0],range[1])));
  const score=v=>prev?v.reduce((s,x,i)=>s+Math.abs(x-(prev[i]??x)),0):Math.abs(v.reduce((a,b)=>a+b,0)/v.length-center);
  return candidates.reduce((a,b)=>score(b)<score(a)?b:a,candidates[0]);
}
function genVoicing(h,t,a,pad){const range=rangeOf(a.range,pad?[60,84]:[48,72]),voices=+(a.voices||4),out=[];let prev=null;h.events.forEach((c,i)=>{const p=voicing(c,range,prev,voices);prev=p;out.push({type:"note",time:c.time,duration:c.duration*.94,pitches:p,velocity:pad?.46:.66,track:t,voice:"generated",generatedBy:`${h.name}|>${pad?"PadVoicing":"PianoVoicing"}`,harmonyIndex:i});});return out;}
function patNums(s){const m=String(s||"").match(/^\[(.*)\]$/);return m?m[1].split(",").map(x=>+x.trim()).filter(Number.isFinite):[1,3,5,3];}
function genArp(h,t,a){const p=patNums(a.pattern),d=dur(a.duration||"@8")||.5,range=rangeOf(a.range,[60,84]),out=[];h.events.forEach((c,i)=>{let x=0,j=0;while(x<c.duration-1e-9){const pitch=pcNear(tonePc(c,p[j%p.length]),(range[0]+range[1])/2);out.push({type:"note",time:c.time+x,duration:Math.min(d*.78,c.duration-x),pitches:[pitch],velocity:j%4===0?.72:.54,track:t,voice:"generated",generatedBy:`${h.name}|>Arpeggio`,harmonyIndex:i});x+=d;j++;}});return out;}
function guitarShape(c,style){
  const pcs=new Set(c.intervals.map(iv=>(c.rootPc+iv)%12)),out=[];let minF=99,maxF=0;
  for(let si=0;si<6;si++){const open=GUITAR_TUNING[si],stringIndex=6-si;let opts=[];for(let f=0;f<=9;f++)if(pcs.has((open+f)%12))opts.push(f);if(!opts.length)continue;let fret=style==="open"?opts[0]:opts.reduce((a,b)=>Math.abs(b-3)<Math.abs(a-3)?b:a,opts[0]);out.push({stringIndex,fret,pitch:open+fret});minF=Math.min(minF,fret);maxF=Math.max(maxF,fret);}
  return out.length>=4&&maxF-minF<=7?out:out.slice(-4);
}
const STRUM={pop8:"D.DU.UD.",four:"D...D...",driving:"DUD.DU.D",sync:"D..U.DU."};
function genGuitar(h,t,va,sa){const rhythm=STRUM[sa.style||"pop8"]||"D.DU.UD.",out=[];h.events.forEach((c,i)=>{const pos=guitarShape(c,va.style||"nearest"),step=c.duration/rhythm.length;for(let r=0;r<rhythm.length;r++){const sym=rhythm[r];if(sym===".")continue;const ordered=sym==="U"?[...pos].reverse():pos;ordered.forEach((p,k)=>out.push({type:"note",time:c.time+r*step+k*(sym==="U"?.014:.018),duration:step*.8,pitches:[p.pitch],velocity:r===0?.82:.62,track:t,voice:"generated-guitar",stringIndex:p.stringIndex,fret:p.fret,articulation:`strum-${sym}`,generatedBy:`${h.name}|>GuitarVoicing|>GuitarStrum`,harmonyIndex:i}));}});return out;}
function followEvents(block,h,t,diagnostics){
  const toks=tokenize(block.body),out=[];let d=1;
  h.events.forEach((c,idx)=>{let local=0,last=null;for(let raw of toks){if(raw===",")break;let m=raw.match(/^(@\d+(?:d|t)?):$/);if(m){d=dur(m[1])||d;continue;}if(local>=c.duration)break;if(raw==="_"){local+=d;continue;}let pitch;if(raw==="."){pitch=last;}else{let pc;if(raw==="root")pc=c.rootPc;else if(raw==="bass")pc=c.bassPc;else if(raw==="third")pc=degreePc(c,3);else if(raw==="fifth")pc=degreePc(c,5);else if(raw==="seventh")pc=degreePc(c,7);else if(raw==="ninth")pc=degreePc(c,9);else if(raw==="octave")pc=c.rootPc;else{const tm=raw.match(/^tone\((\d+)\)$/);if(tm)pc=tonePc(c,+tm[1]);}
      if(pc!=null){pitch=pcNear(pc,t.toLowerCase().includes("bass")?43:60)+(raw==="octave"?12:0);}else{const abs=midiFromNote(raw);if(abs!=null)pitch=abs;}}
    if(pitch==null){
      if(["third","fifth","seventh","ninth"].includes(raw)) diagnostics.push({kind:"error",message:`Track ${t}: chord degree ${raw} unavailable in ${c.symbol}`});
      else diagnostics.push({kind:"warning",message:`Track ${t}: unsupported follow token ${raw}`});
      local+=d;continue;
    }
    last=pitch;out.push({type:"note",time:c.time+local,duration:Math.min(d,c.duration-local),pitches:[pitch],velocity:.72,track:t,voice:"follow",generatedBy:`follow ${h.name}`,harmonyIndex:idx});local+=d;}});return out;
}
function compilePipeline(p,h,t,diagnostics){const names=p.steps.map(x=>x.name);let e=[];if(names[0]==="BassRoot")e=genBass(h,t,p.steps[0].args);else if(names[0]==="WalkingBass")e=genWalk(h,t,p.steps[0].args);else if(names[0]==="PianoVoicing")e=genVoicing(h,t,p.steps[0].args,false);else if(names[0]==="PadVoicing"||names[0]==="StringsVoicing")e=genVoicing(h,t,p.steps[0].args,true);else if(names[0]==="Arpeggio")e=genArp(h,t,p.steps[0].args);else if(names[0]==="GuitarVoicing"&&names[1]==="GuitarStrum")e=genGuitar(h,t,p.steps[0].args,p.steps[1].args);else diagnostics.push({kind:"warning",message:`Track ${t}: unsupported harmony pipeline ${names.join(" |> ")}`});return{events:e,pipeline:names};}

window.SoraotoCompiler.compile = function(source){
  const ir=baseCompile(source), diagnostics=[...ir.diagnostics], meter=meterOf(source), key=keyOf(source), harmonies=new Map(), dependencies=[];
  try{for(const b of findBlocks(source,"chords")){const h=parseHarmony(b,key,meter,diagnostics);harmonies.set(h.name,h);}}catch(e){diagnostics.push({kind:"error",message:e.message});}
  let tblocks=[];try{tblocks=findBlocks(source,"track");}catch(e){diagnostics.push({kind:"error",message:e.message});}
  for(const tb of tblocks){const track=ir.tracks.find(x=>x.name===tb.name);if(!track)continue;
    try{
      for(const f of findBlocks(tb.body,"follow")){const h=harmonies.get(f.name);if(!h){diagnostics.push({kind:"error",message:`Track ${tb.name}: unknown harmony ${f.name}`});continue;}const e=followEvents(f,h,tb.name,diagnostics);track.events.push(...e);track.length=Math.max(track.length,h.length);track.dependency=h.name;dependencies.push({source:h.name,target:tb.name,kind:"follow"});}
      const p=pipelineOf(tb.body);if(p){const h=harmonies.get(p.source);if(!h){diagnostics.push({kind:"error",message:`Track ${tb.name}: unknown harmony ${p.source}`});}else{const r=compilePipeline(p,h,tb.name,diagnostics);track.events.push(...r.events);track.length=Math.max(track.length,h.length);track.dependency=h.name;track.pipeline=r.pipeline;dependencies.push({source:h.name,target:tb.name,kind:"pipeline",pipeline:r.pipeline});}}
    }catch(e){diagnostics.push({kind:"error",message:`Track ${tb.name}: ${e.message}`});}
  }
  const events=ir.tracks.flatMap(t=>t.events).sort((a,b)=>a.time-b.time);const hlist=[...harmonies.values()];const length=Math.max(ir.length,...hlist.map(h=>h.length),...ir.tracks.map(t=>t.length));
  return {...ir,version:3,timeSignature:meter,meter,key,harmonies:hlist,dependencies,events,diagnostics,length,compilationStages:["Parser","AST","Name/Type Resolution","Harmony Resolution","Expansion","Instrument Performance Compilation","Performance IR"]};
};
window.SoraotoCompiler.helpers.parseChordSymbol=chordOf;

// Internal compiler helpers used by the Draft v0.5 front-end.
// These are implementation details, not public soraotoDSL APIs.
window.SoraotoCompiler._core={
  findBlocks,
  keyOf,
  parseHarmony,
  pipelineOf,
  followEvents,
  compilePipeline
};
})();

/* soraotoDSL Draft v0.5 compiler — canonical syntax only. */
(() => {
"use strict";
if (!window.SoraotoCompiler || !window.SoraotoCompiler._core) throw new Error("soraotoDSL compiler core failed to initialize");
const coreCompile = window.SoraotoCompiler.compile;
const H = window.SoraotoCompiler._core;
const midiFromNote = window.SoraotoCompiler.helpers.midiFromNote;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function stripComments(s){return String(s).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"");}
function dbToGain(v){const m=String(v??"").match(/^(-?\d+(?:\.\d+)?)db$/i);return m?Math.pow(10,+m[1]/20):Number(v);}
function timeToSeconds(v){const s=String(v??"").trim();let m=s.match(/^(-?\d+(?:\.\d+)?)(ms|s)$/i);if(!m)return null;return +m[1]*(m[2].toLowerCase()==="ms"?.001:1);}
function hzValue(v){const s=String(v??"").trim();let m=s.match(/^(-?\d+(?:\.\d+)?)(khz|hz)$/i);if(!m)return null;return +m[1]*(m[2].toLowerCase()==="khz"?1000:1);}
function unitValue(v){const s=String(v??"").trim();if(/^[-+]?\d+(?:\.\d+)?db$/i.test(s))return {type:"Db",value:dbToGain(s),raw:s};if(/^[-+]?\d+(?:\.\d+)?(?:ms|s)$/i.test(s))return {type:"Time",value:timeToSeconds(s),raw:s};if(/^[-+]?\d+(?:\.\d+)?(?:khz|hz)$/i.test(s))return {type:"Hz",value:hzValue(s),raw:s};if(/^[-+]?\d+(?:\.\d+)?bpm$/i.test(s))return {type:"Bpm",value:parseFloat(s),raw:s};if(/^[-+]?\d+(?:\.\d+)?bit$/i.test(s))return {type:"BitDepth",value:parseInt(s),raw:s};if(/^[-+]?\d+(?:\.\d+)?bar$/i.test(s))return {type:"Bar",value:parseFloat(s),raw:s};if(/^[-+]?\d+(?:\.\d+)?$/.test(s))return {type:"Float",value:+s,raw:s};if(s==="true"||s==="false")return {type:"Bool",value:s==="true",raw:s};return {type:"String",value:s.replace(/^['"]|['"]$/g,""),raw:s};}
function scalar(body,key,fallback=null){const re=new RegExp("\\b"+key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*:\\s*([^\\n\\r}]+)");const m=body.match(re);return m?m[1].trim():fallback;}
function propsOf(body){const out={};const re=/^\s*([A-Za-z_][\w.-]*)\s*:\s*([^\n\r{}]+)\s*$/gm;let m;while((m=re.exec(body)))out[m[1]]=unitValue(m[2]);return out;}
function findKeywordBlocks(src,keyword){return H.findBlocks(src,keyword);}
function findNamedBlocks(src){const out=[];const re=/\b([A-Za-z_][\w.]*)\s*\{/g;let m;while((m=re.exec(src))){const name=m[1];const open=src.indexOf("{",m.index);let d=1,i=open+1,q=null,esc=false;for(;i<src.length&&d;i++){const ch=src[i];if(q){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch===q)q=null;continue;}if(ch==='"'||ch==="'"){q=ch;continue;}if(ch==="{")d++;else if(ch==="}")d--;}if(!d)out.push({name,body:src.slice(open+1,i-1),start:m.index,end:i});re.lastIndex=i;}return out;}
function topLevelNamedBlocks(src){return findNamedBlocks(src);}
function blockByName(src,name){return findNamedBlocks(src).find(b=>b.name===name)||null;}
function removeRanges(src,ranges){let s=src;for(const r of [...ranges].sort((a,b)=>b.start-a.start))s=s.slice(0,r.start)+" ".repeat(r.end-r.start)+s.slice(r.end);return s;}
function parseArgList(text){const vals=[];let b="",d=0,q=null;for(let i=0;i<String(text).length;i++){const ch=text[i];if(q){b+=ch;if(ch===q&&text[i-1]!=="\\")q=null;continue;}if(ch==='"'||ch==="'"){q=ch;b+=ch;continue;}if(ch==="["||ch==="(")d++;if(ch==="]"||ch===")")d--;if(ch===","&&d===0){vals.push(b.trim());b="";}else b+=ch;}if(b.trim())vals.push(b.trim());return vals;}

function parseImports(src){const out=[];let m;const re=/\bimport\s+(?:(component|plugin)\s+([A-Za-z_]\w*)\s+from\s+)?["']([^"']+)["']/g;while((m=re.exec(src)))out.push({kind:m[1]||"module",name:m[2]||null,path:m[3]});return out;}
function parseAssets(src){const b=findKeywordBlocks(src,"assets")[0];const out={};if(!b)return out;let m;const re=/([A-Za-z_]\w*)\s*=\s*["']([^"']+)["']/g;while((m=re.exec(b.body)))out[m[1]]=m[2];return out;}
function parseTypeDecls(src){const structs=[],enums=[];let m;const sr=/\bstruct\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;while((m=sr.exec(src)))structs.push({name:m[1],body:m[2].trim()});const er=/\benum\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;while((m=er.exec(src)))enums.push({name:m[1],values:m[2].split(/\s+/).filter(Boolean)});return {structs,enums};}

function barBeats(meter){return meter[0]*(4/meter[1]);}
function parseStructure(src,meter){const sb=findKeywordBlocks(src,"structure")[0];const sections=[];if(!sb)return sections;let cursor=0;const re=/([A-Za-z_][\w.]*)\s*\{\s*bars\s*:\s*(\d+(?:\.\d+)?)\s*\}/g;let m;while((m=re.exec(sb.body))){const bars=+m[2],beats=bars*barBeats(meter);sections.push({name:m[1],bars,startBeat:cursor,endBeat:cursor+beats,startBar:cursor/barBeats(meter)+1,endBar:(cursor+beats)/barBeats(meter)+1});cursor+=beats;}return sections;}
function sectionMap(sections){return new Map(sections.map(s=>[s.name,s]));}
function resolvePosition(raw,sections,meter){if(raw==null)return 0;let s=String(raw).trim();const bm=s.match(/^(\d+(?:\.\d+)?)bar$/);if(bm)return (+bm[1]-1)*barBeats(meter);const sm=s.match(/^([A-Za-z_][\w.]*)(?:\.(start|end))?(?:\s*\+\s*(\d+(?:\.\d+)?)bar)?$/);if(sm){const sec=sections.get(sm[1]);if(!sec)return null;let v=sm[2]==="end"?sec.endBeat:sec.startBeat;if(sm[3])v+=+sm[3]*barBeats(meter);return v;}return Number.isFinite(+s)?+s:null;}

function parseTempo(src,meter){const fixed=(src.match(/\btempo\s*:\s*(\d+(?:\.\d+)?)\s*bpm/i)||[])[1];const map=[];if(fixed)map.push({kind:"step",beat:0,bpm:+fixed});const tb=findKeywordBlocks(src,"tempo")[0];if(tb){let m;const step=/(\d+(?:\.\d+)?)bar\s*:\s*(\d+(?:\.\d+)?)bpm/g;while((m=step.exec(tb.body)))map.push({kind:"step",beat:(+m[1]-1)*barBeats(meter),bpm:+m[2]});const ramp=/(\d+(?:\.\d+)?)bar\s*->\s*(\d+(?:\.\d+)?)bar\s*\{\s*(\d+(?:\.\d+)?)bpm\s*->\s*(\d+(?:\.\d+)?)bpm(?:\s*curve\s*:\s*([A-Za-z_]+))?/g;while((m=ramp.exec(tb.body)))map.push({kind:"ramp",startBeat:(+m[1]-1)*barBeats(meter),endBeat:(+m[2]-1)*barBeats(meter),startBpm:+m[3],endBpm:+m[4],curve:m[5]||"linear"});}if(!map.length)map.push({kind:"step",beat:0,bpm:120});return map.sort((a,b)=>(a.beat??a.startBeat)-(b.beat??b.startBeat));}
function parseMeterMap(src,baseMeter){const out=[{beat:0,meter:baseMeter}];const mb=findKeywordBlocks(src,"meter")[0];if(mb){let m;const re=/(\d+(?:\.\d+)?)bar\s*:\s*(\d+)\s*\/\s*(\d+)/g;while((m=re.exec(mb.body)))out.push({beat:(+m[1]-1)*barBeats(baseMeter),meter:[+m[2],+m[3]]});}return out.sort((a,b)=>a.beat-b.beat);}


function parseDynamics(src){
  const b=H.findBlocks(src,"dynamics")[0],out={p:.35,mp:.5,mf:.65,f:.85,pp:.25,ff:1};
  if(!b)return out;let m;const re=/([A-Za-z_]\w*)\s*:\s*(\d*\.?\d+)/g;while((m=re.exec(b.body)))out[m[1]]=clamp(+m[2],0,1);return out;
}
function matching(text,start,open,close){let d=1,q=null,esc=false;for(let i=start+1;i<text.length;i++){const ch=text[i];if(q){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch===q)q=null;continue;}if(ch==='"'||ch==="'"){q=ch;continue;}if(ch===open)d++;else if(ch===close){d--;if(!d)return i;}}return -1;}
function coreScan(text){
  const out=[];let i=0;const ws=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
  while(i<text.length){ws();if(i>=text.length)break;if(text[i]===','){out.push(',');i++;continue;}
    if(text.startsWith('tuplet',i)&&!/[A-Za-z0-9_]/.test(text[i+6]||'')){const hm=text.slice(i).match(/^tuplet\s+(\d+)\s*:\s*(\d+)\s*\{/);if(hm){const open=i+hm[0].lastIndexOf('{'),end=matching(text,open,'{','}');out.push({kind:'tuplet',n:+hm[1],m:+hm[2],body:text.slice(open+1,end)});i=end+1;continue;}}
    if(text.startsWith('articulation',i)&&!/[A-Za-z0-9_]/.test(text[i+12]||'')){const hm=text.slice(i).match(/^articulation\s+([A-Za-z_]\w*)\s*\{/);if(hm){const open=i+hm[0].lastIndexOf('{'),end=matching(text,open,'{','}');out.push({kind:'articulation',name:hm[1],body:text.slice(open+1,end)});i=end+1;continue;}}
    if(text.startsWith('fragment',i)&&!/[A-Za-z0-9_]/.test(text[i+8]||'')){const hm=text.slice(i).match(/^fragment\s*\{/);if(hm){const open=i+hm[0].lastIndexOf('{'),end=matching(text,open,'{','}');let j=end+1;while(j<text.length&&/\s/.test(text[j]))j++;const rm=text.slice(j).match(/^\*\s*(\d+)/);out.push({kind:'fragment',body:text.slice(open+1,end),count:rm?+rm[1]:1});i=rm?j+rm[0].length:end+1;continue;}}
    if(text[i]==='('){const end=matching(text,i,'(',')');if(end>i){let j=end+1;while(j<text.length&&/\s/.test(text[j]))j++;const rm=text.slice(j).match(/^\*\s*(\d+)/);if(rm){out.push({kind:'repeat',body:text.slice(i+1,end),count:+rm[1]});i=j+rm[0].length;continue;}}}
    if(text[i]==='['){const end=matching(text,i,'[',']');out.push(text.slice(i,end+1));i=end+1;continue;}
    let j=i;while(j<text.length&&!/[\s,{}]/.test(text[j]))j++;let token=text.slice(i,j);i=j;ws();if(i<text.length&&text[i]==='{'){const end=matching(text,i,'{','}');out.push({kind:'event',token,attrs:propsOf(text.slice(i+1,end))});i=end+1;}else out.push(token);
  }
  return out;
}
function durationSpec(raw,barLen){const m=String(raw).match(/^@(bar|\d+)(d?)(t?)/);if(!m)return null;if(m[1]==='bar'&&(m[2]||m[3]))return {beats:barLen,len:m[0].length,error:'@bar does not accept dotted/triplet modifiers'};let beats=m[1]==='bar'?barLen:4/+m[1];if(m[2])beats*=1.5;if(m[3])beats*=2/3;return {beats,len:m[0].length};}
function velocitySpec(raw,dyn){const m=String(raw).match(/^!([A-Za-z_]\w*|\d*\.?\d+)/);if(!m)return null;return {value:m[1] in dyn?dyn[m[1]]:clamp(+m[1],0,1),len:m[0].length};}
function cloneCursor(st){return {dur:st.dur,vel:st.vel,lastPitch:st.lastPitch,lastGroup:st.lastGroup?[...st.lastGroup]:null,articulation:st.articulation};}
function parseCoreStream(text,opt,state=null,scale=1){
  const barLen=barBeats(opt.meter),dyn=opt.dynamics;let st=state||{time:opt.offset||0,barStart:opt.offset||0,dur:.5,vel:.8,lastPitch:null,lastGroup:null,lastSound:null,articulation:null};const events=[],diagnostics=[];
  const run=(tokens,localScale)=>{for(let item of tokens){
    if(item===','){const used=st.time-st.barStart;if(used>barLen+1e-6)diagnostics.push({kind:'error',message:`Track ${opt.track}: bar exceeds ${opt.meter[0]}/${opt.meter[1]} by ${(used-barLen).toFixed(3)} beat(s)`});st.time=Math.max(st.time,st.barStart+barLen);st.barStart+=barLen;continue;}
    if(typeof item==='object'&&item.kind==='fragment'){const outer=st;for(let n=0;n<(item.count||1);n++){const start=outer.time;st={time:start,barStart:outer.barStart,dur:.5,vel:.8,lastPitch:null,lastGroup:null,lastSound:null,articulation:null};run(coreScan(item.body),localScale);const end=st.time;st=outer;st.time=end;}continue;}
    if(typeof item==='object'&&item.kind==='repeat'){const snap=cloneCursor(st);for(let n=0;n<item.count;n++){if(n>0){const t=st.time,b=st.barStart;Object.assign(st,cloneCursor(snap));st.time=t;st.barStart=b;}run(coreScan(item.body),localScale);}continue;}
    if(typeof item==='object'&&item.kind==='tuplet'){run(coreScan(item.body),localScale*(item.m/item.n));continue;}
    if(typeof item==='object'&&item.kind==='articulation'){const old=st.articulation;st.articulation=item.name;run(coreScan(item.body),localScale);st.articulation=old;continue;}
    let attrs=null,raw=typeof item==='object'?item.token:item;if(typeof item==='object')attrs=item.attrs;
    if(!raw)continue;
    let ds=durationSpec(raw,barLen);if(ds&&raw.endsWith(':')){st.dur=ds.beats*localScale;continue;}
    let vs=velocitySpec(raw,dyn);if(vs&&raw.endsWith(':')){st.vel=vs.value;continue;}
    let d=st.dur,v=st.vel,pos=0;ds=durationSpec(raw,barLen);if(ds){d=ds.beats*localScale;pos+=ds.len;}vs=velocitySpec(raw.slice(pos),dyn);if(vs){v=vs.value;pos+=vs.len;}raw=raw.slice(pos);if(!raw)continue;
    if(raw==='_'){st.time+=d;continue;}
    if(raw==='~'){if(!st.lastSound){diagnostics.push({kind:'error',message:`Track ${opt.track}: sustain '~' without sounding event`});st.time+=d;continue;}st.lastSound.duration+=d;st.time+=d;continue;}
    let pitches=[];
    if(raw==='.'){if(!st.lastGroup){diagnostics.push({kind:'error',message:`Track ${opt.track}: retrigger '.' without Note Group`});st.time+=d;continue;}pitches=[...st.lastGroup];}
    else if(raw==='+'||raw==='-'||/^[+-]\d+$/.test(raw)){if(st.lastPitch==null){diagnostics.push({kind:'error',message:`Track ${opt.track}: relative pitch without cursor`});st.time+=d;continue;}st.lastPitch+=raw==='+'?1:raw==='-'?-1:+raw;pitches=[st.lastPitch];}
    else if(raw.startsWith('[')&&raw.endsWith(']')){const parts=raw.slice(1,-1).trim().split(/\s+/).filter(Boolean);if(!parts.length){st.time+=d;continue;}const root=midiFromNote(parts[0]);if(root==null){diagnostics.push({kind:'error',message:`Track ${opt.track}: chord root must be absolute pitch`});st.time+=d;continue;}pitches=[root];for(const x of parts.slice(1)){const a=midiFromNote(x);if(a!=null)pitches.push(a);else if(/^[+-]\d+$/.test(x))pitches.push(root+(+x));else diagnostics.push({kind:'error',message:`Track ${opt.track}: bad chord tone ${x}`});}st.lastPitch=root;}
    else {const a=midiFromNote(raw);if(a==null){diagnostics.push({kind:'warning',message:`Track ${opt.track}: unsupported note token "${raw}"`});continue;}st.lastPitch=a;pitches=[a];}
    st.lastGroup=[...pitches];const gate=attrs?.gate?.value??1;const ev={type:'note',time:st.time,duration:d*Math.max(0,Math.min(2,gate)),pitches,velocity:v,track:opt.track,voice:opt.voice||'main'};if(st.articulation)ev.articulation=st.articulation;if(attrs){if(attrs.articulation)ev.articulation=attrs.articulation.value;if(attrs.expression)ev.expression=attrs.expression.value;if(attrs.pressure)ev.pressure=attrs.pressure.value;ev.attributes=attrs;}events.push(ev);st.lastSound=ev;st.time+=d;
  }};
  run(coreScan(text),scale);return {events,length:st.time-(opt.offset||0),state:st,diagnostics};
}
function compileNotesBlock(body,opt){const voices=H.findBlocks(body,'voice'),events=[],diagnostics=[];let length=0;if(voices.length){for(const vb of voices){const r=parseCoreStream(vb.body,{...opt,voice:vb.name});events.push(...r.events);diagnostics.push(...r.diagnostics);length=Math.max(length,r.length);}const rem=removeRanges(body,voices);const r=parseCoreStream(rem,{...opt,voice:'main'});events.push(...r.events);diagnostics.push(...r.diagnostics);length=Math.max(length,r.length);}else{const r=parseCoreStream(body,opt);events.push(...r.events);diagnostics.push(...r.diagnostics);length=r.length;}return {events,length,diagnostics};}
function recompileExplicitNotes(trackBlock,track,sections,meter,dynamics,diagnostics){const sectionBlocks=[];const rebuilt=[];let len=0;for(const [sn,sec] of sections){const sb=blockByName(trackBlock.body,sn);if(!sb)continue;sectionBlocks.push(sb);for(const nb of H.findBlocks(sb.body,'notes')){const r=compileNotesBlock(nb.body,{track:track.name,offset:sec.startBeat,meter,dynamics});rebuilt.push(...r.events);diagnostics.push(...r.diagnostics);len=Math.max(len,sec.startBeat+r.length);}}
  const rem=removeRanges(trackBlock.body,sectionBlocks);for(const nb of H.findBlocks(rem,'notes')){const r=compileNotesBlock(nb.body,{track:track.name,offset:0,meter,dynamics});rebuilt.push(...r.events);diagnostics.push(...r.diagnostics);len=Math.max(len,r.length);}if(rebuilt.length||H.findBlocks(trackBlock.body,'notes').length){
    // Replace the legacy first-pass explicit-note result completely.  Keeping the
    // old track.length here made multi-voice top-level notes inherit a stale
    // parser length (typically + one bar), which in turn extended playback.
    const preserved=(track.events||[]).filter(e=>e.type!=='note'||e.voice==='guitar'||e.voice==='guitar-tab'||String(e.voice||'').startsWith('generated')||e.voice==='follow');
    track.events=preserved;
    track.events.push(...rebuilt);
    const preservedEnd=preserved.reduce((m,e)=>Math.max(m,(e.time||0)+(e.duration||0)),0);
    track.length=Math.max(len,preservedEnd);
  }}

function parsePatternDefs(src){const out=new Map();const re=/\bpattern\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z_]\w*(?:<[^>]+>)?))?\s*\{/g;let m;while((m=re.exec(src))){const open=src.indexOf("{",m.index);let d=1,i=open+1;for(;i<src.length&&d;i++){if(src[i]==="{")d++;else if(src[i]==="}")d--;}const params=parseArgList(m[2]).map(p=>{const mm=p.match(/^([A-Za-z_]\w*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);return mm?{name:mm[1],type:mm[2].trim(),default:mm[3]?.trim()??null}:null;}).filter(Boolean);const body=src.slice(open+1,i-1);let returnType=m[3]||null;if(!returnType){if(H.findBlocks(body,"notes").length)returnType="NotesFragment";else if(H.findBlocks(body,"drums").length)returnType="DrumFragment";}out.set(m[1],{name:m[1],params,returnType,body});re.lastIndex=i;}return out;}
function parseFnDefs(src){const out=new Map();const re=/\bfn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*->\s*([A-Za-z_][\w<>]*)\s*\{/g;let m;while((m=re.exec(src))){const open=src.indexOf("{",m.index);let d=1,i=open+1;for(;i<src.length&&d;i++){if(src[i]==="{")d++;else if(src[i]==="}")d--;}out.set(m[1],{name:m[1],params:parseArgList(m[2]),returnType:m[3],body:src.slice(open+1,i-1).trim()});re.lastIndex=i;}return out;}
function parseMacroDefs(src){const out=[];const re=/\bmacro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^\{]+))?\s*\{/g;let m;while((m=re.exec(src))){const open=src.indexOf("{",m.index);let d=1,i=open+1;for(;i<src.length&&d;i++){if(src[i]==="{")d++;else if(src[i]==="}")d--;}out.push({name:m[1],signature:m[2],returns:(m[3]||"").trim(),body:src.slice(open+1,i-1)});re.lastIndex=i;}return out;}
function evalFn(fnName,t,defs){const fn=defs.get(fnName);if(!fn)return null;let expr=fn.body.trim();const ret=expr.match(/(?:return\s+)?([^;\n]+)$/)?.[1]||expr;function val(x){x=x.trim();const uv=unitValue(x);if(uv.type!=="String")return uv.value;if(x==="t")return t;let m=x.match(/^ease_in\((.+)\)$/);if(m){const z=val(m[1]);return z*z;}m=x.match(/^ease_out\((.+)\)$/);if(m){const z=val(m[1]);return 1-(1-z)*(1-z);}m=x.match(/^lerp\((.+),(.+),(.+)\)$/);if(m){const a=val(m[1]),b=val(m[2]),u=val(m[3]);return a+(b-a)*u;}return +x;}return val(ret);}

function compilePatternCall(def,argsText,repeat,trackName,offset,meter,dynamics){const args=parseArgList(argsText);const vals={};def.params.forEach((p,i)=>vals[p.name]=args[i]??p.default??"");let body=def.body;for(const [k,v] of Object.entries(vals))body=body.replace(new RegExp("\\b"+k+"\\b","g"),v);const notes=H.findBlocks(body,"notes")[0],drums=H.findBlocks(body,"drums")[0];if(!notes&&!drums)return {events:[],length:0,diagnostics:[{kind:"error",message:`Pattern ${def.name}: must produce one finite fragment`} ]};let all=[],len=0,diagnostics=[];for(let r=0;r<(repeat||1);r++){let rr;if(notes)rr=compileNotesBlock(notes.body,{track:trackName,offset:offset+len,meter,dynamics});else{const dr=parseDrumBody(drums.body,trackName,offset+len,120);rr={events:dr.events,length:dr.length,diagnostics:[]};}for(const e of rr.events){e.generatedBy=`pattern ${def.name}`;e.provenance={...(e.provenance||{}),kind:"pattern",name:def.name,args:[...args],iteration:r};}all.push(...rr.events);diagnostics.push(...(rr.diagnostics||[]));len+=rr.length;}return {events:all,length:len,diagnostics};}
function patternCallsIn(body,patterns,trackName,offset,meter,dynamics){const events=[];let length=0;const diagnostics=[];for(const [pn,pd] of patterns){const re=new RegExp("\\b"+pn+"\\s*\\(([^)]*)\\)\\s*(?:\\*\\s*(\\d+))?","g");let m;while((m=re.exec(body))){const r=compilePatternCall(pd,m[1],m[2]?+m[2]:1,trackName,offset+length,meter,dynamics);events.push(...r.events);diagnostics.push(...r.diagnostics);length+=r.length;}}return {events,length,diagnostics};}
function sectionCalls(body,patterns,trackName,sections,meter,dynamics){const events=[];let length=0,diagnostics=[];const sectionRanges=[];for(const [name,sec] of sections){const sb=blockByName(body,name);if(!sb)continue;sectionRanges.push(sb);const r=patternCallsIn(sb.body,patterns,trackName,sec.startBeat,meter,dynamics);events.push(...r.events);diagnostics.push(...r.diagnostics);length=Math.max(length,sec.startBeat+r.length);}const rem=removeRanges(body,sectionRanges);const top=patternCallsIn(rem,patterns,trackName,0,meter,dynamics);events.push(...top.events);diagnostics.push(...top.diagnostics);length=Math.max(length,top.length);return {events,length,diagnostics};}

function parseSectionHarmony(src,key,meter,sections,diagnostics){const harmonies=[];for(const hb of H.findBlocks(src,"chords")){const all=[];const secBlocks=[];for(const [sn,sec] of sections){const sb=blockByName(hb.body,sn);if(!sb)continue;secBlocks.push(sb);const ph=H.parseHarmony({name:hb.name,body:sb.body},key,meter,diagnostics);for(const e of ph.events){const shifted={...e,time:e.time+sec.startBeat,index:all.length};if(shifted.time+shifted.duration>sec.endBeat+1e-6)diagnostics.push({kind:"error",message:`Harmony ${hb.name}/${sn}: exceeds section length`});all.push(shifted);}}const rem=removeRanges(hb.body,secBlocks);const top=H.parseHarmony({name:hb.name,body:rem},key,meter,diagnostics);for(const e of top.events)all.push({...e,index:all.length});all.sort((a,b)=>a.time-b.time);harmonies.push({name:hb.name,type:"harmony",events:all,length:all.reduce((m,e)=>Math.max(m,e.time+e.duration),0),key});}return harmonies;}

function seeded(seed){let s=(seed|0)||1;return ()=>((s=(s*1664525+1013904223)|0)>>>0)/4294967296;}
function parseDrumBody(body,trackName,offset,tempo){let step=.25;const dm=body.match(/@(\d+)(d|t)?:/);if(dm){let b=4/+dm[1];if(dm[2]==="d")b*=1.5;if(dm[2]==="t")b*=2/3;step=b;}const events=[];let max=0,m;const re=/([A-Za-z][\w.]*)\s+"([^"]+)"/g;while((m=re.exec(body))){const lane=m[1],p=m[2].replace(/\s/g,"");max=Math.max(max,p.length);[...p].forEach((ch,i)=>{if(ch===".")return;const vel={x:.72,X:1,g:.36,o:.82,c:.70,r:.66,f:.9}[ch]??.7;events.push({type:"drum",drum:lane,symbol:ch,time:offset+i*step,duration:Math.min(.12,step*.8),velocity:vel,track:trackName});});}const hb=H.findBlocks(body,"humanize")[0];if(hb){const timing=timeToSeconds(scalar(hb.body,"timing","0ms"))||0,amount=Number(scalar(hb.body,"velocity","0"))||0,seed=Number(scalar(hb.body,"seed","0"))||0;if((timing||amount)&&!seed)throw new Error(`Track ${trackName}: humanize requires seed`);const rnd=seeded(seed);for(const e of events){e.time=Math.max(offset,e.time+((rnd()*2-1)*timing)/(60/tempo));e.velocity=clamp(e.velocity+(rnd()*2-1)*amount,0,1);e.provenance={kind:"humanize",seed};}}return {events,length:max*step};}
function sectionDrums(trackBlock,track,sections,tempo){const db=H.findBlocks(trackBlock.body,"drums")[0];if(!db)return null;const secEvents=[];let found=false,len=0;for(const [sn,sec] of sections){const sb=blockByName(db.body,sn);if(!sb)continue;found=true;const r=parseDrumBody(sb.body,track.name,sec.startBeat,tempo);secEvents.push(...r.events);len=Math.max(len,sec.startBeat+r.length);}if(!found)return null;
  // A humanize block at drums scope applies to all section-generated events.
  const hb=H.findBlocks(db.body,"humanize")[0];if(hb){const timing=timeToSeconds(scalar(hb.body,"timing","0ms"))||0,amount=Number(scalar(hb.body,"velocity","0"))||0,seed=Number(scalar(hb.body,"seed","0"))||0;if((timing||amount)&&!seed)throw new Error(`Track ${track.name}: humanize requires seed`);const rnd=seeded(seed);for(const e of secEvents){e.time=Math.max(0,e.time+((rnd()*2-1)*timing)/(60/tempo));e.velocity=clamp(e.velocity+(rnd()*2-1)*amount,0,1);e.provenance={...(e.provenance||{}),kind:"humanize",seed};}}
  return {events:secEvents,length:len};}


const SPECIAL_INSTRUMENTS=['bass','violin','harp','accordion','organ','steel','sax','vocal','piano'];
function stripScalarLines(body,keys){let s=body;for(const k of keys)s=s.replace(new RegExp('^\\s*'+k+'\\s*:\\s*[^\\n\\r]+$','gm'),'');return s;}
function annotate(events,data){for(const e of events)Object.assign(e,data);return events;}
function compileSpecialInstrument(trackBlock,track,meter,dynamics,diagnostics){
  const found=[];
  for(const kind of SPECIAL_INSTRUMENTS){for(const b of H.findBlocks(trackBlock.body,kind))found.push({kind,block:b});}
  if(!found.length)return;
  const specialRanges=found.map(x=>x.block);const outside=removeRanges(trackBlock.body,specialRanges);if(!H.findBlocks(outside,'notes').length){track.events=(track.events||[]).filter(e=>e.type!=='note'||e.voice!=='main');}
  // Prefer the first explicit performance block as the track's semantic instrument.
  track.instrument=found[0].kind==='sax'?'sax':found[0].kind;
  track.performance=track.performance||[];
  for(const {kind,block:b} of found){
    const desc={kind,props:propsOf(b.body),events:[]};
    if(kind==='piano'){
      const voices=H.findBlocks(b.body,'voice');
      for(const vb of voices){const r=parseCoreStream(vb.body,{track:track.name,voice:vb.name,offset:0,meter,dynamics});annotate(r.events,{performanceKind:'piano',pedal:scalar(b.body,'pedal','auto')});desc.events.push(...r.events);diagnostics.push(...r.diagnostics);}
    } else if(kind==='vocal'){
      for(const ph of H.findBlocks(b.body,'phrase')){const nb=H.findBlocks(ph.body,'notes')[0];if(!nb)continue;const r=parseCoreStream(nb.body,{track:track.name,voice:'vocal',offset:0,meter,dynamics});annotate(r.events,{performanceKind:'vocal',lyric:String(ph.name||'').replace(/^['"]|['"]$/g,''),pronunciation:scalar(ph.body,'pronunciation','auto'),breath:scalar(ph.body,'breath','auto'),vibrato:scalar(ph.body,'vibrato','natural')});desc.events.push(...r.events);diagnostics.push(...r.diagnostics);}
    } else if(kind==='organ'){
      for(const man of H.findBlocks(b.body,'manual')){const nb=H.findBlocks(man.body,'notes')[0];if(!nb)continue;const r=parseCoreStream(nb.body,{track:track.name,voice:`organ:${man.name}`,offset:0,meter,dynamics});annotate(r.events,{performanceKind:'organ',manual:man.name,stops:scalar(man.body,'stops','[]')});desc.events.push(...r.events);diagnostics.push(...r.diagnostics);}
      const ped=H.findBlocks(b.body,'pedal')[0];if(ped){const r=parseCoreStream(ped.body,{track:track.name,voice:'organ:pedal',offset:0,meter,dynamics});annotate(r.events,{performanceKind:'organ',manual:'pedal'});desc.events.push(...r.events);diagnostics.push(...r.diagnostics);}
    } else if(kind==='accordion'){
      const right=H.findBlocks(b.body,'right')[0];if(right){const r=parseCoreStream(right.body,{track:track.name,voice:'accordion:right',offset:0,meter,dynamics});annotate(r.events,{performanceKind:'accordion',hand:'right',bellows:scalar(b.body,'bellows','auto')});desc.events.push(...r.events);diagnostics.push(...r.diagnostics);}const left=H.findBlocks(b.body,'left')[0];if(left)desc.leftHand=left.body.trim();
    } else if(kind==='harp'){
      for(const gl of H.findBlocks(b.body,'gliss')){const from=midiFromNote(String(scalar(gl.body,'from','c3')).trim()),to=midiFromNote(String(scalar(gl.body,'to','c6')).trim());const dr=String(scalar(gl.body,'duration','@2')).trim();const dm=dr.match(/^@(\d+)/),duration=dm?4/+dm[1]:2;if(from!=null&&to!=null){const count=Math.max(2,Math.abs(to-from)+1),step=duration/count,dir=to>=from?1:-1;for(let n=0,p=from;dir>0?p<=to:p>=to;p+=dir,n++)desc.events.push({type:'note',time:n*step,duration:step*.8,pitches:[p],velocity:.58,track:track.name,voice:'harp-gliss',performanceKind:'harp',articulation:'gliss'});}}
      desc.pedals=scalar(b.body,'pedals','auto');
    } else if(kind==='steel'){
      desc.tuning=scalar(b.body,'tuning','E9');desc.position=scalar(b.body,'position','auto');desc.strings=scalar(b.body,'strings','[]');desc.performanceControls=[...b.body.matchAll(/pedal\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]+)/g)].map(m=>({pedal:m[1],state:m[2]}));
    } else {
      const nested=[...H.findBlocks(b.body,'slur')];let clean=removeRanges(b.body,nested);clean=stripScalarLines(clean,['style','fingering','bow','breath','tonguing']);const r=parseCoreStream(clean,{track:track.name,voice:kind,offset:0,meter,dynamics});annotate(r.events,{performanceKind:kind,style:scalar(b.body,'style',null),fingering:scalar(b.body,'fingering',null),bow:scalar(b.body,'bow',null),breath:scalar(b.body,'breath',null),tonguing:scalar(b.body,'tonguing',null)});desc.events.push(...r.events);diagnostics.push(...r.diagnostics);for(const sl of nested){const rr=parseCoreStream(sl.body,{track:track.name,voice:kind,offset:r.length,meter,dynamics});annotate(rr.events,{performanceKind:kind,articulation:'slur'});desc.events.push(...rr.events);diagnostics.push(...rr.diagnostics);}
    }
    if(desc.events.length){track.events.push(...desc.events);track.length=Math.max(track.length||0,...desc.events.map(e=>e.time+(e.duration||0)));}
    track.performance.push(desc);
  }
}

function parseClipBlocks(trackBody,trackName,sections,meter,assets){const clips=[];for(const cb of H.findBlocks(trackBody,"clip")){const fileRaw=scalar(cb.body,"file",null);let file=fileRaw;if(fileRaw){let m=String(fileRaw).match(/^asset\(["']([^"']+)["']\)$/);if(m)file=m[1];else{m=String(fileRaw).match(/^asset\(([A-Za-z_]\w*)\)$/);if(m)file=assets[m[1]]||m[1];else file=String(fileRaw).replace(/^['"]|['"]$/g,"");}}const at=resolvePosition(scalar(cb.body,"at","0"),sections,meter)??0;const lenRaw=scalar(cb.body,"length",null);const length=lenRaw?resolvePosition(lenRaw,new Map(),meter):null;clips.push({name:cb.name,track:trackName,file,at,length,source:{start:timeToSeconds(scalar((H.findBlocks(cb.body,"source")[0]||{}).body||"","start","0s"))||0,end:timeToSeconds(scalar((H.findBlocks(cb.body,"source")[0]||{}).body||"","end","0s"))||null},gain:dbToGain(scalar(cb.body,"gain","0db"))||1,fadeIn:timeToSeconds(scalar(cb.body,"fade_in","0ms"))||0,fadeOut:timeToSeconds(scalar(cb.body,"fade_out","0ms"))||0,reverse:/\breverse\s*:\s*true/.test(cb.body),warp:(H.findBlocks(cb.body,"warp")[0]?.body)||null});}return clips;}

function effectDescriptor(name,body,imports){const props=propsOf(body);const imported=imports.find(i=>(i.kind==="component"||i.kind==="plugin")&&i.name===name);let kind="primitive",impl="native";if(name==="Sidechain"||name==="StereoDelay"){kind="component";impl="wasm";}else if(name==="ChannelStrip"||name==="Reverb"||name==="Limiter"){kind="plugin";impl="wasm";}else if(imported){kind=imported.kind;impl=imported.path.endsWith(".wasm")?"wasm":"external";}return {name,kind,impl,module:imported?.path||null,props,children:findNamedBlocks(body).map(b=>effectDescriptor(b.name,b.body,imports))};}
function parseEffects(body,imports){const eb=H.findBlocks(body,"effects")[0];if(!eb)return [];const scalars=[];for(const b of findNamedBlocks(eb.body)){if(["detector","feedback_filter"].includes(b.name))continue;scalars.push(effectDescriptor(b.name,b.body,imports));}return scalars;}
function parseInstrument(body,imports){const ib=H.findBlocks(body,"instrument")[0];if(!ib)return null;const n=findNamedBlocks(ib.body)[0];if(!n)return null;const imp=imports.find(i=>i.kind==="plugin"&&i.name===n.name);return {name:n.name,kind:imp?"wasm-plugin":"builtin",module:imp?.path||null,params:propsOf(n.body)};}
function parseStereo(body){const sb=H.findBlocks(body,"stereo")[0];return sb?{balance:Number(scalar(sb.body,"balance","0"))||0,width:Number(scalar(sb.body,"width","1"))||1}:null;}

function parseBuses(src,imports){return H.findBlocks(src,"bus").map(b=>({name:b.name,effects:findNamedBlocks(b.body).map(n=>effectDescriptor(n.name,n.body,imports)),gain:dbToGain(scalar(b.body,"gain","0db"))||1,stereo:parseStereo(b.body)}));}
function parseRouting(src){
  const rb=H.findBlocks(src,"routing")[0],edges=[];
  if(!rb)return edges;
  const re=/([A-Za-z_][\w.]*)\s*->\s*([A-Za-z_][\w.]*)(?:\s*\{([\s\S]*?)\})?/g;
  let m;
  while((m=re.exec(rb.body))){
    const body=m[3]||"";
    const gm=body.match(/\bgain\s*:\s*([^\s}]+)/);
    const mm=body.match(/\bmode\s*:\s*([^\s}]+)/);
    const gainValue=gm?unitValue(gm[1]).value:1;
    const gain=Number(gainValue);
    const mode=mm?String(unitValue(mm[1]).value):"direct";
    edges.push({from:m[1],to:m[2],gain:Number.isFinite(gain)?gain:1,mode,kind:mm?"send":"audio"});
  }
  return edges;
}
function parseMaster(src,imports){const mb=H.findBlocks(src,"master")[0];return mb?{name:"Master",effects:parseEffects(mb.body,imports),gain:dbToGain(scalar(mb.body,"gain","0db"))||1,stereo:parseStereo(mb.body)}:{name:"Master",effects:[],gain:1,stereo:null};}
function parseRenders(src){return H.findBlocks(src,"render").map(b=>({name:b.name,props:propsOf(b.body),tracks:(scalar(b.body,"tracks","")||"").replace(/[\[\]]/g,"").split(",").map(x=>x.trim()).filter(Boolean)}));}
function parseMidiExports(src){const out=[];const re=/\bexport\s+midi\s*\{([\s\S]*?)\}/g;let m;while((m=re.exec(src)))out.push({format:"midi",tracks:(scalar(m[1],"tracks","")||"").replace(/[\[\]]/g,"").split(",").map(x=>x.trim()).filter(Boolean)});return out;}

function parseAutomations(src,sections,meter,fnDefs){const out=[];const re=/\bautomation\s+([A-Za-z_][\w.]*)\s*\{/g;let m;while((m=re.exec(src))){const open=src.indexOf("{",m.index);let d=1,i=open+1;for(;i<src.length&&d;i++){if(src[i]==="{")d++;else if(src[i]==="}")d--;}const body=src.slice(open+1,i-1),target=m[1];const rangeName=scalar(body,"range",null);const sec=rangeName?sections.get(String(rangeName).trim()):null;const points=[];const value=scalar(body,"value",null);if(value&&sec){const call=String(value).match(/^([A-Za-z_]\w*)\(t\)$/);for(let n=0;n<=32;n++){const t=n/32;let v=call?evalFn(call[1],t,fnDefs):unitValue(value).value;points.push({beat:sec.startBeat+(sec.endBeat-sec.startBeat)*t,value:v});}}let sm;const sre=/([A-Za-z_][\w.]*)\s*:\s*([^\n\r{}]+)/g;while((sm=sre.exec(body))){if(sm[1]==="range"||sm[1]==="value")continue;const s=sections.get(sm[1]);if(s)points.push({beat:s.startBeat,value:unitValue(sm[2]).value});}out.push({target,range:rangeName,points});re.lastIndex=i;}return out;}
function parseModulations(src){const out=[];const re=/\bmodulation\s+([A-Za-z_][\w.]*)\s*\{/g;let m;while((m=re.exec(src))){const open=src.indexOf("{",m.index);let d=1,i=open+1;for(;i<src.length&&d;i++){if(src[i]==="{")d++;else if(src[i]==="}")d--;}const body=src.slice(open+1,i-1),lb=H.findBlocks(body,"lfo")[0];if(lb)out.push({target:m[1],source:{type:"lfo",shape:String(scalar(lb.body,"shape","sine")).trim(),rate:String(scalar(lb.body,"rate","1/4")).trim(),amount:Number(scalar(lb.body,"amount","0"))||0}});re.lastIndex=i;}return out;}


function performanceFamily(track,ev){
  const k=String(ev.performanceKind||track.instrument||track.name||'synth').toLowerCase();
  if(/sax|flute|brass|wind|breath/.test(k))return 'wind';
  if(/string|bow|violin|cello/.test(k))return 'strings';
  if(/guitar|harp|pluck/.test(k))return 'pluck';
  if(/piano|epiano|keys|hammer/.test(k))return 'keys';
  if(/bass/.test(k))return 'bass';
  if(/organ/.test(k))return 'organ';
  if(/vocal|choir|voice/.test(k))return 'vocal';
  return 'synth';
}
function performancePoint(list,id,offset,value){
  const n=Number(value);if(!Number.isFinite(n))return;
  const limits=id===1?[-48,48]:(id===5?[-1,1]:[0,1]);
  list.push({id,offset:Math.max(0,Number(offset)||0),value:clamp(n,limits[0],limits[1])});
}
function compilePerformanceTrack(track){
  let notes=0;const families=new Set();
  for(const ev of track.events||[]){
    if(ev.type!=='note')continue;
    notes++;const family=performanceFamily(track,ev);families.add(family);
    const d=Math.max(.03,Number(ev.duration)||.25),art=String(ev.articulation||'').toLowerCase();
    if(/staccato|spiccato/.test(art))ev.duration=d*.58;
    else if(/marcato/.test(art)){ev.duration=d*.82;ev.velocity=clamp((Number(ev.velocity)||.8)*1.08,0,1);}
    else if(/accent/.test(art))ev.velocity=clamp((Number(ev.velocity)||.8)*1.08,0,1);
    else if(/tenuto/.test(art))ev.duration=d*.96;
    else if(/legato|slur/.test(art))ev.duration=d*1.035;
    else if(/palm|mute/.test(art))ev.duration=d*.66;
    const points=[];const v=clamp(Number(ev.velocity)||.8,0,1),t1=Math.min(d*.16,.10),mid=d*.48,end=d*.9;
    if(family==='wind'){
      performancePoint(points,1,0,-.10-(1-v)*.06);performancePoint(points,1,t1,0);
      performancePoint(points,2,0,.38+v*.18);performancePoint(points,2,t1,.62+v*.24);performancePoint(points,2,end,.42+v*.12);
      performancePoint(points,3,0,.42+v*.22);performancePoint(points,3,mid,.52+v*.30);
      performancePoint(points,4,0,.72);performancePoint(points,4,t1,1);performancePoint(points,4,end,.82);
    }else if(family==='strings'){
      performancePoint(points,2,0,.30+v*.18);performancePoint(points,2,t1,.58+v*.26);performancePoint(points,2,mid,.66+v*.22);performancePoint(points,2,end,.48+v*.16);
      performancePoint(points,3,0,.40+v*.16);performancePoint(points,3,mid,.53+v*.25);
      performancePoint(points,4,0,.78);performancePoint(points,4,t1,.96);performancePoint(points,4,end,.86);
    }else if(family==='pluck'||family==='bass'){
      performancePoint(points,3,0,.58+v*.32);performancePoint(points,3,Math.min(d*.35,.20),.36+v*.18);
      performancePoint(points,4,0,1);performancePoint(points,4,end,.72);
    }else if(family==='keys'){
      performancePoint(points,3,0,.48+v*.42);performancePoint(points,3,Math.min(d*.4,.24),.35+v*.16);
      performancePoint(points,4,0,1);if(d>.4)performancePoint(points,4,end,.76);
    }else if(family==='vocal'){
      performancePoint(points,1,0,-.06);performancePoint(points,1,t1,0);
      performancePoint(points,2,0,.42);performancePoint(points,2,t1,.7+v*.16);performancePoint(points,2,end,.5);
      performancePoint(points,3,0,.46);performancePoint(points,3,mid,.62);
      performancePoint(points,4,0,.76);performancePoint(points,4,t1,1);performancePoint(points,4,end,.8);
    }else if(family==='organ'){
      performancePoint(points,3,0,.5+v*.16);performancePoint(points,4,0,.92);
    }else{
      if(d>.5){performancePoint(points,2,0,.18+v*.12);performancePoint(points,2,mid,.30+v*.18);}
      performancePoint(points,3,0,.46+v*.16);
    }
    if(Number.isFinite(Number(ev.expression)))performancePoint(points,4,0,ev.expression);
    if(Number.isFinite(Number(ev.pressure)))performancePoint(points,2,0,ev.pressure);
    const timbre=ev.attributes?.timbre?.value;if(Number.isFinite(Number(timbre)))performancePoint(points,3,0,timbre);
    const pan=ev.attributes?.pan?.value;if(Number.isFinite(Number(pan)))performancePoint(points,5,0,pan);
    points.sort((a,b)=>a.offset-b.offset||a.id-b.id);
    ev.noteExpressions=points;
    ev.performance={compiler:'instrument-performance-v2',family,articulation:ev.articulation||null,expressionPoints:points.length};
  }
  track.performance={compiler:'instrument-performance-v2',notes,families:[...families]};
}

function buildGraph(ir,src,imports){const buses=parseBuses(src,imports),routing=parseRouting(src),master=parseMaster(src,imports);const nodes=[{id:"Master",kind:"master",...master}];for(const t of ir.tracks)nodes.push({id:t.name,kind:"track",effects:t.effects||[],gain:t.gain,pan:t.pan,stereo:t.stereo,instrument:t.instrumentDescriptor||null});for(const b of buses)nodes.push({id:b.name,kind:"bus",...b});let edges=routing;if(!edges.length)edges=ir.tracks.map(t=>({from:t.name,to:"Master",kind:"audio",gain:1,mode:"direct"})).concat(buses.map(b=>({from:b.name,to:"Master",kind:"audio",gain:1,mode:"direct"})));const sidechains=[];for(const t of ir.tracks){for(const fx of t.effects||[]){if(fx.name==="Sidechain"){const srcName=fx.props.source?.value||"";sidechains.push({from:srcName,to:t.name,effect:fx.name,kind:"sidechain"});}}}return {nodes,edges,sidechains,buses,master};}

function compileFoundation(sourceText){
  const source=stripComments(sourceText);
  const ir=coreCompile(source);
  const diagnostics=[...ir.diagnostics.filter(d=>!/^Harmony /.test(d.message||"") && !/^Track .*: unsupported note token /.test(d.message||"") && !/^Track .*: tie /.test(d.message||""))];
  const meter=ir.meter||ir.timeSignature||[4,4], key=ir.key||H.keyOf(source), tempo=ir.tempo||120;
  const structure=parseStructure(source,meter), sections=sectionMap(structure);
  const patterns=parsePatternDefs(source), fnDefs=parseFnDefs(source), macroDefs=parseMacroDefs(source), dynamics=parseDynamics(source);
  const imports=parseImports(source), assets=parseAssets(source), constants={}, types=parseTypeDecls(source);

  // Section-aware Harmony replaces the minimal core harmony result when structure sections are used.
  if(structure.length){
    const hs=parseSectionHarmony(source,key,meter,sections,diagnostics);
    if(hs.length){ir.harmonies=hs;ir.dependencies=[];for(const t of ir.tracks){t.events=(t.events||[]).filter(e=>!e.generatedBy||!String(e.generatedBy).includes("|>"));const tb=H.findBlocks(source,"track").find(b=>b.name===t.name);if(!tb)continue;for(const f of H.findBlocks(tb.body,"follow")){const h=hs.find(x=>x.name===f.name);if(h){const e=H.followEvents(f,h,t.name,diagnostics);t.events.push(...e);t.dependency=h.name;ir.dependencies.push({source:h.name,target:t.name,kind:"follow"});}}const p=H.pipelineOf(tb.body);if(p){const h=hs.find(x=>x.name===p.source);if(h){const r=H.compilePipeline(p,h,t.name,diagnostics);t.events.push(...r.events);t.dependency=h.name;t.pipeline=r.pipeline;ir.dependencies.push({source:h.name,target:t.name,kind:"pipeline",pipeline:r.pipeline});}}}}
  }

  // Section drums and patterns.
  const tblocks=H.findBlocks(source,"track");
  for(const t of ir.tracks){const tb=tblocks.find(b=>b.name===t.name);if(!tb)continue;
    const gainRaw=scalar(tb.body,"gain",null); if(gainRaw!=null){const g=dbToGain(gainRaw);if(Number.isFinite(g))t.gain=g;}
    const panRaw=scalar(tb.body,"pan",null); if(panRaw!=null&&Number.isFinite(+panRaw))t.pan=clamp(+panRaw,-1,1);
    recompileExplicitNotes(tb,t,sections,meter,dynamics,diagnostics);
    compileSpecialInstrument(tb,t,meter,dynamics,diagnostics);
    const dr=sectionDrums(tb,t,sections,tempo);if(dr){t.events=(t.events||[]).filter(e=>e.type!=="drum");t.events.push(...dr.events);t.length=Math.max(t.length||0,dr.length);}
    const pc=sectionCalls(tb.body,patterns,t.name,sections,meter,dynamics);diagnostics.push(...pc.diagnostics);if(pc.events.length){t.events.push(...pc.events);t.length=Math.max(t.length||0,pc.length);}
    t.effects=parseEffects(tb.body,imports);t.instrumentDescriptor=parseInstrument(tb.body,imports);if(t.instrumentDescriptor?.name)t.instrument=t.instrumentDescriptor.name;t.stereo=parseStereo(tb.body);t.audioClips=parseClipBlocks(tb.body,t.name,sections,meter,assets);
  }

  const tempoMap=parseTempo(source,meter),meterMap=parseMeterMap(source,meter),automations=parseAutomations(source,sections,meter,fnDefs),modulations=parseModulations(source);
  // Project-level automation is lowered into ordinary track controls where possible.
  // Deeper targets (instrument.*, stereo.*, send.*) remain in resolved IR and are
  // scheduled by the audio graph against Plugin parameters / WebAudio AudioParams.
  for(const a of automations){const parts=a.target.split(".");const tr=ir.tracks.find(t=>t.name===parts[0]);if(tr){if(parts.length===2&&["gain","volume","pan","expression","modulation","mod","sustain"].includes(parts[1])){tr.controls=tr.controls||[];for(const p of a.points)tr.controls.push({type:"automation",target:parts[1],time:p.beat,value:p.value,generatedBy:"project automation"});tr.controls.sort((x,y)=>x.time-y.time);}else{tr.timelineAutomation=tr.timelineAutomation||[];tr.timelineAutomation.push({target:parts.slice(1).join("."),points:a.points,generatedBy:"project automation"});}}}
  for(const m of modulations){const parts=m.target.split(".");const tr=ir.tracks.find(t=>t.name===parts[0]);if(tr) {tr.modulations=tr.modulations||[];tr.modulations.push(m);}}
  for(const t of ir.tracks)compilePerformanceTrack(t);
  const audioClips=ir.tracks.flatMap(t=>t.audioClips||[]);
  const graph=buildGraph(ir,source,imports);
  const renders=parseRenders(source),exports=parseMidiExports(source);
  ir.events=ir.tracks.flatMap(t=>t.events||[]).sort((a,b)=>a.time-b.time);
  ir.length=Math.max(structure.at(-1)?.endBeat||0,...ir.tracks.map(t=>t.length||0),...ir.events.map(e=>e.time+(e.duration||0)),...audioClips.map(c=>c.at+(c.length||0)));
  ir.diagnostics=diagnostics;
  return {...ir,version:5,structure,tempoMap,meterMap,imports,assets,constants,types,dynamics,patterns:[...patterns.values()].map(p=>({name:p.name,params:p.params})),functions:[...fnDefs.values()].map(f=>({name:f.name,params:f.params,returnType:f.returnType})),macros:macroDefs,audioClips,automations,modulations,audioGraph:graph,renders,exports,resolvedProjectIR:{version:1,structure,tempoMap,meterMap,harmonies:ir.harmonies||[],tracks:ir.tracks,audioClips,automations,modulations,audioGraph:graph,renders,exports,imports},compilationStages:["Parser","AST","Name / Type Resolution","Harmony Resolution","Pattern Expansion","Macro Expansion","External Component Expansion","Instrument Performance Compilation","Performance IR","Timeline Resolution","Automation / Modulation Compilation","Audio Graph Construction","Resolved Project IR"]};
};

const LANGUAGE_VERSION="Draft v0.5";
const COMPONENT_ABI="soraoto:component@1.0.0";
const PLUGIN_ABI="1.0";

function matching(text,start,open="{",close="}"){
  let depth=1,quote=null,esc=false;
  for(let i=start+1;i<text.length;i++){
    const ch=text[i];
    if(quote){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch===open)depth++;else if(ch===close){depth--;if(!depth)return i;}
  }
  return -1;
}
function findBlocks(src,keyword){
  const out=[],re=new RegExp("\\b"+keyword+"(?:\\s+([^\\s{]+))?\\s*\\{","g");let m;
  while((m=re.exec(src))){const open=src.indexOf("{",m.index),end=matching(src,open);if(end<0)break;out.push({name:(m[1]||"").trim(),body:src.slice(open+1,end),start:m.index,end:end+1,open});re.lastIndex=end+1;}
  return out;
}
function stripQuotes(v){return String(v).trim().replace(/^['"]|['"]$/g,"");}
function repeatText(s,n){return Array(Math.max(0,Number(n)||0)).fill(s).join("\n");}
function replaceOutsideStrings(text,re,replacer){
  let out="",last=0,quote=null,esc=false,segments=[];
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quote){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch===quote){quote=null;segments.push({start:last,end:i+1,quoted:true});last=i+1;}continue;}
    if(ch==='"'||ch==="'"){if(i>last)segments.push({start:last,end:i,quoted:false});quote=ch;last=i;}
  }
  if(last<text.length)segments.push({start:last,end:text.length,quoted:!!quote});
  for(const seg of segments){const s=text.slice(seg.start,seg.end);out+=seg.quoted?s:s.replace(re,replacer);}
  return out;
}
function scanLets(src){
  const decls=[],re=/\blet\s+([A-Za-z_]\w*)\s*=\s*/g;let m;
  while((m=re.exec(src))){
    const name=m[1],valueStart=re.lastIndex,tail=src.slice(valueStart);let kind="value",raw="",end;
    const bm=tail.match(/^(notes|drums)\s*\{/);
    if(bm){const open=valueStart+bm[0].lastIndexOf("{"),close=matching(src,open);if(close<0)break;kind=bm[1]+"Fragment";raw=src.slice(open+1,close);end=close+1;}
    else {let i=valueStart,q=null,esc=false,paren=0,bracket=0;for(;i<src.length;i++){const ch=src[i];if(q){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch===q)q=null;continue;}if(ch==='"'||ch==="'"){q=ch;continue;}if(ch==='(')paren++;else if(ch===')')paren=Math.max(0,paren-1);else if(ch==='[')bracket++;else if(ch===']')bracket=Math.max(0,bracket-1);else if((ch==='\n'||ch==='\r'||ch===';')&&!paren&&!bracket)break;}raw=src.slice(valueStart,i).trim();end=i<src.length?i+1:i;}
    decls.push({name,kind,raw,start:m.index,end});re.lastIndex=end;
  }
  return decls;
}
function removeRanges(src,ranges){let s=src;for(const r of [...ranges].sort((a,b)=>b.start-a.start))s=s.slice(0,r.start)+" ".repeat(r.end-r.start)+s.slice(r.end);return s;}
function normalizeLetSyntax(source,diagnostics){
  if(/\bconst\s+[A-Za-z_]\w*\s*=/.test(source))diagnostics.push({kind:"error",message:"Draft v0.5: const is removed; use immutable let bindings"});
  const decls=scanLets(source),byName=new Map();
  for(const d of decls){
    if(byName.has(d.name))diagnostics.push({kind:"warning",message:`Draft v0.5 browser subset: shadowed let ${d.name} is resolved by nearest textual binding`});
    byName.set(d.name,d);
  }
  let s=removeRanges(source,decls);

  // Pattern aliases and stored pattern invocations.
  for(const d of decls){
    if(d.kind!=="value")continue;
    if(/^[A-Za-z_]\w*$/.test(d.raw)&&!/^[a-gA-G][#b]?-?\d+$/.test(d.raw)){
      const target=d.raw;
      s=replaceOutsideStrings(s,new RegExp("\\b"+d.name+"\\s*\\(","g"),()=>target+"(");
    }
  }
  // Explicit fragment splice keeps fragment cursor state isolated during canonical lowering.
  s=s.replace(/\buse\s+([A-Za-z_]\w*)\s*(?:\*\s*(\d+))?/g,(all,name,count)=>{
    const d=byName.get(name);if(!d)return all;
    const n=count?Number(count):1;
    if(d.kind==="notesFragment")return `fragment { ${d.raw} } * ${n}`;
    if(d.kind==="drumsFragment")return repeatText(d.raw,n);
    if(d.kind==="value"&&/^([A-Za-z_]\w*)\s*\([^)]*\)$/.test(d.raw))return `${d.raw} * ${n}`;
    return all;
  });

  // Scalar, pitch, String and pattern-result values. String replacement is intentionally outside quoted literals.
  for(const d of decls){
    if(d.kind!=="value")continue;
    const raw=d.raw.trim();
    if(/^[A-Za-z_]\w*$/.test(raw)&&!/^[a-gA-G][#b]?-?\d+$/.test(raw))continue; // callable alias handled above
    if(/^([A-Za-z_]\w*)\s*\([^)]*\)$/.test(raw))continue; // stored fragment call is expanded only through use
    if(/^"[\s\S]*"$/.test(raw)||/^'[\s\S]*'$/.test(raw)||/^[a-gA-G][#b]?-?\d+$/.test(raw)||/^[+-]?\d+(?:\.\d+)?(?:db|hz|khz|ms|s|bpm|bit)?$/i.test(raw)){
      s=replaceOutsideStrings(s,new RegExp("\\b"+d.name+"\\b","g"),()=>raw);
    }
  }

  // Drum lane String repeat is a grammar operation in v0.5, not general String multiplication.
  s=s.replace(/([A-Za-z][\w.]*)\s+(["'])([^"']*)\2\s*\*\s*(\d+)/g,(m,lane,q,pat,n)=>`${lane} "${pat.repeat(Number(n))}"`);
  // String let substitution above may leave a quoted literal without a repeat; the core parser accepts it directly.

  return {source:s,decls};
}
function parseCanonicalImports(src){
  const out=[],re=/\bimport\s+(?:(component|plugin)\s+([A-Za-z_]\w*)\s+from\s+)?["']([^"']+)["']/g;let m;
  while((m=re.exec(src)))out.push({kind:m[1]||(m[2]?"module":"module"),name:m[2]||null,path:m[3]});
  return out;
}
function parsePatternMeta(src){
  const out=[],re=/\bpattern\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z_]\w*(?:<[^>]+>)?))?\s*\{/g;let m;
  while((m=re.exec(src))){const open=src.indexOf("{",m.index),end=matching(src,open);const body=end>=0?src.slice(open+1,end):"";let result=m[3]||null;if(!result)result=/\bdrums\s*\{/.test(body)?"DrumFragment":/\bnotes\s*\{/.test(body)?"NotesFragment":null;out.push({name:m[1],signature:m[2].trim(),resultType:result,callableType:`PatternFn<${m[2].trim()||"()"}, ${result||"EventFragment<?>"}>`});if(end>=0)re.lastIndex=end+1;}
  return out;
}
function parseMacroMeta(src){
  const out=[],re=/\bmacro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^\{]+))?\s*\{/g;let m;
  while((m=re.exec(src))){const open=src.indexOf("{",m.index),end=matching(src,open);const body=end>=0?src.slice(open+1,end):"";const operators=[...body.matchAll(/\b(map|filter|flat_map|window|fold|scan)\b/g)].map(x=>x[1]);out.push({name:m[1],signature:m[2].trim(),returns:(m[3]||"").trim(),operators:[...new Set(operators)],pure:true,finiteStream:true});if(end>=0)re.lastIndex=end+1;}
  return out;
}
function tokenizeLyrics(body){
  const strings=[...body.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)].map(m=>(m[1]??m[2]??"").replace(/\\n/g,"\n"));
  const text=(strings.length?strings.join(" "):body).trim();
  return text.match(/[^\s{}]+\{[^{}]*\}|\{[^{}]*\}|[_./|]|[^\s]+/g)||[];
}
function parseLyricToken(token,boundary){
  if(token==="_")return {kind:"melisma",melisma:true,...boundary};
  if(token===".")return {kind:"none",...boundary};
  let surface=token,reading=null,m=token.match(/^([^{}]+)\{([^{}]*)\}$/);if(m){surface=m[1];reading=m[2];}
  else {m=token.match(/^\{([^{}]*)\}$/);if(m){surface="";reading=m[1];}}
  return {kind:"lyric",surface,reading:reading??surface,...boundary};
}
function findTrackBlock(src,name){return findBlocks(src,"track").find(b=>b.name===name)||null;}
function attachLyrics(original,ir,diagnostics){
  const all=[];
  for(const track of ir.tracks||[]){
    const tb=findTrackBlock(original,track.name);if(!tb)continue;
    const lbs=findBlocks(tb.body,"lyrics");if(!lbs.length)continue;
    const notes=(track.events||[]).filter(e=>e.type==="note").sort((a,b)=>a.time-b.time);
    let noteIndex=0,lastLyric=null,pending={wordBoundaryBefore:false,phraseBoundaryBefore:false};
    const language=(tb.body.match(/\bperformance\s+vocal\s*\{[\s\S]*?\blanguage\s*:\s*["']([^"']+)["']/)||[])[1]||"und";
    for(const lb of lbs){
      for(const tok of tokenizeLyrics(lb.body)){
        if(tok==="/"){pending.wordBoundaryBefore=true;continue;}
        if(tok==="|"){pending.phraseBoundaryBefore=true;continue;}
        const e=notes[noteIndex++];if(!e){diagnostics.push({kind:"error",message:`Track ${track.name}: lyrics contain more note-consuming units than notes`});break;}
        const unit=parseLyricToken(tok,pending);pending={wordBoundaryBefore:false,phraseBoundaryBefore:false};
        if(unit.kind==="melisma"){
          if(!lastLyric){diagnostics.push({kind:"error",message:`Track ${track.name}: lyric '_' without previous lyric unit`});}
          unit.continuationOf=lastLyric?.index??null;
        }else if(unit.kind==="lyric")lastLyric={...unit,index:all.length};
        const resolved={...unit,index:all.length,track:track.name,time:e.time,duration:e.duration,language,dialect:"soraoto-vocal-v1"};
        e.lyric=resolved;all.push(resolved);
      }
    }
    track.lyrics=all.filter(x=>x.track===track.name);
  }
  return all;
}
function buildVocalEvents(lyrics){return lyrics.map(x=>({dialect:"soraoto-vocal-v1",kind:x.kind==="none"?"lyric_gap":"lyric",time:x.time,duration:x.duration,track:x.track,language:x.language,surface:x.surface??null,reading:x.reading??null,melisma:!!x.melisma,wordBoundaryBefore:!!x.wordBoundaryBefore,phraseBoundaryBefore:!!x.phraseBoundaryBefore}));}
function browserCapabilities(){return {language:LANGUAGE_VERSION,componentAbi:COMPONENT_ABI,pluginAbi:PLUGIN_ABI,pluginInterfaceSource:"1.0",f64:false,simd128:false,channelLayouts:["mono","stereo"],eventDialects:["soraoto-note-v1","soraoto-vocal-v1"],audioRateModulation:false,factoryPresets:true,noteExpressions:["pitch","pressure","timbre","volume","pan"]};}

window.SoraotoCompiler.compile=function(sourceText){
  const original=String(sourceText||""),preDiagnostics=[];
  if(/\bimport\s+dsp\b/.test(original))preDiagnostics.push({kind:"error",message:"Draft v0.5: import dsp is not supported; use import plugin"});
  const prep=normalizeLetSyntax(original,preDiagnostics);
  const ir=compileFoundation(prep.source);
  const diagnostics=[...(ir.diagnostics||[]),...preDiagnostics];
  const lyrics=attachLyrics(original,ir,diagnostics),imports=parseCanonicalImports(original),patterns=parsePatternMeta(original),macros=parseMacroMeta(original);
  const conformance={language:LANGUAGE_VERSION,componentAbi:COMPONENT_ABI,pluginAbi:PLUGIN_ABI,compileTimeRuntimeBoundary:true,canonicalPluginImport:true,immutableLet:true,eventFragments:true,lyricsDialect:"soraoto-vocal-v1",capabilities:browserCapabilities()};
  const resolvedProjectIR={...(ir.resolvedProjectIR||{}),version:1,languageVersion:LANGUAGE_VERSION,componentAbi:COMPONENT_ABI,pluginAbi:PLUGIN_ABI,imports,lyrics,vocalEvents:buildVocalEvents(lyrics),conformance};
  return {...ir,version:5,languageVersion:LANGUAGE_VERSION,componentAbi:COMPONENT_ABI,pluginAbi:PLUGIN_ABI,imports,bindings:prep.decls.map(d=>({name:d.name,kind:d.kind,immutable:true})),patterns,macros,lyrics,vocalEvents:buildVocalEvents(lyrics),diagnostics,resolvedProjectIR,conformance};
};
window.SoraotoCompiler.version=5;
window.SoraotoCompiler.languageVersion=LANGUAGE_VERSION;
window.SoraotoCompiler.componentAbi=COMPONENT_ABI;
window.SoraotoCompiler.pluginAbi=PLUGIN_ABI;
window.SoraotoCompiler.syntax={normalizeLetSyntax,parseCanonicalImports,parsePatternMeta,parseMacroMeta,tokenizeLyrics};
})();
