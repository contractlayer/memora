// Golden set runner.
// Loads queries from golden-set.json, runs each through the app's query engine,
// POSTs results to http://localhost:7860/eval (docker-compose ragas-eval service),
// prints MRR@10 and RAGAS metrics, fails CI if regression > 5%.
//
// TODO(Phase 4): full implementation.

async function main(): Promise<void> {
  console.log('[eval] runner stub. Implementation in Phase 4.');
}

void main();
