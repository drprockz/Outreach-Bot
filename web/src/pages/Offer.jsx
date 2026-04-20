import { useState, useEffect } from 'react';
import { api } from '../api';
import ChipInput from '../components/ChipInput';

const EMPTY = {
  problem: '', outcome: '', category: '', differentiation: '',
  price_range: '', sales_cycle: '', criticality: '', inaction_cost: '',
  use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: []
};

export default function Offer() {
  const [offer, setOffer] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getOffer()
      .then(r => setOffer({ ...EMPTY, ...(r?.offer || {}) }))
      .catch(e => setMsg(`Load failed: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const set = (k) => (v) => setOffer(o => ({ ...o, [k]: v }));
  const setText = (k) => (e) => set(k)(e.target.value);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const r = await api.updateOffer(offer);
      if (r?.error) setMsg(`Error: ${r.error}`);
      else setMsg('Saved.');
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page offer-page">
        <h2>Offer</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page offer-page">
      <h2>Offer</h2>
      <p className="muted">What you sell. Feeds the ICP scorer as the OFFER record.</p>

      <section>
        <h3>What</h3>
        <label>Problem<textarea value={offer.problem || ''} onChange={setText('problem')} rows={2} /></label>
        <label>Outcome<textarea value={offer.outcome || ''} onChange={setText('outcome')} rows={2} /></label>
        <label>Category<input value={offer.category || ''} onChange={setText('category')} /></label>
        <label>Differentiation<textarea value={offer.differentiation || ''} onChange={setText('differentiation')} rows={2} /></label>
      </section>

      <section>
        <h3>Who benefits</h3>
        <label>Use cases<ChipInput value={offer.use_cases} onChange={set('use_cases')} placeholder="e.g. redesign" /></label>
        <label>Triggers<ChipInput value={offer.triggers} onChange={set('triggers')} placeholder="e.g. Google penalty" /></label>
      </section>

      <section>
        <h3>Commercial</h3>
        <label>Price range<input value={offer.price_range || ''} onChange={setText('price_range')} placeholder="₹40k-2L" /></label>
        <label>Sales cycle<input value={offer.sales_cycle || ''} onChange={setText('sales_cycle')} placeholder="2-6 weeks" /></label>
        <label>Criticality
          <select value={offer.criticality || ''} onChange={setText('criticality')}>
            <option value="">—</option>
            <option value="mission-critical">mission-critical</option>
            <option value="optional">optional</option>
          </select>
        </label>
        <label>Inaction cost<textarea value={offer.inaction_cost || ''} onChange={setText('inaction_cost')} rows={2} /></label>
        <label>Alternatives<ChipInput value={offer.alternatives} onChange={set('alternatives')} placeholder="e.g. freelancers" /></label>
      </section>

      <section>
        <h3>Proof</h3>
        <label>Required inputs<ChipInput value={offer.required_inputs} onChange={set('required_inputs')} placeholder="e.g. hosting access" /></label>
        <label>Proof points<ChipInput value={offer.proof_points} onChange={set('proof_points')} placeholder="e.g. case study" /></label>
      </section>

      <div className="save-bar">
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span className="msg">{msg}</span>}
      </div>
    </div>
  );
}
