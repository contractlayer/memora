import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type QueryAskRequest, type SourceFolder } from '../shared/ipc';

const api = {
  query: {
    ask: (req: QueryAskRequest) => ipcRenderer.invoke(IPC.Query.Ask, req),
  },
  sources: {
    list: (): Promise<SourceFolder[]> => ipcRenderer.invoke(IPC.Sources.List),
    add: (path: string) => ipcRenderer.invoke(IPC.Sources.Add, path),
    remove: (id: string) => ipcRenderer.invoke(IPC.Sources.Remove, id),
  },
  index: {
    status: () => ipcRenderer.invoke(IPC.Index.Status),
  },
  app: {
    openCitation: (path: string) => ipcRenderer.invoke(IPC.App.OpenCitation, path),
  },
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
