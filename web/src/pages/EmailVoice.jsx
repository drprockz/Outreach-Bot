import React, { useEffect, useState } from 'react';
import { api } from '../api';

const TONE_OPTIONS = [
  { value: 'professional but direct', label: 'Professional but direct' },
  { value: 'casual and friendly',     label: 'Casual and friendly' },
  { value: 'formal and corporate',    label: 'Formal and corporate' },
  { value: 'custom',                  label: 'Custom…' },
];

export default function EmailVoice() {
  const [form, setForm] = useState({
    persona_name: '', persona_role: '', persona_company: '',
    persona_website: '', persona_tone: 'professional but direct',
    persona_services: '', persona_custom_tone: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getConfig().then(cfg => {
      if (!cfg) return;
      const knownTones = TONE_OPTIONS.slice(0, 3).map(t => t.value);
      const isCustom = cfg.persona_tone && !knownTones.includes(cfg.persona_tone);
      setForm({
        persona_name:     cfg.persona_name     || '',
        persona_role:     cfg.persona_role     || '',
        persona_company:  cfg.persona_company  || '',
        persona_website:  cfg.persona_website  || '',
        persona_tone:     isCustom ? 'custom' : (cfg.persona_tone || 'professional but direct'),
        persona_services: cfg.persona_services || '',
        persona_custom_tone: isCustom ? cfg.persona_tone : '',
      });
      setLoading(false);
    });
  }, []);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSave() {
    setSaving(true);
    const effectiveTone = form.persona_tone === 'custom' ? form.persona_custom_tone : form.persona_tone;
    await api.updateConfig({
      persona_name:     form.persona_name,
      persona_role:     form.persona_role,
      persona_company:  form.persona_company,
      persona_website:  form.persona_website,
      persona_tone:     effectiveTone,
      persona_services: form.persona_services,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div><h1 className="page-title">Email Persona</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div style={{ maxWidth: '540px' }}>
      <h1 className="page-title">Email Persona</h1>
      <p className="td-muted" style={{ marginBottom: '24px', fontSize: '12px' }}>
        These values are injected into every Claude prompt when generating hooks and email bodies.
      </p>

      <div className="persona-form">
        {[
          { key: 'persona_name',    label: 'Your name' },
          { key: 'persona_role',    label: 'Role' },
          { key: 'persona_company', label: 'Company' },
          { key: 'persona_website', label: 'Website' },
        ].map(({ key, label }) => (
          <div key={key} className="persona-field">
            <label className="engine-field-label">{label}</label>
            <input
              className="input"
              style={{ flex: 1 }}
              value={form[key]}
              onChange={e => set(key, e.target.value)}
            />
          </div>
        ))}

        <div className="persona-field">
          <label className="engine-field-label">Tone</label>
          <select className="select" style={{ flex: 1 }} value={form.persona_tone} onChange={e => set('persona_tone', e.target.value)}>
            {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {form.persona_tone === 'custom' && (
          <div className="persona-field">
            <label className="engine-field-label">Custom tone</label>
            <input
              className="input"
              style={{ flex: 1 }}
              value={form.persona_custom_tone}
              onChange={e => set('persona_custom_tone', e.target.value)}
              placeholder="e.g. confident and concise"
            />
          </div>
        )}

        <div className="persona-field" style={{ alignItems: 'flex-start' }}>
          <label className="engine-field-label" style={{ paddingTop: '6px' }}>Services offered</label>
          <textarea
            className="input"
            style={{ flex: 1, minHeight: '90px', resize: 'vertical' }}
            value={form.persona_services}
            onChange={e => set('persona_services', e.target.value)}
            placeholder="Claude uses this as context when writing hooks and email bodies"
          />
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Persona'}
        </button>
        {saved && <span className="saved-confirm">Saved ✓</span>}
      </div>
    </div>
  );
}
