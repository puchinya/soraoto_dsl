const assert=require('assert'),fs=require('fs'),path=require('path');
const R=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(R,'src/worklets','soraoto-plugin-processor.js'),'utf8');
assert(!/Math\.max\(-4\s*,\s*Math\.min\(4/.test(src),'legacy +/-4 hard clamp remains');
assert(src.includes('!Number.isFinite(rawL)')&&src.includes('!Number.isFinite(rawR)'),'non-finite output guard missing');
console.log('PASS plugin headroom regression');
