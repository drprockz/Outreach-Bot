export class SignalError extends Error {
  constructor(source, cause) {
    super(`[${source}] ${cause?.message || cause}`);
    this.source = source;
    this.cause = cause;
  }
}

// Adapter failures must never propagate — orchestrator depends on graceful degradation.
export function logAdapterFailure(source, err, logger = console) {
  logger.warn(`[signals] adapter "${source}" failed: ${err?.message || err}`);
}
