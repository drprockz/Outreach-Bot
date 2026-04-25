import React, { useEffect, useState } from 'react';
import { api } from '../../api';

export default function KpiStrip({ filterParams }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.leadKpis(filterParams).then(setData).catch(() => setData(null));
  }, [filterParams]);

  if (!data) return null;
  const { global: g, inFilter: f } = data;
  const showSplit = filterParams && filterParams !== '?' && filterParams.length > 1;
  const fmt = (gv, fv) => (showSplit ? `${gv} · ${fv}` : `${gv}`);

  return (
    <div className="kpi-strip">
      <Tile title="Total leads" value={fmt(g.total, f.total)} />
      <Tile
        title="A / B / C"
        value={`${g.icpA} / ${g.icpB} / ${g.icpC}`}
        sub={showSplit ? `in filter: ${f.icpA} / ${f.icpB} / ${f.icpC}` : null}
      />
      <Tile title="Ready to send" value={fmt(g.readyToSend, f.readyToSend)} />
      <Tile title="Signals (7d)" value={String(g.signals7d)} />
      <Tile title="Replies awaiting" value={String(g.repliesAwaitingTriage)} />
    </div>
  );
}

function Tile({ title, value, sub }) {
  return (
    <div className="kpi-tile">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
