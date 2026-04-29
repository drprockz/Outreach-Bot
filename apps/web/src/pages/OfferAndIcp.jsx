import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SettingsPage from '../components/SettingsPage';
import OfferForm from './OfferForm';
import IcpProfileForm from './IcpProfileForm';
import { api } from '../api';
import PageHeader from '../components/radar/PageHeader';

const TABS = ['offer', 'icp'];

const EMPTY_OFFER = {
  problem: '', outcome: '', category: '', differentiation: '',
  price_range: '', sales_cycle: '', criticality: '', inaction_cost: '',
  use_cases: [], triggers: [], alternatives: [], required_inputs: [], proof_points: [],
};

const EMPTY_ICP = {
  company_size: '', revenue_range: '', budget_range: '',
  problem_frequency: '', problem_cost: '', buying_process: '',
  industries: [], geography: [], stage: [], tech_stack: [], internal_capabilities: [],
  impacted_kpis: [], initiator_roles: [], decision_roles: [], objections: [],
  intent_signals: [], current_tools: [], workarounds: [], frustrations: [],
  switching_barriers: [], hard_disqualifiers: [],
};

export default function OfferAndIcp() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'offer';
  const [offer, setOffer] = useState(null);
  const [icp, setIcp] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([api.getOffer(), api.getIcpProfile()])
      .then(([o, i]) => {
        setOffer({ ...EMPTY_OFFER, ...(o || {}) });
        setIcp({ ...EMPTY_ICP, ...(i || {}) });
      })
      .catch(e => setLoadError(e.message));
  }, []);

  if (loadError) return <div><PageHeader title="Offer & ICP" subtitle="Define your ideal customer profile" /><div className="msg error">{loadError}</div></div>;
  if (!offer || !icp) return <div><PageHeader title="Offer & ICP" subtitle="Define your ideal customer profile" /><div className="td-muted">Loading…</div></div>;

  return (
    <div className="offer-and-icp">
      <PageHeader title="Offer & ICP" subtitle="What you sell · who you target" />
      <nav className="subtabs">
        <button
          type="button"
          className={`subtab ${tab === 'offer' ? 'active' : ''}`}
          onClick={() => setParams({ tab: 'offer' })}
        >
          Offer
        </button>
        <button
          type="button"
          className={`subtab ${tab === 'icp' ? 'active' : ''}`}
          onClick={() => setParams({ tab: 'icp' })}
        >
          ICP Profile
        </button>
      </nav>

      {tab === 'offer' ? (
        <SettingsPage
          key="offer"
          title="Offer"
          description="What you sell. Feeds the ICP scorer as the OFFER record."
          initialValues={offer}
          onSave={async (values) => {
            const r = await api.updateOffer(values);
            if (r?.data) setOffer({ ...EMPTY_OFFER, ...r.data });
            if (r?.error) throw new Error(r.error);
          }}
        >
          <OfferForm />
        </SettingsPage>
      ) : (
        <SettingsPage
          key="icp"
          title="ICP Profile"
          description="Who you target. Feeds the ICP scorer as the ICP_PROFILE record."
          initialValues={icp}
          onSave={async (values) => {
            const r = await api.updateIcpProfile(values);
            if (r?.data) setIcp({ ...EMPTY_ICP, ...r.data });
            if (r?.error) throw new Error(r.error);
          }}
        >
          <IcpProfileForm />
        </SettingsPage>
      )}
    </div>
  );
}
