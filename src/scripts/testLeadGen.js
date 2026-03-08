import 'dotenv/config';
import { findLeads } from '../lib/claude.js';

const date = new Date().toISOString().split('T')[0];
const category = 'startup';
const query = 'Indian B2B startup CTO hiring freelance React developer remote';
const limit = 5;

console.log(`Testing lead generation: category=${category}, limit=${limit}`);
console.log(`Query: ${query}\n`);

try {
  const leads = await findLeads(category, query, limit, date);
  console.log(`Found ${leads.length} leads:\n`);
  console.log(JSON.stringify(leads, null, 2));
} catch (err) {
  console.error(`Error: ${err.message}`);
}
