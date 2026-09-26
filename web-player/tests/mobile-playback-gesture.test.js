const fs=require("fs");
const path=require("path");
const R=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(R,"src/js","app.js"),"utf8");
function check(x,m){if(!x)throw new Error(m);}

const playStart=app.indexOf("async function play()");
const firstAwait=app.indexOf("await nextPaint()",playStart);
const unlock=app.indexOf("const unlocked=unlockAudioFromGesture()",playStart);
check(playStart>=0,"play() missing");
check(unlock>playStart&&unlock<firstAwait,"AudioContext must unlock before first await");
check(app.includes('if (!state.audio || state.audio.state === "closed")'),"closed AudioContext recovery missing");
check(app.includes('ac.state==="suspended"||ac.state==="interrupted"'),"iOS suspended/interrupted resume handling missing");
check(app.includes("await unlocked.resumePromise"),"resume promise is not awaited before graph preparation");
check(app.includes("ready to play"),"Load does not report playback readiness");

console.log("PASS mobile playback gesture",{
  synchronousUnlock:true,
  suspendedRecovery:true,
  interruptedRecovery:true,
  loadReadyState:true
});
