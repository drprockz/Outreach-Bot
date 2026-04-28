import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const TIER_CITIES = {
  1: ['Mumbai', 'Delhi NCR', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad'],
  2: ['Jaipur', 'Surat', 'Lucknow', 'Nagpur', 'Indore', 'Bhopal', 'Visakhapatnam', 'Patna',
      'Vadodara', 'Coimbatore', 'Nashik', 'Rajkot', 'Chandigarh', 'Aurangabad', 'Jodhpur',
      'Madurai', 'Raipur', 'Kota', 'Gwalior'],
  3: [], // Tier 3 = manual entry only — no predefined cities
};

const SIZE_HINTS = {
  msme: 'Micro/small — 1–10 employees, <₹5cr turnover',
  sme:  'Small/medium — 10–200 employees, ₹5cr–₹250cr',
  both: 'All MSME/SME — up to 200 employees, <₹250cr',
};

const COST_PER_LEAD = 0.75; // ₹ blended estimate

export default function RunConfig() {
  const [cities, setCities] = useState([]);
  const [businessSize, setBusinessSize] = useState('msme');
  const [leadCount, setLeadCount] = useState(150);
  const [activeTiers, setActiveTiers] = useState(new Set());
  const [cityInput, setCityInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const cityInputRef = useRef(null);

  useEffect(() => {
    api.getConfig().then(cfg => {
      try {
        const parsed = JSON.parse(cfg.find_leads_cities || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) setCities(parsed);
      } catch { /* use default */ }
      if (cfg.find_leads_business_size) setBusinessSize(cfg.find_leads_business_size);
      if (cfg.find_leads_count) setLeadCount(parseInt(cfg.find_leads_count) || 150);
    });
  }, []);

  function toggleTier(tier) {
    const tierCities = TIER_CITIES[tier] || [];
    if (activeTiers.has(tier)) {
      // Remove this tier — only remove cities not claimed by another active tier
      const otherTierCities = new Set(
        [...activeTiers].filter(t => t !== tier).flatMap(t => TIER_CITIES[t] || [])
      );
      setCities(prev => prev.filter(c => otherTierCities.has(c) || !tierCities.includes(c)));
      setActiveTiers(prev => { const s = new Set(prev); s.delete(tier); return s; });
    } else {
      // Add this tier — deduplicate
      setCities(prev => [...new Set([...prev, ...tierCities])]);
      setActiveTiers(prev => new Set([...prev, tier]));
    }
  }

  function addCity(name) {
    const trimmed = name.trim();
    if (!trimmed || cities.includes(trimmed)) return;
    setCities(prev => [...prev, trimmed]);
  }

  function removeCity(city) {
    setCities(prev => prev.filter(c => c !== city));
    // If the removed city belonged to an active tier, deactivate that tier
    for (const [tier, tierCities] of Object.entries(TIER_CITIES)) {
      if (tierCities.includes(city) && activeTiers.has(Number(tier))) {
        setActiveTiers(prev => { const s = new Set(prev); s.delete(Number(tier)); return s; });
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    await api.updateConfig({
      find_leads_cities: JSON.stringify(cities),
      find_leads_business_size: businessSize,
      find_leads_count: String(leadCount),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const estimatedCost = Math.round(leadCount * COST_PER_LEAD);

  return (
    <div className="card mb-xl">
      <div className="section-title" style={{ marginTop: 0 }}>Run Config</div>

      {/* Location */}
      <div style={{ marginBottom: '1rem' }}>
        <div className="form-label" style={{ marginBottom: '0.5rem' }}>Location</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {[1, 2].map(tier => (
            <button
              key={tier}
              onClick={() => toggleTier(tier)}
              className={activeTiers.has(tier) ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            >
              {tier === 1 ? 'Tier 1 Metros' : 'Tier 2 Cities'}
            </button>
          ))}
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            onClick={() => cityInputRef.current?.focus()}
          >
            + Add Tier 3 (manual)
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
          {cities.map(city => (
            <span
              key={city}
              className="badge badge-blue"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              {city}
              <button
                onClick={() => removeCity(city)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: '0 2px', lineHeight: 1 }}
                aria-label={`Remove ${city}`}
              >×</button>
            </span>
          ))}
          <input
            ref={cityInputRef}
            placeholder="Type city + Enter"
            value={cityInput}
            onChange={e => setCityInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCity(cityInput);
                setCityInput('');
              }
            }}
            style={{ border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 8px', fontSize: '0.85rem', minWidth: '140px' }}
          />
        </div>
      </div>

      {/* Business Size */}
      <div style={{ marginBottom: '1rem' }}>
        <div className="form-label" style={{ marginBottom: '0.5rem' }}>Business Size</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {['msme', 'sme', 'both'].map(s => (
            <button
              key={s}
              onClick={() => setBusinessSize(s)}
              className={businessSize === s ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.8rem', padding: '4px 12px' }}
            >
              {s.toUpperCase()}
            </button>
          ))}
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>{SIZE_HINTS[businessSize]}</span>
        </div>
      </div>

      {/* Lead Count */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div className="form-label" style={{ marginBottom: '0.5rem' }}>Lead Count</div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="number"
            min={50}
            max={2000}
            value={leadCount}
            onChange={e => setLeadCount(Math.max(50, Math.min(2000, parseInt(e.target.value) || 50)))}
            style={{ width: '90px', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', fontSize: '0.9rem' }}
          />
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>~₹{estimatedCost} per run</span>
        </div>
      </div>

      {/* Save */}
      <button
        className="btn btn-primary"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}
