import 'dotenv/config';
import { generateEmail } from '../lib/claude.js';
import { getLeadById, getLastEmailForLead } from '../../db/database.js';

const leadId = parseInt(process.argv.find((a) => a.startsWith('--lead-id='))?.split('=')[1] || '1', 10);
const sequence = parseInt(process.argv.find((a) => a.startsWith('--seq='))?.split('=')[1] || '1', 10);

const lead = getLeadById(leadId);
if (!lead) {
  console.error(`Lead with id ${leadId} not found. Run findLeads first or use a valid id.`);
  process.exit(1);
}

// For sequences 2-4, fetch the original subject from the first sent email
let originalSubject = null;
if (sequence > 1) {
  const lastEmail = getLastEmailForLead(leadId);
  originalSubject = lastEmail?.subject?.replace(/^(Re:\s*)+/i, '') || 'Test Subject';
  console.log(`Original subject for threading: ${originalSubject}`);
}

console.log(`Testing email generation for lead: ${lead.name} (${lead.company})`);
console.log(`Sequence: ${sequence}\n`);

try {
  const email = await generateEmail(lead, sequence, originalSubject);
  if (email) {
    console.log('Generated email:\n');
    console.log(`Subject: ${email.subject}`);
    console.log(`\nBody:\n${email.body}`);
  } else {
    console.error('Failed to generate email');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
}
