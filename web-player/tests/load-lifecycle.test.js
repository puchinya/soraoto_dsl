const fs=require('fs');const path=require('path');const R=path.resolve(__dirname,'..');
function check(x,m){if(!x)throw new Error(m);}
const app=fs.readFileSync(path.join(R,'src/js/app.js'),'utf8'),graph=fs.readFileSync(path.join(R,'src/js/audio-graph.js'),'utf8'),host=fs.readFileSync(path.join(R,'src/js/plugin-host.js'),'utf8'),worklet=fs.readFileSync(path.join(R,'src/worklets/soraoto-plugin-processor.js'),'utf8');
const load=app.slice(app.indexOf('async function loadSelectedServerSong'),app.indexOf('function ensureAudio'));
check(load.indexOf('setUiMode("loading"')<load.indexOf('await releaseProjectAudioContext()'),'Load lock must be acquired before async teardown');
const rel=app.slice(app.indexOf('async function releaseProjectAudioContext'),app.indexOf('async function loadSelectedServerSong'));
check(rel.includes('clearScheduler()'),'scheduler not cleared on project release');check(rel.includes('await disposeActiveGraph()'),'graph disposal not awaited');check(rel.includes('state.audioBuffers.clear()'),'AudioBuffer cache not cleared');check(rel.indexOf('await disposeActiveGraph()')<rel.indexOf('await ac.close()'),'AudioContext closes before plugin dispose');
check(app.includes('graphDisposePromise:Promise.resolve()'),'pending graph dispose not tracked');check(graph.includes('await Promise.allSettled(pending)'),'graph does not await plugin disposals');check(host.includes('d.type==="disposed"')&&host.includes('disposeTimer=setTimeout'),'PluginHost missing dispose ACK/fallback');
for(const token of ['soraoto_plugin_stop_processing','soraoto_plugin_deactivate','soraoto_free','soraoto_plugin_terminate'])check(worklet.includes(token),`Worklet cleanup missing ${token}`);
console.log('PASS load lifecycle teardown contract');
