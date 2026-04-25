// Test helper: provides a fresh Postgres state per test by truncating all tables.
// Assumes DATABASE_URL_TEST points at a DB with migrations already applied.
import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

let _prisma;

export function getTestPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL_TEST } },
    });
  }
  return _prisma;
}

// CASCADE handles FK ordering; RESTART IDENTITY resets autoincrement.
const TABLES = [
  'bounces', 'replies', 'sequence_state', 'emails', 'lead_signals', 'leads',
  'reject_list', 'cron_log', 'daily_metrics', 'error_log',
  'config', 'niches', 'offer', 'icp_profile', 'saved_views',
];

export async function truncateAll() {
  const prisma = getTestPrisma();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`
  );
}

export async function closeTestPrisma() {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}
