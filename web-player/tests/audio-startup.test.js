const fs=require("fs");const path=require("path");const R=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(R,"src/js","app.js"),"utf8");
const host=fs.readFileSync(path.join(R,"src/js","plugin-host.js"),"utf8");
const worklet=fs.readFileSync(path.join(R,"src/worklets","soraoto-plugin-processor.js"),"utf8");
function check(x,m){if(!x)throw new Error(m);}
check(worklet.includes('postMessage({type:"ready",abi:ABI'),"processor ready handshake missing");
check(worklet.includes('postMessage({type:"error",message:'),"processor error reporting missing");
check(host.includes('Plugin init timeout'),"host readiness timeout missing");
check(host.includes('await ready'),"host returns node before processor ready");
check(host.includes('soraoto.plugin.v1'),"descriptor custom-section validation missing");
check(host.includes('Legacy Plugin ABI export is forbidden'),"legacy ABI rejection missing");
const unlock=app.indexOf("function unlockAudioFromGesture()");const keep=app.indexOf("startAudioKeepAlive(ac)",unlock);const resume=app.indexOf("ac.resume()",unlock);
check(keep>unlock&&keep<resume,"iOS keep-alive must start before async setup");
check(app.includes('if(ac.state!=="running")'),"post-graph AudioContext state is not verified");
check(app.includes('Audio graph ready · scheduling…'),"graph-ready startup phase missing");
console.log("PASS audio startup",{pluginAbi:true,processorHandshake:true,iosKeepAlive:true});
