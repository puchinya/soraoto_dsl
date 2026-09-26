const fs=require("fs");
const path=require("path");
const R=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(R,"index.html"),"utf8");
function check(x,m){if(!x)throw new Error(m);}

check(html.includes('html,body{width:100%;height:100%;overflow:hidden}'),
  "mobile body must not be a scroll container");
check(/\.app\{width:100%;height:100dvh;min-height:0;display:flex;flex-direction:column;[\s\S]*?overflow:hidden;[\s\S]*?padding-bottom:calc\(70px \+ var\(--safe-bottom\)\)/.test(html),
  "mobile app must be a fixed viewport flex column");
check(/main\{display:block;flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;/.test(html),
  "mobile main must be the single page-content scroll viewport");
check(/\.app\.mobile-view-source main\{overflow:hidden\}/.test(html),
  "source view must not double-scroll main + editor");
check(/#editor\{height:100%;min-height:0;flex:1 1 auto;[\s\S]*?overflow:auto/.test(html),
  "source editor must own source scrolling");
check(!html.includes("min-height:calc(100dvh - 250px)"),
  "legacy synthetic editor height still creates phantom scroll");
check(!/\.persistent-controls\{position:sticky/.test(html),
  "persistent controls must stay in flex flow, not sticky body flow");
check(/grid-template-rows:auto auto auto minmax\(0,1fr\) auto/.test(html),
  "desktop app grid rows do not match actual content");
check(/main\{min-height:0;overflow:hidden;display:grid/.test(html),
  "desktop main overflow boundary missing");

console.log("PASS mobile scroll",{
  bodyScroll:false,
  mobileScrollContainer:"main",
  sourceScrollContainer:"editor",
  fixedTransportReserved:true,
  phantomViewportHeightRemoved:true,
  desktopGridRowsFixed:true
});
