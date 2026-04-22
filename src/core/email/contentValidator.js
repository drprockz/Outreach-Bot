import 'dotenv/config';
import { getConfigMap } from '../db/index.js';

// Which keys fell back to .env during the most recent validate() call.
// Read by server startup to warn if migration is incomplete.
const _fellBackKeys = new Set();

export function getFellBackKeys() {
  return Array.from(_fellBackKeys);
}

function envSpamWords() {
  return (process.env.SPAM_WORDS || '').split(',').map(w => w.trim()).filter(Boolean);
}

async function loadLimits() {
  let cfg = {};
  try { cfg = await getConfigMap(); } catch { cfg = {}; }

  const minRaw = cfg.email_min_words;
  const maxRaw = cfg.email_max_words;
  const min = parseInt(minRaw, 10);
  const max = parseInt(maxRaw, 10);

  let spam;
  try {
    spam = cfg.spam_words ? JSON.parse(cfg.spam_words) : null;
    if (!Array.isArray(spam) || spam.length === 0) spam = null;
  } catch { spam = null; }

  if (!Number.isFinite(min)) _fellBackKeys.add('email_min_words'); else _fellBackKeys.delete('email_min_words');
  if (!Number.isFinite(max)) _fellBackKeys.add('email_max_words'); else _fellBackKeys.delete('email_max_words');
  if (!spam) _fellBackKeys.add('spam_words'); else _fellBackKeys.delete('spam_words');

  return {
    min: Number.isFinite(min) ? min : parseInt(process.env.MIN_EMAIL_WORDS || '40', 10),
    max: Number.isFinite(max) ? max : parseInt(process.env.MAX_EMAIL_WORDS || '90', 10),
    spamWords: (spam || envSpamWords()).map(w => w.toLowerCase()),
  };
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * @param {string} subject
 * @param {string} body
 * @param {number} step  sequence step (0-4)
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validate(subject, body, step) {
  const { min, max, spamWords } = await loadLimits();

  // Rule 1: No HTML
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return { valid: false, reason: 'HTML detected in body' };
  }

  // Rule 2: Word count
  const wc = wordCount(body);
  if (wc < min || wc > max) {
    return { valid: false, reason: `Word count ${wc} outside range ${min}-${max}` };
  }

  // Rule 3: No URL in step 0 or 1
  if (step <= 1 && /https?:\/\//i.test(body)) {
    return { valid: false, reason: 'URL found in step 0/1 body' };
  }

  // Rule 4: No spam words
  const bodyLower = body.toLowerCase();
  for (const word of spamWords) {
    if (bodyLower.includes(word)) {
      return { valid: false, reason: `Spam word detected: "${word}"` };
    }
  }

  // Rule 5: Subject <=8 words, no ! or ? or ALL CAPS word
  const subjectWords = subject.trim().split(/\s+/);
  if (subjectWords.length > 8) {
    return { valid: false, reason: 'Subject exceeds 8 words' };
  }
  if (/[!?]/.test(subject)) {
    return { valid: false, reason: 'Subject contains ! or ?' };
  }
  if (/\b[A-Z]{3,}\b/.test(subject)) {
    return { valid: false, reason: 'Subject contains ALL CAPS word' };
  }

  // Rule 6: No unfilled template variables
  if (/\{\{/.test(body) || /\{\{/.test(subject)) {
    return { valid: false, reason: 'Unfilled template variable {{ }} detected' };
  }

  return { valid: true };
}
