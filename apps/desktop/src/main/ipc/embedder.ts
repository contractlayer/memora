import type { IpcMain } from 'electron';
import { IPC, type EmbedderStatus } from '@shared/ipc';
import { getAppContext } from '@main/app-context';

export function registerEmbedderHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Embedder.Status, async (): Promise<EmbedderStatus> => {
    const { embedder, vectors, store } = getAppContext();
    let totalVectors = 0;
    try {
      totalVectors = await vectors.count();
    } catch (err) {
      console.error('[embedder:status] vectors.count failed:', err);
    }
    return {
      model: embedder.modelName,
      ready: embedder.isReady(),
      totalVectors,
      pendingChunks: store.countPendingVectorChunks(),
    };
  });
}
