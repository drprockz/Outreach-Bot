import { useCallback, useEffect, useState } from 'react';

const MULTI = new Set([
  'status', 'category', 'city', 'country', 'email_status',
  'icp_priority', 'tech_stack', 'business_signals', 'signal_type',
  'business_stage', 'employees_estimate',
]);

function parse() {
  const sp = new URLSearchParams(window.location.search);
  const obj = {};
  for (const [k] of sp.entries()) {
    if (obj[k] !== undefined) continue; // already collected
    if (MULTI.has(k)) obj[k] = sp.getAll(k);
    else obj[k] = sp.get(k);
  }
  return obj;
}

function serialize(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) v.forEach(x => sp.append(k, x));
    else sp.set(k, String(v));
  }
  return sp.toString();
}

export function useFiltersFromUrl() {
  const [filters, setFilters] = useState(parse);

  useEffect(() => {
    const onpop = () => setFilters(parse());
    window.addEventListener('popstate', onpop);
    return () => window.removeEventListener('popstate', onpop);
  }, []);

  const push = useCallback((next) => {
    const qs = serialize(next);
    window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
    setFilters(next);
  }, []);

  return {
    filters,
    setFilter: (k, v) => push({ ...filters, [k]: v }),
    setMany:   (patch) => push({ ...filters, ...patch }),
    clearFilters: () => push({}),
  };
}
