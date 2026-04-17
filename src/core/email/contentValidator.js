import 'dotenv/config';

const MAX_WORDS = parseInt(process.env.MAX_EMAIL_WORDS || '90');
const MIN_WORDS = parseInt(process.env.MIN_EMAIL_WORDS || '40');

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * @param {string} subject
 * @param {string} body
 * @param {number} step  sequence step (0-4)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validate(subject, body, step) {
  // Rule 1: No HTML
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return { valid: false, reason: 'HTML detected in body' };
  }

  // Rule 2: Word count
  const wc = wordCount(body);
  if (wc < MIN_WORDS || wc > MAX_WORDS) {
    return { valid: false, reason: `Word count ${wc} outside range ${MIN_WORDS}-${MAX_WORDS}` };
  }

  // Rule 3: No URL in step 0 or 1
  if (step <= 1 && /https?:\/\//i.test(body)) {
    return { valid: false, reason: 'URL found in step 0/1 body' };
  }

  // Rule 4: No spam words
  const spamWords = (process.env.SPAM_WORDS || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
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
