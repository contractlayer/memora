import { app, type IpcMain } from 'electron';
import { access, stat, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '@shared/ipc';
import { getAppContext } from '@main/app-context';

export type OnboardingCandidate = {
  path: string;
  label: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  /** True if scanning bailed early because the folder is huge. */
  truncated: boolean;
  /** Recommended default for the checkbox (false if too large). */
  recommended: boolean;
};

// Cap the recursive scan to keep first-run fast even for a 100k-file Documents.
const SCAN_FILE_CAP = 20_000;
const RECOMMEND_SIZE_CAP = 5 * 1024 * 1024 * 1024; // 5 GB
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  'dist',
  'build',
  '.next',
  'target',
  'Library', // macOS user Library — not what users mean by "Documents"
]);

export function registerOnboardingHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Onboarding.Status, async () => {
    const { settings } = getAppContext();
    return { onboarded: settings.isOnboarded() };
  });

  ipcMain.handle(
    IPC.Onboarding.ScanCandidates,
    async (): Promise<OnboardingCandidate[]> => {
      // Electron knows the Known Folders on Windows + the standard dirs on
      // macOS/Linux, so this works cross-platform without homedir munging.
      const targets: { path: string; label: string }[] = [];
      for (const key of ['desktop', 'downloads', 'documents'] as const) {
        try {
          const path = app.getPath(key);
          targets.push({ path, label: capitalize(key) });
        } catch {
          // Path not configured on this OS — skip.
        }
      }

      return Promise.all(targets.map((t) => scanCandidate(t.path, t.label)));
    },
  );

  ipcMain.handle(IPC.Onboarding.MarkDone, async () => {
    const { settings } = getAppContext();
    await settings.markOnboarded();
  });
}

async function scanCandidate(path: string, label: string): Promise<OnboardingCandidate> {
  try {
    await access(path);
  } catch {
    return { path, label, exists: false, fileCount: 0, totalBytes: 0, truncated: false, recommended: false };
  }
  const result = { fileCount: 0, totalBytes: 0, truncated: false };
  await walk(path, result);
  const recommended = !result.truncated && result.totalBytes < RECOMMEND_SIZE_CAP;
  return {
    path,
    label,
    exists: true,
    fileCount: result.fileCount,
    totalBytes: result.totalBytes,
    truncated: result.truncated,
    recommended,
  };
}

async function walk(
  dir: string,
  acc: { fileCount: number; totalBytes: number; truncated: boolean },
): Promise<void> {
  if (acc.truncated) return;
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.fileCount >= SCAN_FILE_CAP) {
      acc.truncated = true;
      return;
    }
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(full, acc);
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        acc.fileCount += 1;
        acc.totalBytes += s.size;
      } catch {
        // swallow — dead symlink or permission denied
      }
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
