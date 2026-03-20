import { describe, it, expect, afterEach } from 'vitest';
import { validate } from '../../utils/contentValidator.js';

describe('contentValidator', () => {
  const goodSubject = 'Quick question about your site';
  const goodBody = 'Hi John, I noticed your website hasn\'t been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat? Reply to this email and we can find a time. Darshan';

  afterEach(() => {
    delete process.env.SPAM_WORDS;
  });

  it('passes valid email', () => {
    const result = validate(goodSubject, goodBody, 0);
    expect(result.valid).toBe(true);
  });

  it('fails HTML content', () => {
    const result = validate(goodSubject, '<b>Hello</b> world', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/html/i);
  });

  it('fails body too short', () => {
    const result = validate(goodSubject, 'Too short', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/word count/i);
  });

  it('fails body too long', () => {
    const longBody = Array(100).fill('word').join(' ');
    const result = validate(goodSubject, longBody, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/word count/i);
  });

  it('fails URL in step 0', () => {
    const result = validate(goodSubject, goodBody + ' https://example.com', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/url/i);
  });

  it('allows URL in step 2', () => {
    const result = validate(goodSubject, goodBody + ' https://example.com', 2);
    expect(result.valid).toBe(true);
  });

  it('fails spam word', () => {
    process.env.SPAM_WORDS = 'free,guarantee';
    const result = validate(goodSubject, goodBody + ' This is a free offer', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/spam/i);
  });

  it('fails subject with !', () => {
    const result = validate('Amazing offer!', goodBody, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/subject/i);
  });

  it('fails unfilled template variable', () => {
    const bodyWithTemplate = 'Hello {{name}}, I noticed your website hasn\'t been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat? Reply to this email and we can find a time that works for both of us. Darshan';
    const result = validate(goodSubject, bodyWithTemplate, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unfilled/i);
  });
});
