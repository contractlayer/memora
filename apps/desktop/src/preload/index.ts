import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type LlmProvider,
  type LlmSettings,
  type LlmTestResult,
  type QueryAskRequest,
  type SourceFolder,
} from '../shared/ipc';

const api = {
  query: {
    ask: (req: QueryAskRequest) => ipcRenderer.invoke(IPC.Query.Ask, req),
  },
  sources: {
    list: (): Promise<SourceFolder[]> => ipcRenderer.invoke(IPC.Sources.List),
    addFolder: (): Promise<SourceFolder | null> => ipcRenderer.invoke(IPC.Sources.AddFolder),
    addFiles: (): Promise<SourceFolder[]> => ipcRenderer.invoke(IPC.Sources.AddFiles),
    remove: (id: string) => ipcRenderer.invoke(IPC.Sources.Remove, id),
  },
  index: {
    status: () => ipcRenderer.invoke(IPC.Index.Status),
  },
  embedder: {
    status: () => ipcRenderer.invoke(IPC.Embedder.Status),
  },
  settings: {
    getLlm: (): Promise<LlmSettings> => ipcRenderer.invoke(IPC.Settings.GetLlm),
    setLlm: (s: LlmSettings): Promise<void> => ipcRenderer.invoke(IPC.Settings.SetLlm, s),
    hasApiKey: (p: LlmProvider): Promise<boolean> =>
      ipcRenderer.invoke(IPC.Settings.HasApiKey, p),
    setApiKey: (p: LlmProvider, key: string): Promise<void> =>
      ipcRenderer.invoke(IPC.Settings.SetApiKey, p, key),
    testLlm: (): Promise<LlmTestResult> => ipcRenderer.invoke(IPC.Settings.TestLlm),
    listModels: (p: LlmProvider, baseUrl?: string): Promise<string[]> =>
      ipcRenderer.invoke(IPC.Settings.ListModels, p, baseUrl),
  },
  app: {
    openCitation: (path: string) => ipcRenderer.invoke(IPC.App.OpenCitation, path),
  },
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
