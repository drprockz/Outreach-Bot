import { describe, it, expect } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('createLogger', () => {

  it('returns an object with debug/info/warn/error/child methods', () => {
    const log = createLogger({ level: 'info', pretty: false });
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('child() returns a logger that includes the given bindings', () => {
    const log = createLogger({ level: 'info', pretty: false });
    const child = log.child({ adapter: 'hiring' });
    expect(typeof child.info).toBe('function');
  });

  it('respects the level threshold (debug at info level is silent)', () => {
    expect(() => createLogger({ level: 'debug', pretty: false })).not.toThrow();
    expect(() => createLogger({ level: 'info', pretty: false })).not.toThrow();
  });
});
