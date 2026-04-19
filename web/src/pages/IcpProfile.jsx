import { useState, useEffect } from 'react';
import { api } from '../api';
import ChipInput from '../components/ChipInput';

const EMPTY = {
  company_size: '', revenue_range: '', budget_range: '',
  problem_frequency: '', problem_cost: '', buying_process: '',
  industries: [], geography: [], stage: [], tech_stack: [], internal_capabilities: [],
  impacted_kpis: [],
  initiator_roles: [], decision_roles: [], objections: [], intent_signals: [],
  current_tools: [], workarounds: [], frustrations: [], switching_barriers: [],
  hard_disqualifiers: []
};

export default function IcpProfile() {
  const [profile, setProfile] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getIcpProfile().then(r => {
      setProfile({ ...EMPTY, ...(r?.profile || {}) });
    });
  }, []);

  const set = (k) => (v) => setProfile(p => ({ ...p, [k]: v }));
  const setText = (k) => (e) => set(k)(e.target.value);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const r = await api.updateIcpProfile(profile);
      if (r?.error) setMsg(`Error: ${r.error}`);
      else setMsg('Saved.');
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page icp-profile-page">
      <h2>ICP Profile</h2>
      <p className="muted">Who you target. Feeds the ICP scorer as the ICP_PROFILE record.</p>

      <section>
        <h3>Company fit</h3>
        <label>Industries<ChipInput value={profile.industries} onChange={set('industries')} placeholder="e.g. D2C brands" /></label>
        <label>Company size<input value={profile.company_size || ''} onChange={setText('company_size')} placeholder="10-50 employees" /></label>
        <label>Revenue range<input value={profile.revenue_range || ''} onChange={setText('revenue_range')} placeholder="₹5-50 Cr ARR" /></label>
        <label>Geography<ChipInput value={profile.geography} onChange={set('geography')} placeholder="e.g. India, US" /></label>
        <label>Stage<ChipInput value={profile.stage} onChange={set('stage')} placeholder="e.g. Seed, Series A" /></label>
        <label>Tech stack<ChipInput value={profile.tech_stack} onChange={set('tech_stack')} placeholder="e.g. WordPress, Shopify" /></label>
        <label>Internal capabilities<ChipInput value={profile.internal_capabilities} onChange={set('internal_capabilities')} placeholder="e.g. no in-house dev" /></label>
        <label>Budget range<input value={profile.budget_range || ''} onChange={setText('budget_range')} placeholder="₹40k-2L" /></label>
      </section>

      <section>
        <h3>Problem intensity</h3>
        <label>Problem frequency<input value={profile.problem_frequency || ''} onChange={setText('problem_frequency')} placeholder="daily, weekly…" /></label>
        <label>Problem cost<input value={profile.problem_cost || ''} onChange={setText('problem_cost')} placeholder="lost revenue, churn…" /></label>
        <label>Impacted KPIs<ChipInput value={profile.impacted_kpis} onChange={set('impacted_kpis')} placeholder="e.g. conversion rate" /></label>
      </section>

      <section>
        <h3>Buying behavior</h3>
        <label>Initiator roles<ChipInput value={profile.initiator_roles} onChange={set('initiator_roles')} placeholder="e.g. marketing manager" /></label>
        <label>Decision roles<ChipInput value={profile.decision_roles} onChange={set('decision_roles')} placeholder="e.g. founder, CMO" /></label>
        <label>Objections<ChipInput value={profile.objections} onChange={set('objections')} placeholder="e.g. too expensive" /></label>
        <label>Buying process<input value={profile.buying_process || ''} onChange={setText('buying_process')} placeholder="2-6 weeks, 2 stakeholders…" /></label>
        <label>Intent signals<ChipInput value={profile.intent_signals} onChange={set('intent_signals')} placeholder="e.g. hiring, funding" /></label>
      </section>

      <section>
        <h3>Current solutions</h3>
        <label>Current tools<ChipInput value={profile.current_tools} onChange={set('current_tools')} placeholder="e.g. Wix, freelancer" /></label>
        <label>Workarounds<ChipInput value={profile.workarounds} onChange={set('workarounds')} placeholder="e.g. manual uploads" /></label>
        <label>Frustrations<ChipInput value={profile.frustrations} onChange={set('frustrations')} placeholder="e.g. slow load times" /></label>
        <label>Switching barriers<ChipInput value={profile.switching_barriers} onChange={set('switching_barriers')} placeholder="e.g. long contracts" /></label>
      </section>

      <section>
        <h3>Hard disqualifiers</h3>
        <p className="muted">Lead matching any of these is auto-disqualified regardless of score.</p>
        <label>Hard disqualifiers<ChipInput value={profile.hard_disqualifiers} onChange={set('hard_disqualifiers')} placeholder="e.g. enterprise only" /></label>
      </section>

      <div className="save-bar">
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span className="msg">{msg}</span>}
      </div>
    </div>
  );
}
