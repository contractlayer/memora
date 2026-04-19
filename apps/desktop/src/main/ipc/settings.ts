import type { IpcMain } from 'electron';
import {
  IPC,
  type LlmProvider,
  type LlmSettings,
  type LlmTestResult,
} from '@shared/ipc';
import { getAppContext } from '@main/app-context';
import { LlmRouter, KNOWN_MODELS, listOllamaModels } from '@main/services/llm-router';

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.Settings.GetLlm, async (): Promise<LlmSettings> => {
    const { settings } = getAppContext();
    return settings.getLlm();
  });

  ipcMain.handle(
    IPC.Settings.SetLlm,
    async (_e, next: LlmSettings): Promise<void> => {
      const { settings } = getAppContext();
      await settings.setLlm(next);
    },
  );

  ipcMain.handle(
    IPC.Settings.HasApiKey,
    async (_e, provider: LlmProvider): Promise<boolean> => {
      const { settings } = getAppContext();
      const key = await settings.getApiKey(provider);
      return key !== null && key.length > 0;
    },
  );

  ipcMain.handle(
    IPC.Settings.SetApiKey,
    async (_e, provider: LlmProvider, key: string): Promise<void> => {
      const { settings } = getAppContext();
      await settings.setApiKey(provider, key);
    },
  );

  ipcMain.handle(IPC.Settings.TestLlm, async (): Promise<LlmTestResult> => {
    const { settings } = getAppContext();
    const router = new LlmRouter(settings);
    const client = await router.resolve();
    if (!client) {
      return { ok: false, error: 'No provider configured or API key missing' };
    }
    return client.test();
  });

  ipcMain.handle(
    IPC.Settings.ListModels,
    async (_e, provider: LlmProvider, baseUrl?: string): Promise<string[]> => {
      if (provider === 'none') return [];
      if (provider === 'ollama') {
        return listOllamaModels(baseUrl ?? 'http://localhost:11434');
      }
      return KNOWN_MODELS[provider] ?? [];
    },
  );
}
