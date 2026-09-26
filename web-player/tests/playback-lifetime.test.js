const fs=require("fs");
const path=require("path");
const R=path.resolve(__dirname,"..");
const lib=fs.readFileSync(path.join(R,"src/js","instrument-library.js"),"utf8");
const app=fs.readFileSync(path.join(R,"src/js","app.js"),"utf8");

function check(x,m){if(!x)throw new Error(m);}

check(lib.includes("function attachVoiceLifetime"),"per-voice lifetime wrapper missing");
check(lib.includes("root.disconnect()"),"voice root is never disconnected");
check(lib.includes('addEventListener("ended",ended'),"voice cleanup is not tied to source end");
check(lib.includes("function scheduleDrumVoice"),"drum lifetime wrapper missing");
check(app.includes("registerScheduledResult(r)"),"playback does not register voice disposers");
check(app.includes("disposeScheduledResults()"),"stop/end does not dispose live voice subgraphs");
check(app.includes("const horizon=ac.currentTime+0.85"),"realtime lookahead is too large");
check(app.includes("setInterval(()=>pumpRealtimeScheduler(ac,ir,startAt,timeOfBeat),50)"),"scheduler pump cadence mismatch");
check(app.includes("rafNow-state.lastUiPaint>=66"),"timeline is not throttled");
check(app.includes("rafNow-state.lastMeterPaint>=100"),"meters are not throttled");

console.log("PASS playback lifetime",{
  voiceSubgraphCleanup:true,
  drumSubgraphCleanup:true,
  lookAheadSeconds:.85,
  schedulerMs:50,
  timelineHz:15,
  meterHz:10
});
