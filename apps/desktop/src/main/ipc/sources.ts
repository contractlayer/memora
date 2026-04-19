import { type IpcMain, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { IPC, type SourceFolder, type SourceKind } from '@shared/ipc';
import { getAppContext } from '@main/app-context';
import { LocalFileConnector } from '@main/connectors/local-fs';

function resolveKind(path: string): SourceKind {
  try {
    return statSync(path).isFile() ? 'file' : 'folder';
  } catch {
    return 'folder';
  }
}

async function registerSource(path: string): Promise<SourceFolder> {
  const ctx = getAppContext();
  const id = randomUUID();
  const addedAt = new Date().toISOString();
  ctx.store.upsertSource({ id, kind: 'local-fs', path, addedAt, lastScan: null });

  const connector = new LocalFileConnector(id, [path]);
  await connector.connect();
  connector.watchChanges((event) => {
    if (event.type === 'add' || event.type === 'change') {
      ctx.indexer.enqueueChange(id, event.path, 'parse');
    } else if (event.type === 'unlink') {
      ctx.indexer.enqueueChange(id, event.path, 'delete');
    }
  });
  ctx.indexer.registerConnector(connector);
  ctx.connectors.set(id, connector);
  void ctx.indexer.enqueueScan(connector);

  return { id, kind: resolveKind(path), path, addedAt, fileCount: 0, indexedCount: 0 };
}

export function registerSourceHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Sources.List, async (): Promise<SourceFolder[]> => {
    const { store } = getAppContext();
    const rows = store.listSources();
    return rows.map((r) => {
      const counts = store.countFilesForSource(r.id);
      return {
        id: r.id,
        kind: resolveKind(r.path),
        path: r.path,
        addedAt: r.addedAt,
        fileCount: counts.total,
        indexedCount: counts.indexed,
      };
    });
  });

  ipcMain.handle(IPC.Sources.AddFolder, async (): Promise<SourceFolder | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Add folder to index',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return registerSource(result.filePaths[0]!);
  });

  ipcMain.handle(IPC.Sources.AddFiles, async (): Promise<SourceFolder[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Add files to index',
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const out: SourceFolder[] = [];
    for (const path of result.filePaths) {
      out.push(await registerSource(path));
    }
    return out;
  });

  ipcMain.handle(IPC.Sources.Remove, async (_e, id: string): Promise<void> => {
    const ctx = getAppContext();
    // Capture file ids BEFORE the SQLite cascade wipes them.
    const files = ctx.store.listFilesForSource(id);
    ctx.connectors.delete(id);
    ctx.store.deleteSource(id);
    // Purge vectors outside the SQLite transaction so LanceDB failures
    // don't roll back the metadata delete.
    for (const f of files) await ctx.vectors.deleteByFileId(f.id);
  });
}
