import React from 'react';
import { useSettingsField } from '../components/useSettingsField';
import ChipInput from '../components/ChipInput';

function TextField({ name, label, rows }) {
  const { value, onChange } = useSettingsField(name);
  if (rows) {
    return (
      <label>
        {label}
        <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={rows} />
      </label>
    );
  }
  return (
    <label>
      {label}
      <input value={value ?? ''} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function ChipField({ name, label, placeholder }) {
  const { value, onChange } = useSettingsField(name);
  return (
    <label>
      {label}
      <ChipInput value={value ?? []} onChange={onChange} placeholder={placeholder} />
    </label>
  );
}

function SelectField({ name, label, options }) {
  const { value, onChange } = useSettingsField(name);
  return (
    <label>
      {label}
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export default function OfferForm() {
  return (
    <>
      <section>
        <h3>What</h3>
        <TextField name="problem" label="Problem" rows={2} />
        <TextField name="outcome" label="Outcome" rows={2} />
        <TextField name="category" label="Category" />
        <TextField name="differentiation" label="Differentiation" rows={2} />
      </section>
      <section>
        <h3>Who benefits</h3>
        <ChipField name="use_cases" label="Use cases" placeholder="e.g. redesign" />
        <ChipField name="triggers" label="Triggers" placeholder="e.g. Google penalty" />
      </section>
      <section>
        <h3>Commercial</h3>
        <TextField name="price_range" label="Price range" />
        <TextField name="sales_cycle" label="Sales cycle" />
        <SelectField name="criticality" label="Criticality" options={['mission-critical', 'optional']} />
        <TextField name="inaction_cost" label="Inaction cost" rows={2} />
        <ChipField name="alternatives" label="Alternatives" placeholder="e.g. freelancers" />
      </section>
      <section>
        <h3>Proof</h3>
        <ChipField name="required_inputs" label="Required inputs" placeholder="e.g. hosting access" />
        <ChipField name="proof_points" label="Proof points" placeholder="e.g. case study" />
      </section>
    </>
  );
}
