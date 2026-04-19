import { loadavg, cpus } from 'node:os';

// Pause indexing work when the machine is busy so the app doesn't spin the
// fan while the user is trying to do other things. Uses 1-minute load average
// divided by core count. On Windows loadavg() always returns [0, 0, 0], so
// throttling is effectively a no-op there — acceptable for v1.

const DEFAULT_THRESHOLD = 0.7;   // load ratio above which we sleep
const PAUSE_MS = 2_000;          // sleep length per check
const MAX_CONSECUTIVE_PAUSES = 3; // after this, proceed anyway so queue never deadlocks

let loggedWindowsNoop = false;

export async function awaitCpuBelow(
  threshold: number = DEFAULT_THRESHOLD,
  label = 'worker',
): Promise<void> {
  const coreCount = cpus().length || 1;
  for (let i = 0; i < MAX_CONSECUTIVE_PAUSES; i++) {
    const load1 = loadavg()[0] ?? 0;
    if (load1 === 0) {
      // Unsupported platform (Windows) — throttle is a no-op.
      if (!loggedWindowsNoop) {
        loggedWindowsNoop = true;
        console.log('[cpu-throttle] loadavg unsupported on this platform — skipping');
      }
      return;
    }
    const ratio = load1 / coreCount;
    if (ratio <= threshold) return;
    console.log(
      `[cpu-throttle:${label}] load ${ratio.toFixed(2)} > ${threshold} → sleep ${PAUSE_MS}ms`,
    );
    await sleep(PAUSE_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
