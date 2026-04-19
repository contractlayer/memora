import { useEffect, useState } from 'react';
import type { LlmProvider, LlmSettings, LlmTestResult } from '../shared/ipc';

type Props = {
  open: boolean;
  onClose: () => void;
};

const PROVIDER_OPTIONS: {
  value: LlmProvider;
  label: string;
  needsKey: boolean;
  hint: string;
}[] = [
  { value: 'none', label: 'None (no AI answer, show top chunks only)', needsKey: false, hint: '' },
  {
    value: 'ollama',
    label: 'Ollama (local)',
    needsKey: false,
    hint: 'Runs on localhost:11434. The model list shows what you have pulled locally.',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    needsKey: true,
    hint: 'Uses https://api.openai.com. Your key is encrypted via OS keychain.',
  },
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    needsKey: true,
    hint: 'Uses https://api.anthropic.com. Your key is encrypted via OS keychain.',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    needsKey: true,
    hint: 'Uses https://generativelanguage.googleapis.com. Your key is encrypted via OS keychain.',
  },
];

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  none: '',
  ollama: 'qwen2.5:7b-instruct',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.5-flash',
};

const CUSTOM_SENTINEL = '__custom__';

export function SettingsModal({ open, onClose }: Props) {
  const [current, setCurrent] = useState<LlmSettings>({ provider: 'none', model: '' });
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModelActive, setCustomModelActive] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const llm = await window.api.settings.getLlm();
      setCurrent(llm);
      setApiKey('');
      setTestResult(null);
      if (llm.provider !== 'none') {
        const stored = await window.api.settings.hasApiKey(llm.provider);
        setHasStoredKey(stored);
        void loadModels(llm.provider, llm.baseUrl, llm.model);
      } else {
        setAvailableModels([]);
        setCustomModelActive(false);
      }
    })();
  }, [open]);

  if (!open) return null;

  const option = PROVIDER_OPTIONS.find((o) => o.value === current.provider)!;

  async function loadModels(provider: LlmProvider, baseUrl: string | undefined, currentModel: string) {
    if (provider === 'none') {
      setAvailableModels([]);
      return;
    }
    setModelsLoading(true);
    try {
      const models = await window.api.settings.listModels(provider, baseUrl);
      setAvailableModels(models);
      // Custom is implicit when the saved model isn't in the preset list.
      setCustomModelActive(currentModel.length > 0 && !models.includes(currentModel));
    } finally {
      setModelsLoading(false);
    }
  }

  async function onProviderChange(provider: LlmProvider) {
    const nextModel = DEFAULT_MODELS[provider];
    setCurrent({ provider, model: nextModel, baseUrl: undefined });
    setApiKey('');
    setTestResult(null);
    setCustomModelActive(false);
    if (provider !== 'none') {
      const stored = await window.api.settings.hasApiKey(provider);
      setHasStoredKey(stored);
      void loadModels(provider, undefined, nextModel);
    } else {
      setHasStoredKey(false);
      setAvailableModels([]);
    }
  }

  function onModelDropdownChange(value: string) {
    if (value === CUSTOM_SENTINEL) {
      setCustomModelActive(true);
      setCurrent({ ...current, model: '' });
      return;
    }
    setCustomModelActive(false);
    setCurrent({ ...current, model: value });
  }

  async function onSave() {
    setSaving(true);
    try {
      if (option.needsKey && apiKey.length > 0) {
        await window.api.settings.setApiKey(current.provider, apiKey);
      }
      await window.api.settings.setLlm(current);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      if (option.needsKey && apiKey.length > 0) {
        await window.api.settings.setApiKey(current.provider, apiKey);
        setApiKey('');
        setHasStoredKey(true);
      }
      await window.api.settings.setLlm(current);
      const result = await window.api.settings.testLlm();
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2>Settings — AI provider</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">Provider</span>
            <select
              value={current.provider}
              onChange={(e) => onProviderChange(e.target.value as LlmProvider)}
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {option.hint && <span className="field__hint">{option.hint}</span>}
          </label>

          {current.provider !== 'none' && (
            <>
              <label className="field">
                <span className="field__label">Model</span>
                <select
                  value={customModelActive ? CUSTOM_SENTINEL : current.model}
                  onChange={(e) => onModelDropdownChange(e.target.value)}
                  disabled={modelsLoading}
                >
                  {modelsLoading && <option>Loading…</option>}
                  {!modelsLoading &&
                    availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  <option value={CUSTOM_SENTINEL}>Custom…</option>
                </select>
                {customModelActive && (
                  <input
                    type="text"
                    value={current.model}
                    onChange={(e) => setCurrent({ ...current, model: e.target.value })}
                    placeholder={DEFAULT_MODELS[current.provider]}
                  />
                )}
                {current.provider === 'ollama' && !modelsLoading && availableModels.length === 0 && (
                  <span className="field__hint">
                    No Ollama models detected. Is the server running on{' '}
                    {current.baseUrl ?? 'localhost:11434'}?
                  </span>
                )}
              </label>

              <label className="field">
                <span className="field__label">Base URL (optional)</span>
                <input
                  type="text"
                  value={current.baseUrl ?? ''}
                  onChange={(e) =>
                    setCurrent({ ...current, baseUrl: e.target.value || undefined })
                  }
                  onBlur={() => loadModels(current.provider, current.baseUrl, current.model)}
                  placeholder={defaultBaseUrl(current.provider)}
                />
              </label>

              {option.needsKey && (
                <label className="field">
                  <span className="field__label">API key</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasStoredKey ? '•••••• (stored)' : apiKeyPlaceholder(current.provider)}
                  />
                  <span className="field__hint">
                    {hasStoredKey
                      ? 'Key already stored securely. Leave blank to keep, or type a new one to replace.'
                      : 'Stored encrypted via OS keychain.'}
                  </span>
                </label>
              )}
            </>
          )}

          {testResult && (
            <div
              className={`field__result ${testResult.ok ? 'field__result--ok' : 'field__result--error'}`}
            >
              {testResult.ok ? '✓ Connection OK' : `✗ ${testResult.error}`}
            </div>
          )}
        </div>

        <footer className="modal__footer">
          <button
            className="button button--ghost"
            onClick={onTest}
            disabled={testing || current.provider === 'none'}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <div className="modal__footer-right">
            <button className="button button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="button button--primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function defaultBaseUrl(provider: LlmProvider): string {
  switch (provider) {
    case 'ollama':
      return 'http://localhost:11434';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta';
    default:
      return '';
  }
}

function apiKeyPlaceholder(provider: LlmProvider): string {
  switch (provider) {
    case 'openai':
      return 'sk-…';
    case 'anthropic':
      return 'sk-ant-…';
    case 'gemini':
      return 'AIza…';
    default:
      return '';
  }
}
