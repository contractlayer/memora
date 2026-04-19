import type { IpcMain } from 'electron';
import {
  IPC,
  type ConversationFull,
  type ConversationSummary,
} from '@shared/ipc';
import { getAppContext } from '@main/app-context';

export function registerConversationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Conversations.List, async (): Promise<ConversationSummary[]> => {
    const { store } = getAppContext();
    return store.listConversations();
  });

  ipcMain.handle(
    IPC.Conversations.Get,
    async (_e, id: string): Promise<ConversationFull | null> => {
      const { store } = getAppContext();
      const row = store.getConversation(id);
      if (!row) return null;
      let turns: ConversationFull['turns'] = [];
      try {
        turns = JSON.parse(row.turnsJson);
      } catch (err) {
        console.warn('[conversations] failed to parse turns_json for', id, err);
      }
      return {
        id: row.id,
        title: row.title,
        turns,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
  );

  ipcMain.handle(
    IPC.Conversations.Save,
    async (
      _e,
      payload: { id: string; title: string; turns: ConversationFull['turns'] },
    ): Promise<void> => {
      const { store } = getAppContext();
      store.upsertConversation({
        id: payload.id,
        title: payload.title,
        turnsJson: JSON.stringify(payload.turns),
      });
    },
  );

  ipcMain.handle(
    IPC.Conversations.Rename,
    async (_e, id: string, title: string): Promise<void> => {
      const { store } = getAppContext();
      store.renameConversation(id, title);
    },
  );

  ipcMain.handle(IPC.Conversations.Delete, async (_e, id: string): Promise<void> => {
    const { store } = getAppContext();
    store.deleteConversation(id);
  });
}
