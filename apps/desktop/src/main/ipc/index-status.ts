import type { IpcMain } from 'electron';
import { IPC, type IndexStatus } from '@shared/ipc';
import { getAppContext } from '@main/app-context';

export function registerIndexHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Index.Status, async (): Promise<IndexStatus> => {
    const { store } = getAppContext();
    const { queued, inFlight } = store.queueStats();
    const totalChunks = store.countChunks();
    return { queued, inFlight, completedToday: 0, totalChunks };
  });
}
