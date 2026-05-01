import pino from 'pino';
import type { Logger } from './types.js';

export interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty: boolean;
}

/**
 * Always writes to stderr (file descriptor 2) so stdout JSON output is uncontaminated.
 * Pretty-prints in dev/TTY, structured JSON otherwise.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const stream = opts.pretty
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          destination: 2,
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : pino.destination(2);

  const instance = pino({ level: opts.level }, stream);

  return wrap(instance);
}

function wrap(p: pino.Logger): Logger {
  return {
    debug: (msg, obj) => (obj ? p.debug(obj, msg) : p.debug(msg)),
    info: (msg, obj) => (obj ? p.info(obj, msg) : p.info(msg)),
    warn: (msg, obj) => (obj ? p.warn(obj, msg) : p.warn(msg)),
    error: (msg, obj) => (obj ? p.error(obj, msg) : p.error(msg)),
    child: (bindings) => wrap(p.child(bindings)),
  };
}
