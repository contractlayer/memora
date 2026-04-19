import type { IpcMain } from 'electron';
import { IPC, type SourceFolder } from '@shared/ipc';

const sources: SourceFolder[] = [];

export function registerSourceHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Sources.List, async (): Promise<SourceFolder[]> => sources);

  ipcMain.handle(IPC.Sources.Add, async (_e, path: string): Promise<SourceFolder> => {
    const folder: SourceFolder = {
      id: crypto.randomUUID(),
      path,
      addedAt: new Date().toISOString(),
      fileCount: 0,
      indexedCount: 0,
    };
    sources.push(folder);
    return folder;
  });

  ipcMain.handle(IPC.Sources.Remove, async (_e, id: string): Promise<void> => {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx >= 0) sources.splice(idx, 1);
  });
}
