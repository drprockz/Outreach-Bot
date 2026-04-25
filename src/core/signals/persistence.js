// Signal persistence — dedup via composite unique key (lead_id, source, signal_type, url).
// Confidence < 0.1 is treated as noise and skipped before writing.

export async function upsertSignals(prisma, leadId, source, signals) {
  const filtered = signals.filter(s => s.confidence >= 0.1);
  if (filtered.length === 0) return 0;

  return prisma.$transaction(async (tx) => {
    let count = 0;
    for (const s of filtered) {
      const url = s.url ?? '';
      await tx.leadSignal.upsert({
        where: {
          uq_lead_signals_dedup: {
            leadId,
            source,
            signalType: s.signalType,
            url,
          },
        },
        update: {
          headline: s.headline,
          payloadJson: s.payload,
          confidence: s.confidence,
          signalDate: s.signalDate ? new Date(s.signalDate) : null,
          collectedAt: new Date(),
        },
        create: {
          leadId,
          source,
          signalType: s.signalType,
          headline: s.headline,
          url,
          payloadJson: s.payload,
          confidence: s.confidence,
          signalDate: s.signalDate ? new Date(s.signalDate) : null,
        },
      });
      count++;
    }
    return count;
  });
}
