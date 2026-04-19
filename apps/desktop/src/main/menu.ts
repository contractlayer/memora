import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '@shared/ipc';
import { BUNDLES, EN_BUNDLE, SUPPORTED_LOCALES, LOCALE_NAMES, type Locale, type StringKey } from '@shared/locales';

// Main-process copy of the translation function. Shares the same bundles as
// the renderer so menu labels stay consistent with the UI.
function translator(locale: Locale) {
  return (key: StringKey): string => {
    const bundle = BUNDLES[locale] ?? {};
    return (bundle as Partial<Record<StringKey, string>>)[key] ?? EN_BUNDLE[key] ?? key;
  };
}

export function buildApplicationMenu(
  locale: Locale,
  mainWindow: BrowserWindow | null,
  onChangeLocale: (next: Locale) => void,
): Menu {
  const t = translator(locale);

  const isMac = process.platform === 'darwin';

  const languageSubmenu: MenuItemConstructorOptions[] = SUPPORTED_LOCALES.map((l) => ({
    label: LOCALE_NAMES[l],
    type: 'radio',
    checked: l === locale,
    click: () => onChangeLocale(l),
  }));

  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about', label: t('menu.app.about') },
      { type: 'separator' },
      {
        label: t('menu.app.preferences'),
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            // Tell the renderer to open its Settings modal. No payload.
            mainWindow.webContents.send(IPC.App.OpenSettings);
          }
        },
      },
      { type: 'separator' },
      { role: 'services', label: t('menu.app.services') },
      { type: 'separator' },
      { role: 'hide', label: t('menu.app.hide') },
      { role: 'hideOthers', label: t('menu.app.hideOthers') },
      { role: 'unhide', label: t('menu.app.showAll') },
      { type: 'separator' },
      { role: 'quit', label: t('menu.app.quit') },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.edit.undo') },
      { role: 'redo', label: t('menu.edit.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'selectAll', label: t('menu.edit.selectAll') },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [
      {
        label: t('menu.view.language'),
        submenu: languageSubmenu,
      },
      { type: 'separator' },
      { role: 'reload', label: t('menu.view.reload') },
      { role: 'toggleDevTools', label: t('menu.view.devtools') },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: t('menu.window'),
    submenu: [
      { role: 'minimize', label: t('menu.window.minimize') },
      { role: 'zoom', label: t('menu.window.zoom') },
      ...(isMac
        ? ([
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' },
          ] as MenuItemConstructorOptions[])
        : ([{ role: 'close' }] as MenuItemConstructorOptions[])),
    ],
  };

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) template.push(appMenu);
  template.push(editMenu, viewMenu, windowMenu, {
    role: 'help',
    submenu: [
      {
        label: 'GitHub',
        click: () => void shell.openExternal('https://github.com/anthropics/claude-code'),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}
