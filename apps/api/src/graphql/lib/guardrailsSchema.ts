// Per-engine guardrail config keys + validators.
// Ported from src/core/config/guardrailsSchema.js. Once the legacy REST
// router src/api/routes/engineGuardrails.js is deleted, the legacy copy
// can be removed too.

type Validator = (v: unknown) => void
type Parser = (raw: unknown) => unknown

interface GuardrailEntry {
  parse: Parser
  validate: Validator
}

const SCHEMA: Record<string, Record<string, GuardrailEntry>> = {
  findLeads: {
    findleads_size_prompts: {
      parse: (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw),
      validate: (v) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          throw new Error('findleads_size_prompts must be an object')
        }
        const obj = v as Record<string, unknown>
        for (const k of ['msme', 'sme', 'both']) {
          if (typeof obj[k] !== 'string' || !(obj[k] as string).trim()) {
            throw new Error(`findleads_size_prompts.${k} must be a non-empty string`)
          }
        }
      },
    },
  },
  sendEmails: {
    spam_words: {
      parse: (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw),
      validate: (v) => {
        if (!Array.isArray(v) || v.length === 0) throw new Error('spam_words must be a non-empty array')
        if (!v.every((x) => typeof x === 'string' && x.trim())) {
          throw new Error('spam_words entries must be non-empty strings')
        }
      },
    },
    email_min_words: {
      parse: (raw) => (typeof raw === 'number' ? raw : parseInt(String(raw), 10)),
      validate: (v) => {
        if (!Number.isInteger(v) || (v as number) < 1) throw new Error('email_min_words must be a positive integer')
      },
    },
    email_max_words: {
      parse: (raw) => (typeof raw === 'number' ? raw : parseInt(String(raw), 10)),
      validate: (v) => {
        if (!Number.isInteger(v) || (v as number) < 1) throw new Error('email_max_words must be a positive integer')
      },
    },
    send_holidays: {
      parse: (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw),
      validate: (v) => {
        if (!Array.isArray(v)) throw new Error('send_holidays must be an array')
        // MM-DD format — year-independent so the list doesn't rot yearly.
        const bad = v.find((s) => typeof s !== 'string' || !/^\d{2}-\d{2}$/.test(s) || !isValidMmDd(s))
        if (bad !== undefined) throw new Error(`send_holidays: invalid date "${bad}" (expected MM-DD)`)
      },
    },
  },
}

function isValidMmDd(s: string): boolean {
  const [mm, dd] = s.split('-').map(Number)
  if (mm < 1 || mm > 12) return false
  if (dd < 1 || dd > 31) return false
  return true
}

export function guardrailKeysFor(engineName: string): string[] {
  return Object.keys(SCHEMA[engineName] ?? {}).sort()
}

export class GuardrailValidationError extends Error {
  field?: string
  constructor(message: string, field?: string) {
    super(message)
    this.field = field
  }
}

export function validateGuardrailPayload(engineName: string, payload: Record<string, unknown>): void {
  const engineSchema = SCHEMA[engineName] ?? {}
  for (const [key, value] of Object.entries(payload)) {
    if (!engineSchema[key]) {
      throw new GuardrailValidationError(`${key} is not a guardrail for ${engineName}`, key)
    }
    try {
      engineSchema[key].validate(value)
    } catch (err) {
      throw new GuardrailValidationError((err as Error).message, key)
    }
  }
  // Cross-field: email_min_words must be < email_max_words
  if ('email_min_words' in payload && 'email_max_words' in payload) {
    if ((payload.email_min_words as number) >= (payload.email_max_words as number)) {
      throw new GuardrailValidationError('email_min_words must be less than email_max_words', 'email_min_words')
    }
  }
}

export function parseStoredValue(key: string, storedString: string | null | undefined): unknown {
  for (const engine of Object.values(SCHEMA)) {
    if (engine[key]) return engine[key].parse(storedString)
  }
  return storedString
}
