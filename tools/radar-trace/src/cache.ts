import { mkdir, readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AdapterResult, Cache, CacheKey, Company } from './types.js';

/**
 * Returns a stable 12-char hex hash of the normalized Company input.
 * Normalization: trim + lowercase name and domain. Location and founder are passed
 * through verbatim — they're free-text and small variations like "Mumbai" vs
 * "Mumbai, India" are meaningfully different inputs that should produce different
 * cache entries.
 */
export function hashCompanyInput(input: Company): string {
  const normalized = JSON.stringify({
    name: input.name.trim().toLowerCase(),
    domain: input.domain.trim().toLowerCase(),
    location: input.location ?? null,
    founder: input.founder ?? null,
  });
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** Returns today's date as YYYYMMDD in the system's local timezone (matches IST when run on the VPS). */
export function todayStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function fileNameFor(key: CacheKey): string {
  return `${key.adapterName}-${key.inputHash}-${key.adapterVersion}-${key.date}.json`;
}

export function createFileCache(dir: string): Cache {
  return {
    async read<T>(key: CacheKey, ttlMs?: number): Promise<AdapterResult<T> | null> {
      const path = join(dir, fileNameFor(key));
      try {
        if (ttlMs !== undefined) {
          const stats = await stat(path);
          if (Date.now() - stats.mtimeMs > ttlMs) return null;
        }
        const raw = await readFile(path, 'utf8');
        return JSON.parse(raw) as AdapterResult<T>;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async write<T>(key: CacheKey, value: AdapterResult<T>): Promise<void> {
      await mkdir(dir, { recursive: true });
      const path = join(dir, fileNameFor(key));
      await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
    },
    async clear(): Promise<void> {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      await Promise.all(entries.map((f) => unlink(join(dir, f)).catch(() => {})));
    },
  };
}
