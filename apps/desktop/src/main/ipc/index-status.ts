import type { IpcMain } from 'electron';
import { IPC, type IndexStatus } from '@shared/ipc';

export function registerIndexHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC.Index.Status,
    async (): Promise<IndexStatus> => ({
      queued: 0,
      inFlight: 0,
      completedToday: 0,
      totalChunks: 0,
    }),
  );
}
