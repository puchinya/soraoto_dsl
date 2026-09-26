const fs=require('fs'),path=require('path'),assert=require('assert');const R=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(R,'index.html'),'utf8');
const m=html.match(/window\.SORAOTO_BUILD_ID="([^"]+)"/);assert(m,'build id');const b=m[1];
for(const f of ['plugin-host.js','plugin-registry.js','audio-graph.js'])assert(html.includes(`js/${f}?v=${b}`),`${f} versioned`);
assert(html.indexOf('js/plugin-host.js')<html.indexOf('js/plugin-registry.js'),'host before registry');
assert(html.indexOf('js/plugin-registry.js')<html.indexOf('js/audio-graph.js'),'registry before graph');
assert.notStrictEqual(b,'20260922-playbackfix-1','build id bumped');
console.log('PASS publication plugin registry',b);
