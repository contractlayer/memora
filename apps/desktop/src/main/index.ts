import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';

// Log unhandled rejections once instead of letting Node spam warnings.
// Chokidar EMFILE / volume-unmount / permission errors should not take
// down the app — we just record and carry on.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// Electron-specific: surface render process / child process crashes which
// otherwise manifest as a silent white window.
app.on('render-process-gone', (_e, _wc, details) => {
  console.error('[render-process-gone]', details);
});
app.on('child-process-gone', (_e, details) => {
  console.error('[child-process-gone]', details);
});
import { IPC } from '@shared/ipc';
import { registerQueryHandlers } from './ipc/query';
import { registerSourceHandlers } from './ipc/sources';
import { registerIndexHandlers } from './ipc/index-status';
import { registerEmbedderHandlers } from './ipc/embedder';
import { registerSettingsHandlers } from './ipc/settings';
import { registerOnboardingHandlers } from './ipc/onboarding';
import { registerLocaleHandlers } from './ipc/locale';
import { registerConversationHandlers } from './ipc/conversations';
import { initAppContext, getAppContext, shutdownAppContext } from './app-context';
import { buildApplicationMenu } from './menu';
import { Menu } from 'electron';
import type { Locale } from '@shared/locales';
import { SUPPORTED_LOCALES } from '@shared/locales';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    icon: join(__dirname, '../../../../resources/icons/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  await initAppContext();

  registerQueryHandlers(ipcMain);
  registerSourceHandlers(ipcMain);
  registerIndexHandlers(ipcMain);
  registerEmbedderHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  registerOnboardingHandlers(ipcMain);
  registerConversationHandlers(ipcMain);

  const applyMenuForLocale = (locale: string) => {
    const safeLocale = isSupportedLocale(locale) ? locale : 'en';
    const menu = buildApplicationMenu(safeLocale, mainWindow, (next) => {
      // User picked a language from the menu — persist + broadcast to renderer.
      void getAppContext().settings.setLocale(next);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.Locale.Changed, next);
      }
      applyMenuForLocale(next);
    });
    Menu.setApplicationMenu(menu);
  };

  registerLocaleHandlers(ipcMain, () => mainWindow, applyMenuForLocale);

  ipcMain.handle(IPC.App.OpenCitation, async (_e, path: string) => {
    await shell.openPath(path);
  });

  createWindow();
  applyMenuForLocale(getAppContext().settings.getLocale());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function isSupportedLocale(l: string): l is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(l);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  e.preventDefault();
  await shutdownAppContext();
  app.exit(0);
});
