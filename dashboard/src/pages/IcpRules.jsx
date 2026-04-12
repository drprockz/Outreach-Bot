import React, { useEffect, useState } from 'react';
import { api } from '../api';

const VALID_POINTS = [-3, -2, -1, 1, 2, 3];

export default function IcpRules() {
  const [rules, setRules] = useState([]);
  const [threshA, setThreshA] = useState(7);
  const [threshB, setThreshB] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    Promise.all([api.getIcpRules(), api.getConfig()]).then(([rulesData, cfg]) => {
      setRules(rulesData?.rules || []);
      setThreshA(parseInt(cfg?.icp_threshold_a ?? 7));
      setThreshB(parseInt(cfg?.icp_threshold_b ?? 4));
      setLoading(false);
    });
  }
  useEffect(load, []);

  function addRule() {
    const newRule = { id: null, label: 'New rule', points: 1, description: '', enabled: 1, sort_order: rules.length };
    setRules(r => [...r, newRule]);
  }

  function updateRule(index, field, value) {
    setRules(r => r.map((rule, i) => i === index ? { ...rule, [field]: value } : rule));
  }

  function removeRule(index) {
    setRules(r => r.filter((_, i) => i !== index));
  }

  function moveUp(index) {
    if (index === 0) return;
    setRules(r => {
      const next = [...r];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index) {
    setRules(r => {
      if (index >= r.length - 1) return r;
      const next = [...r];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    await Promise.all([
      api.updateIcpRules(rules.map(r => ({ label: r.label, points: r.points, description: r.description || null, enabled: r.enabled }))),
      api.updateConfig({ icp_threshold_a: String(threshA), icp_threshold_b: String(threshB) })
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    load();
  }

  if (loading) return <div><h1 className="page-title">ICP Rubric</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div>
      <h1 className="page-title">ICP Rubric</h1>

      <div className="icp-rules-list">
        {rules.map((rule, i) => (
          <div key={i} className="icp-rule-row">
            <div className="icp-rule-order">
              <button className="btn-ghost" style={{ padding: '2px 6px' }} onClick={() => moveUp(i)} disabled={i === 0}>▲</button>
              <button className="btn-ghost" style={{ padding: '2px 6px' }} onClick={() => moveDown(i)} disabled={i === rules.length - 1}>▼</button>
            </div>

            <select
              className="select"
              style={{ width: '64px', color: rule.points > 0 ? 'var(--green)' : 'var(--red)' }}
              value={rule.points}
              onChange={e => updateRule(i, 'points', parseInt(e.target.value))}
            >
              {VALID_POINTS.map(p => (
                <option key={p} value={p} style={{ color: p > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {p > 0 ? `+${p}` : p}
                </option>
              ))}
            </select>

            <div className="icp-rule-content">
              <input
                className="input"
                style={{ width: '100%', marginBottom: '4px' }}
                value={rule.label}
                onChange={e => updateRule(i, 'label', e.target.value)}
                placeholder="Rule label"
              />
              <input
                className="input"
                style={{ width: '100%', fontSize: '11px' }}
                value={rule.description || ''}
                onChange={e => updateRule(i, 'description', e.target.value)}
                placeholder="Description (optional)"
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0 }}>
              <input type="checkbox" checked={!!rule.enabled} onChange={e => updateRule(i, 'enabled', e.target.checked ? 1 : 0)} />
              enabled
            </label>

            <button className="btn-ghost btn-ghost-red" style={{ flexShrink: 0 }} onClick={() => removeRule(i)}>✕</button>
          </div>
        ))}
      </div>

      <button className="btn-ghost" style={{ marginTop: '12px' }} onClick={addRule}>+ Add Rule</button>

      <div className="icp-thresholds">
        <div className="section-label" style={{ marginBottom: '12px' }}>Priority Thresholds</div>
        <div className="icp-threshold-row">
          <span className="badge badge-green">A</span>
          <span className="td-muted">score ≥</span>
          <input className="input" style={{ width: '60px' }} type="number" value={threshA} onChange={e => setThreshA(parseInt(e.target.value) || 7)} />
        </div>
        <div className="icp-threshold-row">
          <span className="badge badge-blue">B</span>
          <span className="td-muted">score ≥</span>
          <input className="input" style={{ width: '60px' }} type="number" value={threshB} onChange={e => setThreshB(parseInt(e.target.value) || 4)} />
        </div>
        <div className="icp-threshold-row">
          <span className="badge badge-muted">C</span>
          <span className="td-muted">score &lt; {threshB} (auto)</span>
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save All Rules'}
        </button>
        {saved && <span className="saved-confirm">Saved ✓</span>}
      </div>
    </div>
  );
}
