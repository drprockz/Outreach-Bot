import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

const Ctx = createContext(null);

/**
 * Shared skeleton for Setup pages. Wraps a form in header/body/footer chrome
 * and manages dirty / saving / last-saved state so each page's fields only
 * have to declare themselves via the `useSettingsField(name)` hook.
 *
 * Props:
 *  - title, description: rendered in the header
 *  - initialValues:     object — seed values loaded from the API
 *  - onSave(values):    async — server write; should resolve on success
 *  - onValidate(values) optional — return an {field: errorMessage} object
 *  - children:          the form content
 */
export default function SettingsPage({ title, description, initialValues, onSave, onValidate, children }) {
  const [values, setValues] = useState(initialValues || {});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [topError, setTopError] = useState('');

  // Re-seed when initialValues prop changes (e.g., after parent refetch)
  React.useEffect(() => {
    setValues(initialValues || {});
    setErrors({});
    setTopError('');
  }, [initialValues]);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues || {}),
    [values, initialValues]
  );

  const setField = useCallback((name, val) => {
    setValues(v => ({ ...v, [name]: val }));
    setErrors(e => { if (!e[name]) return e; const n = { ...e }; delete n[name]; return n; });
  }, []);

  async function handleSave() {
    setTopError('');
    if (onValidate) {
      const e = onValidate(values) || {};
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    setSaving(true);
    try {
      await onSave(values);
      setLastSavedAt(new Date());
    } catch (err) {
      setTopError(err?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  function handleReset() {
    setValues(initialValues || {});
    setErrors({});
    setTopError('');
  }

  return (
    <Ctx.Provider value={{ values, setField, errors }}>
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="page-title">{title}</h1>
          {description && <p className="muted">{description}</p>}
        </header>
        {topError && <div className="msg error" style={{ marginBottom: 12 }}>{topError}</div>}
        <main className="settings-page-body">{children}</main>
        <footer className="settings-page-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
            disabled={!dirty || saving}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {lastSavedAt && (
            <span className="muted" style={{ fontSize: 12 }}>
              Last saved {timeAgo(lastSavedAt)}
            </span>
          )}
        </footer>
      </div>
    </Ctx.Provider>
  );
}

export function useSettingsContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettingsField / useSettingsContext must be used inside a SettingsPage');
  return ctx;
}

function timeAgo(d) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return d.toLocaleTimeString();
}
