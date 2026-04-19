import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type ConversationFull,
  type ConversationSummary,
  type LlmProvider,
  type LlmSettings,
  type LlmTestResult,
  type OnboardingCandidate,
  type OnboardingStatus,
  type QueryAskRequest,
  type QueryStreamEvent,
  type SourceFolder,
} from '../shared/ipc';

const api = {
  query: {
    ask: (req: QueryAskRequest) => ipcRenderer.invoke(IPC.Query.Ask, req),
    askStream: (
      req: QueryAskRequest,
      onEvent: (evt: QueryStreamEvent) => void,
    ): { abort: () => void; done: Promise<void> } => {
      const streamId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: { streamId: string; event: QueryStreamEvent },
      ): void => {
        if (payload.streamId !== streamId) return;
        onEvent(payload.event);
      };
      ipcRenderer.on(IPC.Query.StreamEvent, listener);
      const done = ipcRenderer
        .invoke(IPC.Query.StreamStart, { ...req, streamId })
        .finally(() => ipcRenderer.removeListener(IPC.Query.StreamEvent, listener));
      return {
        abort: () => void ipcRenderer.invoke(IPC.Query.StreamAbort, streamId),
        done,
      };
    },
  },
  sources: {
    list: (): Promise<SourceFolder[]> => ipcRenderer.invoke(IPC.Sources.List),
    addFolder: (): Promise<SourceFolder | null> => ipcRenderer.invoke(IPC.Sources.AddFolder),
    addFiles: (): Promise<SourceFolder[]> => ipcRenderer.invoke(IPC.Sources.AddFiles),
    addByPath: (path: string): Promise<SourceFolder> =>
      ipcRenderer.invoke(IPC.Sources.AddByPath, path),
    remove: (id: string) => ipcRenderer.invoke(IPC.Sources.Remove, id),
  },
  onboarding: {
    status: (): Promise<OnboardingStatus> => ipcRenderer.invoke(IPC.Onboarding.Status),
    scanCandidates: (): Promise<OnboardingCandidate[]> =>
      ipcRenderer.invoke(IPC.Onboarding.ScanCandidates),
    markDone: (): Promise<void> => ipcRenderer.invoke(IPC.Onboarding.MarkDone),
  },
  locale: {
    get: (): Promise<string> => ipcRenderer.invoke(IPC.Locale.Get),
    set: (locale: string): Promise<void> => ipcRenderer.invoke(IPC.Locale.Set, locale),
    onChanged: (handler: (locale: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, locale: string): void => handler(locale);
      ipcRenderer.on(IPC.Locale.Changed, listener);
      return () => ipcRenderer.removeListener(IPC.Locale.Changed, listener);
    },
  },
  conversations: {
    list: (): Promise<ConversationSummary[]> =>
      ipcRenderer.invoke(IPC.Conversations.List),
    get: (id: string): Promise<ConversationFull | null> =>
      ipcRenderer.invoke(IPC.Conversations.Get, id),
    save: (payload: {
      id: string;
      title: string;
      turns: ConversationFull['turns'];
    }): Promise<void> => ipcRenderer.invoke(IPC.Conversations.Save, payload),
    rename: (id: string, title: string): Promise<void> =>
      ipcRenderer.invoke(IPC.Conversations.Rename, id, title),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.Conversations.Delete, id),
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
    onOpenSettings: (handler: () => void): (() => void) => {
      const listener = (): void => handler();
      ipcRenderer.on(IPC.App.OpenSettings, listener);
      return () => ipcRenderer.removeListener(IPC.App.OpenSettings, listener);
    },
  },
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
