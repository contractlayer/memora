import type { IpcMain } from 'electron';
import { IPC, type IndexStatus } from '@shared/ipc';
import { getAppContext } from '@main/app-context';

export function registerIndexHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Index.Status, async (): Promise<IndexStatus> => {
    const { store, indexer } = getAppContext();
    const { queued, inFlight } = store.queueStats();
    return {
      queued,
      inFlight,
      completedToday: 0,
      totalChunks: store.countChunks(),
      totalFiles: store.countFiles(),
      indexedFiles: store.countIndexedFiles(),
      totalSources: store.listSources().length,
      lastIndexedAt: store.getLastIndexedAt(),
      currentFile: indexer.getCurrentFile(),
    };
  });
}
