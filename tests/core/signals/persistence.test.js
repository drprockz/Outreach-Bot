import { describe, it, expect, beforeEach, vi } from 'vitest';
import { upsertSignals } from '../../../src/core/signals/persistence.js';

const mockPrisma = {
  $transaction: vi.fn(async (fn) => fn(mockPrisma)),
  leadSignal: {
    upsert: vi.fn(async ({ create }) => ({ id: Math.random(), ...create })),
  },
};

describe('persistence.upsertSignals', () => {
  beforeEach(() => {
    mockPrisma.leadSignal.upsert.mockClear();
    mockPrisma.$transaction.mockClear();
  });

  it('upserts one row per signal using the dedup key', async () => {
    const signals = [
      { signalType: 'funding', headline: 'Raised $2M', url: 'https://x.com/a', payload: {}, confidence: 0.9, signalDate: '2026-04-01' },
      { signalType: 'hiring',  headline: 'Hiring eng',  url: 'https://x.com/b', payload: {}, confidence: 0.7, signalDate: null },
    ];
    await upsertSignals(mockPrisma, 42, 'google_news', signals);
    expect(mockPrisma.leadSignal.upsert).toHaveBeenCalledTimes(2);
  });

  it('skips signals with confidence < 0.1 as noise', async () => {
    await upsertSignals(mockPrisma, 42, 'google_news', [
      { signalType: 'press', headline: 'x', url: 'u', payload: {}, confidence: 0.05, signalDate: null },
    ]);
    expect(mockPrisma.leadSignal.upsert).not.toHaveBeenCalled();
  });

  it('returns 0 and skips transaction when nothing passes the noise filter', async () => {
    const count = await upsertSignals(mockPrisma, 42, 'google_news', [
      { signalType: 'press', headline: 'x', url: 'u', payload: {}, confidence: 0.0, signalDate: null },
    ]);
    expect(count).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses empty string for url in dedup key when signal url is null', async () => {
    await upsertSignals(mockPrisma, 7, 'tech_stack', [
      { signalType: 'tech', headline: 'React detected', url: null, payload: {}, confidence: 0.85, signalDate: null },
    ]);
    const call = mockPrisma.leadSignal.upsert.mock.calls[0][0];
    expect(call.where.uq_lead_signals_dedup.url).toBe('');
    expect(call.create.url).toBe('');
  });
});
