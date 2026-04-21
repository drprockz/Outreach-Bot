import React, { useEffect, useState } from 'react';
import { api } from '../api';
import SettingsPage from '../components/SettingsPage';
import { useSettingsField } from '../components/useSettingsField';

const TONE_OPTIONS = [
  { value: 'professional but direct', label: 'Professional but direct' },
  { value: 'casual and friendly',     label: 'Casual and friendly' },
  { value: 'formal and corporate',    label: 'Formal and corporate' },
  { value: 'custom',                  label: 'Custom…' },
];

const KNOWN_TONES = TONE_OPTIONS.slice(0, 3).map(t => t.value);

function TextField({ name, label, type = 'input' }) {
  const { value, onChange } = useSettingsField(name);
  return (
    <div className="persona-field" style={type === 'textarea' ? { alignItems: 'flex-start' } : undefined}>
      <label className="engine-field-label" style={type === 'textarea' ? { paddingTop: 6 } : undefined}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          className="input"
          style={{ flex: 1, minHeight: 90, resize: 'vertical' }}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input"
          style={{ flex: 1 }}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function ToneSelect() {
  const tone = useSettingsField('persona_tone');
  const custom = useSettingsField('persona_custom_tone');
  return (
    <>
      <div className="persona-field">
        <label className="engine-field-label">Tone</label>
        <select
          className="select"
          style={{ flex: 1 }}
          value={tone.value ?? ''}
          onChange={e => tone.onChange(e.target.value)}
        >
          {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      {tone.value === 'custom' && (
        <div className="persona-field">
          <label className="engine-field-label">Custom tone</label>
          <input
            className="input"
            style={{ flex: 1 }}
            value={custom.value ?? ''}
            onChange={e => custom.onChange(e.target.value)}
            placeholder="e.g. confident and concise"
          />
        </div>
      )}
    </>
  );
}

export default function EmailVoice() {
  const [initial, setInitial] = useState(null);

  useEffect(() => {
    api.getConfig().then(cfg => {
      if (!cfg) return;
      const storedTone = cfg.persona_tone || 'professional but direct';
      const isCustom = storedTone && !KNOWN_TONES.includes(storedTone);
      setInitial({
        persona_name:        cfg.persona_name        || '',
        persona_role:        cfg.persona_role        || '',
        persona_company:     cfg.persona_company     || '',
        persona_website:     cfg.persona_website     || '',
        persona_tone:        isCustom ? 'custom' : storedTone,
        persona_services:    cfg.persona_services    || '',
        persona_custom_tone: isCustom ? storedTone : '',
      });
    });
  }, []);

  if (!initial) return <div><h1 className="page-title">Email Voice</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div style={{ maxWidth: 540 }}>
      <SettingsPage
        title="Email Voice"
        description="These values are injected into every Claude prompt when generating hooks and email bodies."
        initialValues={initial}
        onSave={async (values) => {
          const effectiveTone = values.persona_tone === 'custom' ? values.persona_custom_tone : values.persona_tone;
          await api.updateConfig({
            persona_name:     values.persona_name,
            persona_role:     values.persona_role,
            persona_company:  values.persona_company,
            persona_website:  values.persona_website,
            persona_tone:     effectiveTone,
            persona_services: values.persona_services,
          });
          // Re-seed initial so the dirty-check clears after save
          setInitial(values);
        }}
      >
        <div className="persona-form">
          <TextField name="persona_name"    label="Your name" />
          <TextField name="persona_role"    label="Role" />
          <TextField name="persona_company" label="Company" />
          <TextField name="persona_website" label="Website" />
          <ToneSelect />
          <TextField name="persona_services" label="Services offered" type="textarea" />
        </div>
      </SettingsPage>
    </div>
  );
}
