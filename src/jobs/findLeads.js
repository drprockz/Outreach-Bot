import { findLeads as claudeFindLeads } from '../lib/claude.js';
import { insertLead, markEmailVerified, upsertPipeline } from '../../db/database.js';
import { verifyEmail } from '../utils/emailVerifier.js';
import { DAILY_QUERIES } from '../utils/queries.js';
import logger from '../lib/logger.js';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function runFindLeads() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const dayName = DAY_NAMES[dayOfWeek];
  const { category, query } = DAILY_QUERIES[dayName];
  const limit = parseInt(process.env.LEAD_FIND_LIMIT, 10) || 60;
  const dateStr = now.toISOString().split('T')[0];

  logger.info(`Starting lead finder: day=${dayOfWeek}, category=${category}`);

  let leads;
  try {
    leads = await claudeFindLeads(category, query, limit, dateStr);
  } catch (err) {
    logger.error(`Lead generation failed: ${err.message}`);
    return;
  }

  if (!Array.isArray(leads) || leads.length === 0) {
    logger.warn('No leads returned from Claude');
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let verified = 0;

  for (const lead of leads) {
    // Combined verify: checks MX + blocked prefixes
    if (!lead.email || !(await verifyEmail(lead.email))) {
      skipped++;
      continue;
    }

    const result = insertLead({
      name: lead.name || '',
      company: lead.company || '',
      email: lead.email,
      type: lead.type || category,
      location: lead.location || '',
      website: lead.website || '',
      pain_point: lead.pain_point || '',
      source: lead.source || query,
    });

    if (result.changes > 0) {
      inserted++;
      verified++;
      const leadId = result.lastInsertRowid;
      markEmailVerified(leadId);

      upsertPipeline({
        lead_id: leadId,
        status: 'cold',
        last_contacted_at: null,
        next_followup_at: null,
        next_followup_sequence: 2,
        notes: null,
      });
    } else {
      skipped++;
    }
  }

  logger.info(`Lead finder complete: found=${leads.length}, inserted=${inserted}, verified=${verified}, skipped=${skipped}`);
}
