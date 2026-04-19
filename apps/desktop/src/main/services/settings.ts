import { app, safeStorage } from 'electron';
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export type LlmProvider = 'none' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export type LlmSettings = {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
};

// API keys are persisted separately via Electron safeStorage (backed by
// macOS Keychain / Windows DPAPI / libsecret). Never serialized in plaintext.
const DEFAULT_SETTINGS: LlmSettings = {
  provider: 'none',
  model: '',
};

const SETTINGS_FILENAME = 'settings.json';
const API_KEY_FILENAME_PREFIX = 'apikey.';

export class SettingsStore {
  private cache: LlmSettings = DEFAULT_SETTINGS;

  async init(): Promise<void> {
    await this.migrateFromLegacyUserData();
    try {
      const raw = await readFile(this.settingsPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LlmSettings>;
      this.cache = { ...DEFAULT_SETTINGS, ...parsed };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      console.warn('[settings] failed to load, using defaults:', err);
    }
  }

  // Early builds of the app used the raw npm package name '@ai-search/desktop'
  // as Electron's userData dir. Adding `productName: "Memora"` switched the
  // dir to 'Memora', orphaning the user's settings + encrypted API keys.
  // On first launch in the new dir, copy them across.
  private async migrateFromLegacyUserData(): Promise<void> {
    const currentSettings = this.settingsPath();
    try {
      await access(currentSettings);
      return; // already migrated or saved
    } catch {
      // fall through
    }
    const legacyDir = join(dirname(app.getPath('userData')), '@ai-search', 'desktop');
    const legacySettings = join(legacyDir, SETTINGS_FILENAME);
    try {
      await access(legacySettings);
    } catch {
      return; // no legacy data to migrate
    }

    try {
      await copyFile(legacySettings, currentSettings);
      for (const provider of ['ollama', 'openai', 'anthropic', 'gemini'] as const) {
        const src = join(legacyDir, `${API_KEY_FILENAME_PREFIX}${provider}`);
        const dst = join(dirname(currentSettings), `${API_KEY_FILENAME_PREFIX}${provider}`);
        try {
          await access(src);
          await copyFile(src, dst);
        } catch {
          // no key for this provider
        }
      }
      console.log('[settings] migrated from legacy @ai-search/desktop userData');
    } catch (err) {
      console.warn('[settings] legacy migration failed:', err);
    }
  }

  getLlm(): LlmSettings {
    return { ...this.cache };
  }

  async setLlm(next: LlmSettings): Promise<void> {
    this.cache = { ...next };
    await writeFile(this.settingsPath(), JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  async getApiKey(provider: LlmProvider): Promise<string | null> {
    try {
      const buf = await readFile(this.apiKeyPath(provider));
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(buf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      console.warn('[settings] failed to decrypt API key:', err);
      return null;
    }
  }

  async setApiKey(provider: LlmProvider, key: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS keychain unavailable; cannot store API key safely');
    }
    const encrypted = safeStorage.encryptString(key);
    await writeFile(this.apiKeyPath(provider), encrypted);
  }

  private settingsPath(): string {
    return join(app.getPath('userData'), SETTINGS_FILENAME);
  }

  private apiKeyPath(provider: LlmProvider): string {
    return join(app.getPath('userData'), `${API_KEY_FILENAME_PREFIX}${provider}`);
  }
}
