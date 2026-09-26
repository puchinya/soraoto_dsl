const fs=require('fs');
const path=require('path');
const R=path.resolve(__dirname,'..');
function check(v,m){if(!v)throw new Error(m);}

const html=fs.readFileSync(path.join(R,'index.html'),'utf8');
const app=fs.readFileSync(path.join(R,'src/js','app.js'),'utf8');
const host=fs.readFileSync(path.join(R,'src/js','plugin-host.js'),'utf8');

const build=html.match(/window\.SORAOTO_BUILD_ID="([^"]+)"/)?.[1];
check(build,'missing SORAOTO_BUILD_ID');
const versions=[...html.matchAll(/<script src="[^"]+\?v=([^"]+)"/g)].map(m=>m[1]);
check(versions.length>=8,`expected versioned scripts, got ${versions.length}`);
check(versions.every(v=>v===build),`mixed script generations: build=${build}, scripts=${[...new Set(versions)].join(',')}`);

check(/const build=String\(window\.SORAOTO_BUILD_ID\|\|"dev"\),key=`\$\{build\}\\u0000\$\{String\(url\)\}`/.test(host),'plugin cache key is not build-scoped');
check(/fetch\(versioned\(url\),\{cache:"no-store"\}\)/.test(host),'plugin fetch lost no-store/versioning');

check(/async function stopPlayback\(updateStatus=true\)/.test(app),'stopPlayback is not async');
check(/setUiMode\("stopping","Stopping audio…"\)/.test(app),'stop does not enter stopping state');
check(/await disposeActiveGraph\(\)/.test(app),'stop does not await graph disposal');
check(/await \(state\.graphDisposePromise\|\|Promise\.resolve\(\)\)/.test(app),'play does not serialize against previous graph disposal');
check(/\["compiling","loading","starting","stopping","rendering","exporting"\]/.test(app),'stopping is not a busy UI state');

console.log('PASS runtime generation regression',{build,versionedScripts:versions.length});
