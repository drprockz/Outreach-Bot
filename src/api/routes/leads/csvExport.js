
const VISIBLE_COLS = [
  'id','business_name','category','contact_name','contact_email','email_status',
  'icp_score','icp_priority_v2','website_quality_score','status','tech_stack',
  'city','discovered_at',
];

function escape(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(req, res, { where, orderBy, serializeLead, thresholds }) {
  const all = req.query.columns === 'all';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');

  let header = null;
  let cursor = 0;
  const PAGE = 200;
  while (true) {
    const rows = await req.db.lead.findMany({ where, orderBy, skip: cursor, take: PAGE });
    if (!rows.length) break;
    if (!header) {
      header = all ? Object.keys(serializeLead(rows[0], thresholds)) : VISIBLE_COLS;
      res.write(header.join(',') + '\n');
    }
    for (const r of rows) {
      const s = serializeLead(r, thresholds);
      res.write(header.map(c => escape(s[c])).join(',') + '\n');
    }
    cursor += rows.length;
    if (rows.length < PAGE) break;
  }
  if (!header) {
    // empty result — still emit header for downstream tools
    res.write((all ? VISIBLE_COLS : VISIBLE_COLS).join(',') + '\n');
  }
  res.end();
}
