import { describe, it, expect } from 'vitest';
import {
  guardrailKeysFor, validateGuardrail, validateGuardrailPayload, parseStoredValue,
} from '../../../src/core/config/guardrailsSchema.js';

describe('guardrailsSchema', () => {
  it('returns the sendEmails key set', () => {
    expect(guardrailKeysFor('sendEmails')).toEqual([
      'email_max_words', 'email_min_words', 'send_holidays', 'spam_words',
    ]);
  });

  it('returns the findLeads key set', () => {
    expect(guardrailKeysFor('findLeads')).toEqual(['findleads_size_prompts']);
  });

  it('returns [] for engines without guardrails', () => {
    expect(guardrailKeysFor('healthCheck')).toEqual([]);
    expect(guardrailKeysFor('dailyReport')).toEqual([]);
    expect(guardrailKeysFor('checkReplies')).toEqual([]);
    expect(guardrailKeysFor('sendFollowups')).toEqual([]);
  });

  it('validateGuardrail("spam_words", ...) rejects empty array', () => {
    expect(() => validateGuardrail('spam_words', [])).toThrow(/non-empty/);
  });

  it('validateGuardrail("email_min_words", ...) rejects non-integer', () => {
    expect(() => validateGuardrail('email_min_words', 12.5)).toThrow(/integer/);
  });

  it('validateGuardrail("send_holidays", ...) rejects bad dates', () => {
    expect(() => validateGuardrail('send_holidays', ['99-01'])).toThrow(/MM-DD/);
    expect(() => validateGuardrail('send_holidays', ['2026-01-15'])).toThrow(/MM-DD/);
  });

  it('validateGuardrail("send_holidays", ...) accepts valid MM-DD', () => {
    expect(() => validateGuardrail('send_holidays', ['01-26', '08-15'])).not.toThrow();
  });

  it('validateGuardrailPayload rejects min >= max', () => {
    expect(() => validateGuardrailPayload('sendEmails', {
      email_min_words: 90, email_max_words: 40,
    })).toThrow(/min.*max/i);
  });

  it('validateGuardrailPayload rejects unknown key for engine', () => {
    expect(() => validateGuardrailPayload('sendEmails', {
      findleads_size_prompts: { msme: 'x', sme: 'y', both: 'z' },
    })).toThrow(/not a guardrail/);
  });

  it('parseStoredValue converts JSON strings back to parsed values', () => {
    expect(parseStoredValue('spam_words', JSON.stringify(['free', 'spam']))).toEqual(['free', 'spam']);
    expect(parseStoredValue('email_min_words', '40')).toBe(40);
    expect(parseStoredValue('findleads_size_prompts', '{"msme":"a","sme":"b","both":"c"}')).toEqual({
      msme: 'a', sme: 'b', both: 'c',
    });
  });

  it('findleads_size_prompts requires all three size keys', () => {
    expect(() => validateGuardrail('findleads_size_prompts', { msme: 'x', sme: 'y' })).toThrow(/both/);
    expect(() => validateGuardrail('findleads_size_prompts', { msme: '', sme: 'y', both: 'z' })).toThrow(/msme/);
  });
});
