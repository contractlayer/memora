import { app, BrowserWindow, dialog, shell } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

// Wire electron-updater against the GitHub Releases feed configured in
// electron-builder.yml. We surface: a silent background check, a notify-
// when-ready dialog, and OS-level error logging. No auto-install — the
// user clicks "Restart" to apply.
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // Dev builds have no `app-update.yml` alongside the binary, so any
  // check would throw. Skip entirely when not packaged.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => console.log('[updater]', m),
    warn: (m: unknown) => console.warn('[updater]', m),
    error: (m: unknown) => console.error('[updater]', m),
    debug: () => {},
  } as typeof autoUpdater.logger;

  autoUpdater.on('error', (err) => {
    console.error('[updater] error', err);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow();
    const result = await dialog.showMessageBox(win ?? undefined!, {
      type: 'info',
      title: 'Update ready',
      message: `Memora ${info.version} is ready to install.`,
      detail: 'The update will apply the next time you launch Memora — or restart now.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      // isSilent = false + isForceRunAfter = true → quit, install, reopen.
      autoUpdater.quitAndInstall(false, true);
    }
  });

  // Kick off the first check shortly after launch so the app has already
  // rendered its window. Re-check every 4h while running.
  const kick = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check failed:', err);
    });
  };
  setTimeout(kick, 10_000);
  setInterval(kick, 4 * 60 * 60 * 1000);
}

// Opens the GitHub Releases page — fallback for users whose auto-update
// fails (unsigned mac builds, corporate proxies, etc.).
export function openReleasesPage(): Promise<void> {
  return shell.openExternal('https://github.com/contractlayer/memora/releases');
}
