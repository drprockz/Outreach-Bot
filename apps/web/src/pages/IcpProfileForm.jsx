import React from 'react';
import { useSettingsField } from '../components/useSettingsField';
import ChipInput from '../components/ChipInput';

function TextField({ name, label, placeholder }) {
  const { value, onChange } = useSettingsField(name);
  return (
    <label>
      {label}
      <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
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

export default function IcpProfileForm() {
  return (
    <>
      <section>
        <h3>Company fit</h3>
        <ChipField name="industries" label="Industries" placeholder="e.g. D2C brands" />
        <TextField name="company_size" label="Company size" placeholder="10-50 employees" />
        <TextField name="revenue_range" label="Revenue range" placeholder="₹5-50 Cr ARR" />
        <ChipField name="geography" label="Geography" placeholder="e.g. India, US" />
        <ChipField name="stage" label="Stage" placeholder="e.g. Seed, Series A" />
        <ChipField name="tech_stack" label="Tech stack" placeholder="e.g. WordPress, Shopify" />
        <ChipField name="internal_capabilities" label="Internal capabilities" placeholder="e.g. no in-house dev" />
        <TextField name="budget_range" label="Budget range" placeholder="₹40k-2L" />
      </section>
      <section>
        <h3>Problem intensity</h3>
        <TextField name="problem_frequency" label="Problem frequency" placeholder="daily, weekly…" />
        <TextField name="problem_cost" label="Problem cost" placeholder="lost revenue, churn…" />
        <ChipField name="impacted_kpis" label="Impacted KPIs" placeholder="e.g. conversion rate" />
      </section>
      <section>
        <h3>Buying behavior</h3>
        <ChipField name="initiator_roles" label="Initiator roles" placeholder="e.g. marketing manager" />
        <ChipField name="decision_roles" label="Decision roles" placeholder="e.g. founder, CMO" />
        <ChipField name="objections" label="Objections" placeholder="e.g. too expensive" />
        <TextField name="buying_process" label="Buying process" placeholder="2-6 weeks, 2 stakeholders…" />
        <ChipField name="intent_signals" label="Intent signals" placeholder="e.g. hiring, funding" />
      </section>
      <section>
        <h3>Current solutions</h3>
        <ChipField name="current_tools" label="Current tools" placeholder="e.g. Wix, freelancer" />
        <ChipField name="workarounds" label="Workarounds" placeholder="e.g. manual uploads" />
        <ChipField name="frustrations" label="Frustrations" placeholder="e.g. slow load times" />
        <ChipField name="switching_barriers" label="Switching barriers" placeholder="e.g. long contracts" />
      </section>
      <section>
        <h3>Hard disqualifiers</h3>
        <p className="muted">Lead matching any of these is auto-disqualified regardless of score.</p>
        <ChipField name="hard_disqualifiers" label="Hard disqualifiers" placeholder="e.g. enterprise only" />
      </section>
    </>
  );
}
