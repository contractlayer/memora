import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BUNDLES, EN_BUNDLE, SUPPORTED_LOCALES, type Locale, type StringKey } from '@shared/locales';

type TranslateFn = (key: StringKey, params?: Record<string, string | number>) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (l: Locale) => Promise<void>;
  t: TranslateFn;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Load persisted locale from main process on mount.
  useEffect(() => {
    void (async () => {
      try {
        const saved = await window.api.locale.get();
        if (saved && isSupported(saved)) setLocaleState(saved);
      } catch {
        // fall back to default English
      }
    })();
  }, []);

  // Subscribe to locale changes pushed from the OS native menu.
  useEffect(() => {
    const unsub = window.api.locale.onChanged((next) => {
      if (isSupported(next)) setLocaleState(next);
    });
    return unsub;
  }, []);

  const setLocale = useCallback(async (l: Locale) => {
    setLocaleState(l);
    await window.api.locale.set(l);
  }, []);

  const t = useCallback<TranslateFn>(
    (key, params) => {
      const bundle = BUNDLES[locale] ?? {};
      const raw = (bundle as Partial<Record<StringKey, string>>)[key] ?? EN_BUNDLE[key] ?? key;
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
        params[name] !== undefined ? String(params[name]) : `{${name}}`,
      );
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be inside I18nProvider');
  return ctx;
}

function isSupported(l: string): l is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(l);
}

export type { Locale, StringKey } from '@shared/locales';
export { SUPPORTED_LOCALES, LOCALE_NAMES } from '@shared/locales';
