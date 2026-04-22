// Source of truth for per-engine guardrail config keys + validators.
// Imported by src/api/routes/engineGuardrails.js.

const SCHEMA = {
  findLeads: {
    findleads_size_prompts: {
      parse: (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw,
      validate: (v) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          throw new Error('findleads_size_prompts must be an object');
        }
        for (const k of ['msme', 'sme', 'both']) {
          if (typeof v[k] !== 'string' || !v[k].trim()) {
            throw new Error(`findleads_size_prompts.${k} must be a non-empty string`);
          }
        }
      },
    },
  },
  sendEmails: {
    spam_words: {
      parse: (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw,
      validate: (v) => {
        if (!Array.isArray(v) || v.length === 0) throw new Error('spam_words must be a non-empty array');
        if (!v.every(x => typeof x === 'string' && x.trim())) {
          throw new Error('spam_words entries must be non-empty strings');
        }
      },
    },
    email_min_words: {
      parse: (raw) => typeof raw === 'number' ? raw : parseInt(raw, 10),
      validate: (v) => {
        if (!Number.isInteger(v) || v < 1) throw new Error('email_min_words must be a positive integer');
      },
    },
    email_max_words: {
      parse: (raw) => typeof raw === 'number' ? raw : parseInt(raw, 10),
      validate: (v) => {
        if (!Number.isInteger(v) || v < 1) throw new Error('email_max_words must be a positive integer');
      },
    },
    send_holidays: {
      parse: (raw) => typeof raw === 'string' ? JSON.parse(raw) : raw,
      validate: (v) => {
        if (!Array.isArray(v)) throw new Error('send_holidays must be an array');
        // MM-DD format — year-independent so the list doesn't rot yearly.
        const bad = v.find(s => !/^\d{2}-\d{2}$/.test(s) || !isValidMmDd(s));
        if (bad !== undefined) throw new Error(`send_holidays: invalid date "${bad}" (expected MM-DD)`);
      },
    },
  },
  // Other engines have no guardrail surface.
};

function isValidMmDd(s) {
  const [mm, dd] = s.split('-').map(Number);
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  return true;
}

export function guardrailKeysFor(engineName) {
  return Object.keys(SCHEMA[engineName] || {}).sort();
}

export function validateGuardrail(key, value) {
  for (const engine of Object.values(SCHEMA)) {
    if (engine[key]) {
      engine[key].validate(value);
      return;
    }
  }
  throw new Error(`Unknown guardrail key: ${key}`);
}

export function validateGuardrailPayload(engineName, payload) {
  const engineSchema = SCHEMA[engineName] || {};
  for (const [key, value] of Object.entries(payload)) {
    if (!engineSchema[key]) {
      throw Object.assign(new Error(`${key} is not a guardrail for ${engineName}`), { field: key });
    }
    try {
      engineSchema[key].validate(value);
    } catch (err) {
      throw Object.assign(err, { field: key });
    }
  }
  // Cross-field: email_min_words must be < email_max_words
  if ('email_min_words' in payload && 'email_max_words' in payload) {
    if (payload.email_min_words >= payload.email_max_words) {
      throw Object.assign(new Error('email_min_words must be less than email_max_words'),
        { field: 'email_min_words' });
    }
  }
}

export function parseStoredValue(key, storedString) {
  for (const engine of Object.values(SCHEMA)) {
    if (engine[key]) return engine[key].parse(storedString);
  }
  return storedString;
}
