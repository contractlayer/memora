import { useEffect, useState } from 'react';
import type { OnboardingCandidate } from '../shared/ipc';
import { useTranslation } from './i18n';

export function OnboardingModal({
  open,
  onClose,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  onFinished: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<OnboardingCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setCandidates(null);
      const items = await window.api.onboarding.scanCandidates();
      if (cancelled) return;
      setCandidates(items);
      // Pre-select items the backend marked as "recommended" (exists + not too large).
      setSelected(new Set(items.filter((c) => c.exists && c.recommended).map((c) => c.path)));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onSkip = async () => {
    if (busy) return;
    setBusy(true);
    await window.api.onboarding.markDone();
    onClose();
    await onFinished();
    setBusy(false);
  };

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    const toAdd = [...selected];
    for (const path of toAdd) {
      try {
        await window.api.sources.addByPath(path);
      } catch (err) {
        console.error('[onboarding] failed to add', path, err);
      }
    }
    await window.api.onboarding.markDone();
    onClose();
    await onFinished();
    setBusy(false);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal onboarding">
        <h2 className="onboarding__title">{t('onboarding.title')}</h2>
        <p className="onboarding__subtitle">{t('onboarding.subtitle')}</p>

        {candidates === null ? (
          <div className="onboarding__loading">{t('onboarding.loading')}</div>
        ) : (
          <ul className="onboarding__list">
            {candidates.map((c) => (
              <li key={c.path} className={`onboarding__item${!c.exists ? ' is-missing' : ''}`}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!c.exists || c.fileCount === 0}
                    checked={selected.has(c.path)}
                    onChange={() => toggle(c.path)}
                  />
                  <div className="onboarding__item-body">
                    <div className="onboarding__item-label">{c.label}</div>
                    <div className="onboarding__item-path">{c.path}</div>
                    <div className="onboarding__item-meta">
                      {!c.exists ? (
                        <span className="onboarding__meta-missing">{t('onboarding.missing')}</span>
                      ) : c.fileCount === 0 ? (
                        <span>{t('onboarding.emptyFolder')}</span>
                      ) : (
                        <>
                          {c.fileCount.toLocaleString()} · {formatBytes(c.totalBytes)}
                          {c.truncated && (
                            <span className="onboarding__meta-warn"> · {t('onboarding.truncated')}</span>
                          )}
                          {!c.recommended && c.exists && c.fileCount > 0 && (
                            <span className="onboarding__meta-warn"> · {t('onboarding.warnLarge')}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="onboarding__footer">
          <button className="button button--ghost" onClick={onSkip} disabled={busy}>
            {t('onboarding.skip')}
          </button>
          <button
            className="button button--primary"
            onClick={onStart}
            disabled={busy || selected.size === 0}
          >
            {busy
              ? t('onboarding.adding')
              : selected.size === 0
              ? t('onboarding.chooseAtLeastOne')
              : t('onboarding.addAndIndex', { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
