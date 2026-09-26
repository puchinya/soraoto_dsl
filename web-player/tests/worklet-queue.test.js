const fs=require("fs");const path=require("path");const R=path.resolve(__dirname,"..");
const w=fs.readFileSync(path.join(R,"src/worklets","soraoto-plugin-processor.js"),"utf8");
function check(x,m){if(!x)throw new Error(m);}
check(w.includes("this.queueHead=0"),"queue head index missing");check(w.includes("this.queueDirty"),"dirty flag missing");check(!w.includes("this.queue.shift()"),"O(n) shift remains");check(w.includes("this.queue=this.queue.slice(this.queueHead)"),"queue compaction missing");
check(w.includes("PB_SIZE = 176"),"ProcessBlock v1 size missing");check(w.includes("PARAM_SIZE = 24"),"ParameterPoint v1 size missing");check(w.includes("EVENT_SIZE = 64"),"RealtimeEvent v1 size missing");
console.log("PASS worklet queue",{shift:false,headIndex:true,pluginAbi:1});
