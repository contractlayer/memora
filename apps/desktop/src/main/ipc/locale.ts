import type { BrowserWindow, IpcMain } from 'electron';
import { IPC } from '@shared/ipc';
import { getAppContext } from '@main/app-context';

export function registerLocaleHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null,
  rebuildMenu: (locale: string) => void,
): void {
  ipcMain.handle(IPC.Locale.Get, async () => {
    const { settings } = getAppContext();
    return settings.getLocale();
  });

  ipcMain.handle(IPC.Locale.Set, async (_e, locale: string) => {
    const { settings } = getAppContext();
    await settings.setLocale(locale);
    rebuildMenu(locale);
    // Broadcast to all windows so any open secondary window reacts too.
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.Locale.Changed, locale);
    }
  });
}
