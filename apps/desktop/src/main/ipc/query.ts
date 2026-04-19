import type { IpcMain } from 'electron';
import { IPC, type QueryAskRequest, type QueryAskResponse } from '@shared/ipc';
import { getAppContext } from '@main/app-context';
import { QueryOrchestrator } from '@main/services/query';

export function registerQueryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC.Query.Ask,
    async (_e, req: QueryAskRequest): Promise<QueryAskResponse> => {
      const { store, embedder, vectors, llmRouter } = getAppContext();
      const orchestrator = new QueryOrchestrator(store, embedder, vectors, llmRouter);
      return orchestrator.ask(req);
    },
  );
}
