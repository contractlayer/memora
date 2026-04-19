import type { IpcMain } from 'electron';
import { IPC, type QueryAskRequest, type QueryAskResponse } from '@shared/ipc';

export function registerQueryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC.Query.Ask,
    async (_e, req: QueryAskRequest): Promise<QueryAskResponse> => {
      return {
        answer: `[stub] Received question: "${req.question}". Query engine lands in Phase 2.`,
        citations: [],
      };
    },
  );
}
