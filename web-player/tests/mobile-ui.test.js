const fs=require("fs");
const path=require("path");
const R=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(R,"index.html"),"utf8");
const app=fs.readFileSync(path.join(R,"src/js","app.js"),"utf8");
function check(x,m){if(!x)throw new Error(m);}

check(html.includes('viewport-fit=cover'),"safe-area viewport missing");
check(html.includes('env(safe-area-inset-bottom'),"iPhone bottom safe area missing");
check(html.includes('class="mobile-tabs"'),"mobile view tabs missing");
check(html.includes('data-mobile-view="mixer"'),"Mixer tab missing");
check(html.includes('data-mobile-view="source"'),"Source tab missing");
check(html.includes('data-mobile-view="tools"'),"Tools tab missing");
check(html.includes('.transport-controls{position:fixed'),"fixed mobile transport missing");
check(html.includes('min-height:52px'),"mobile transport touch target too small");
check(/#sampleSelect\{[^}]*font-size:16px/.test(html),"iOS select zoom prevention missing");
check(/#editor\{[^}]*font-size:16px/.test(html),"mobile editor zoom prevention missing");
check(app.includes('function setMobileView(view)'),"mobile view controller missing");
check(app.includes('const compact=w<520'),"responsive timeline rendering missing");
check(app.includes('setMobileView("mixer")'),"mobile default view is not Mixer");
check(app.includes('document.createElement("optgroup")'),"category-grouped song selector missing");

check(html.includes('class="song-row persistent-song-picker"'),"persistent song picker missing");
check(html.includes('class="persistent-compile"'),"persistent Compile button missing");
check(html.includes('class="persistent-bpm"'),"persistent BPM control missing");

const tools=html.slice(html.indexOf('id="toolPanel"'),html.indexOf('</section>',html.indexOf('id="toolPanel"')));
check(!tools.includes('id="compileBtn"'),"Compile must not be inside Tools");
check(!tools.includes('id="tempoInput"'),"BPM must not be inside Tools");
check(html.indexOf('id="compileBtn"') < html.indexOf('id="toolPanel"'),"Compile must be always-visible before Tools");
check(html.indexOf('id="tempoInput"') < html.indexOf('id="toolPanel"'),"BPM must be always-visible before Tools");

check(html.includes('class="persistent-controls"'),"standalone persistent controls bar missing");
check(html.includes('class="persistent-control-label">曲選択</div>'),"visible song selection label missing");
check(/#sampleSelect\{[^}]*display:block!important;[^}]*visibility:visible!important/.test(html),"song select is not forcibly visible on mobile");
check(/\.persistent-controls\{position:relative;top:auto;z-index:30;flex:0 0 auto/.test(html),"persistent controls must stay fixed in the app flex flow");
check(!/\.mobile-tabs\{display:flex;position:sticky;top:96px/.test(html),"obsolete tab top offset remains");
console.log("PASS mobile UI",{
  bottomTransport:true,
  safeArea:true,
  views:["mixer","source","tools"],
  touchTargets:true,
  compactTimeline:true,
  persistentSong:true,
  persistentCompile:true,
  persistentBpm:true
});
