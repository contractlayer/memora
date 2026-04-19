import type { SourceFolder } from '../shared/ipc';
import { useTranslation } from './i18n';

// Modal that replaces the old sidebar-resident sources panel. All add/remove/
// scope logic stays in App.tsx; this component is presentational.
export function SourcesModal({
  open,
  onClose,
  sources,
  selectedSourceIds,
  onToggle,
  onSelectAll,
  onSelectNone,
  onAddFolder,
  onAddFiles,
  onRemove,
  scopeLabel,
}: {
  open: boolean;
  onClose: () => void;
  sources: SourceFolder[];
  selectedSourceIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onAddFolder: () => void;
  onAddFiles: () => void;
  onRemove: (id: string) => void;
  scopeLabel: string;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal sources-modal">
        <header className="modal__header">
          <div>
            <h2>{t('sources.title')}</h2>
            <span className="sources-modal__scope">{scopeLabel}</span>
          </div>
          <button className="modal__close" onClick={onClose} aria-label={t('settings.close')}>
            ×
          </button>
        </header>

        <div className="modal__body sources-modal__body">
          <div className="sources-modal__actions">
            <button className="button button--ghost" onClick={onAddFolder}>
              {t('sources.addFolder')}
            </button>
            <button className="button button--ghost" onClick={onAddFiles}>
              {t('sources.addFiles')}
            </button>
            <span className="sources-modal__actions-spacer" />
            {sources.length > 1 && (
              <>
                <button
                  className="link"
                  onClick={onSelectAll}
                  disabled={selectedSourceIds.size === sources.length}
                >
                  {t('sources.selectAll')}
                </button>
                <span className="sources-modal__sep">·</span>
                <button
                  className="link"
                  onClick={onSelectNone}
                  disabled={selectedSourceIds.size === 0}
                >
                  {t('sources.selectNone')}
                </button>
              </>
            )}
          </div>

          {sources.length === 0 ? (
            <p className="sources-modal__empty">{t('sources.empty')}</p>
          ) : (
            <ul className="sources-modal__list">
              {sources.map((s) => {
                const checked = selectedSourceIds.has(s.id);
                return (
                  <li
                    key={s.id}
                    className={`sources-modal__item${checked ? ' is-active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(s.id)}
                    />
                    <span className="sources-modal__icon" aria-hidden>
                      {s.kind === 'file' ? '◦' : '▸'}
                    </span>
                    <div className="sources-modal__path" title={s.path}>
                      {s.path}
                    </div>
                    <div className="sources-modal__meta">
                      {s.indexedCount}/{s.fileCount}
                    </div>
                    <button
                      className="sources-modal__remove"
                      onClick={() => onRemove(s.id)}
                      title={t('sources.remove')}
                      aria-label={t('sources.remove')}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
