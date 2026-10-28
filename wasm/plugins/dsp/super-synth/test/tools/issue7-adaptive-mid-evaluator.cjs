'use strict';

const stage3e=require('./run-issue7-stage3e-current-build.cjs');

function evaluateProbe(rows,fixture){
  const result=stage3e.evaluateMidi51(rows,fixture);
  if(result.safe!==true||result.diagnosticsComplete!==true||!Number.isFinite(result.span?.errorDb))
    return {...result,adaptiveOutcome:'BLOCKED'};
  return {...result,adaptiveOutcome:result.span.errorDb<=8?'PASS':'FAIL'};
}
function evaluateScreen(cells,rows,fixture){return stage3e.evaluateScreen('mid-screen',cells,rows,fixture);}
function evaluateFull(cells,rows,fixture){return stage3e.evaluateFull('mid-full',cells,rows,fixture);}

module.exports={evaluateProbe,evaluateScreen,evaluateFull};
