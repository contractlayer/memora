import type { IpcMain } from 'electron';
import {
  IPC,
  type QueryAskRequest,
  type QueryAskResponse,
  type QueryStreamStartRequest,
  type QueryStreamEvent,
} from '@shared/ipc';
import { getAppContext } from '@main/app-context';
import { QueryOrchestrator } from '@main/services/query';

// Track inflight streams so aborts from the renderer can cancel them.
const activeStreams = new Map<string, { aborted: boolean }>();

export function registerQueryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC.Query.Ask,
    async (_e, req: QueryAskRequest): Promise<QueryAskResponse> => {
      const orchestrator = buildOrchestrator();
      return orchestrator.ask(req);
    },
  );

  ipcMain.handle(
    IPC.Query.StreamStart,
    async (event, req: QueryStreamStartRequest): Promise<void> => {
      const { streamId } = req;
      const orchestrator = buildOrchestrator();
      const marker = { aborted: false };
      activeStreams.set(streamId, marker);
      const sender = event.sender;

      const send = (evt: QueryStreamEvent): void => {
        if (sender.isDestroyed()) return;
        sender.send(IPC.Query.StreamEvent, { streamId, event: evt });
      };

      try {
        for await (const chunk of orchestrator.askStream(req)) {
          if (marker.aborted) break;
          send(chunk);
          if (chunk.type === 'done') break;
        }
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        activeStreams.delete(streamId);
      }
    },
  );

  ipcMain.handle(IPC.Query.StreamAbort, (_e, streamId: string) => {
    const marker = activeStreams.get(streamId);
    if (marker) marker.aborted = true;
  });
}

function buildOrchestrator(): QueryOrchestrator {
  const { store, embedder, vectors, llmRouter, reranker } = getAppContext();
  return new QueryOrchestrator(store, embedder, vectors, llmRouter, reranker);
}
