import 'dotenv/config';
import { initSchema } from '../../db/database.js';

initSchema();

console.log('=== DRY RUN — Full Daily Cycle ===\n');

// 1. Lead generation
console.log('1. Testing lead generation...');
try {
  const { findLeads } = await import('../lib/claude.js');
  const leads = await findLeads('startup', 'Indian B2B startup CTO hiring freelance React developer remote', 3, new Date().toISOString().split('T')[0]);
  console.log(`   Found ${leads.length} leads`);
  if (leads.length > 0) console.log(`   Sample: ${leads[0].name} — ${leads[0].company}`);
} catch (err) {
  console.log(`   Skipped (${err.message})`);
}

// 2. Email generation
console.log('\n2. Testing email generation...');
try {
  const { generateEmail } = await import('../lib/claude.js');
  const mockLead = { name: 'Test User', company: 'Test Corp', type: 'startup', location: 'Mumbai', website: 'https://testcorp.com', pain_point: 'Outdated website with poor mobile experience' };
  const email = await generateEmail(mockLead, 1);
  console.log(`   Subject: ${email?.subject || 'FAILED'}`);
  console.log(`   Body length: ${email?.body?.length || 0} chars`);
} catch (err) {
  console.log(`   Skipped (${err.message})`);
}

// 3. Reply classification
console.log('\n3. Testing reply classification...');
try {
  const { classifyReply } = await import('../lib/claude.js');
  const result = await classifyReply('test@example.com', 'Re: test', 'Sounds great, what are your rates?');
  console.log(`   Classification: ${result.classification}`);
  console.log(`   Summary: ${result.summary}`);
} catch (err) {
  console.log(`   Skipped (${err.message})`);
}

// 4. Cost check
console.log('\n4. Cost summary after dry run...');
try {
  const { getCostSummary } = await import('../../db/database.js');
  const costs = getCostSummary();
  console.log(`   Today: $${costs.today.toFixed(4)}`);
  console.log(`   Calls this month: ${costs.breakdown.reduce((s, r) => s + r.calls, 0)}`);
} catch (err) {
  console.log(`   Skipped (${err.message})`);
}

console.log('\n=== DRY RUN COMPLETE ===');
