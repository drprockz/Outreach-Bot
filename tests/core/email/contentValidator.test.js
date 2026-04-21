import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { validate } from '../../../src/core/email/contentValidator.js';
import { getTestPrisma, closeTestPrisma } from '../../helpers/testDb.js';

describe('contentValidator', () => {
  const goodSubject = 'Quick question about your site';
  const goodBody = 'Hi John, I noticed your website hasn\'t been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat? Reply to this email and we can find a time. Darshan';

  beforeEach(async () => {
    // Clear config keys the validator reads so the .env fallback path is exercised
    const prisma = getTestPrisma();
    await prisma.config.deleteMany({
      where: { key: { in: ['spam_words', 'email_min_words', 'email_max_words'] } },
    });
  });

  afterEach(() => {
    delete process.env.SPAM_WORDS;
  });

  afterAll(async () => { await closeTestPrisma(); });

  it('passes valid email', async () => {
    const result = await validate(goodSubject, goodBody, 0);
    expect(result.valid).toBe(true);
  });

  it('fails HTML content', async () => {
    const result = await validate(goodSubject, '<b>Hello</b> world', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/html/i);
  });

  it('fails body too short', async () => {
    const result = await validate(goodSubject, 'Too short', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/word count/i);
  });

  it('fails body too long', async () => {
    const longBody = Array(100).fill('word').join(' ');
    const result = await validate(goodSubject, longBody, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/word count/i);
  });

  it('fails URL in step 0', async () => {
    const result = await validate(goodSubject, goodBody + ' https://example.com', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/url/i);
  });

  it('allows URL in step 2', async () => {
    const result = await validate(goodSubject, goodBody + ' https://example.com', 2);
    expect(result.valid).toBe(true);
  });

  it('fails spam word', async () => {
    process.env.SPAM_WORDS = 'free,guarantee';
    const result = await validate(goodSubject, goodBody + ' This is a free offer', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/spam/i);
  });

  it('fails subject with !', async () => {
    const result = await validate('Amazing offer!', goodBody, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/subject/i);
  });

  it('fails unfilled template variable', async () => {
    const bodyWithTemplate = 'Hello {{name}}, I noticed your website hasn\'t been updated in a few years. I help businesses like yours modernize their web presence quickly. Would you be open to a quick chat? Reply to this email and we can find a time that works for both of us. Darshan';
    const result = await validate(goodSubject, bodyWithTemplate, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unfilled/i);
  });
});

describe('contentValidator — config-first with env fallback', () => {
  const goodSubject = 'Quick question about your site';

  beforeEach(async () => {
    const prisma = getTestPrisma();
    await prisma.config.deleteMany({
      where: { key: { in: ['spam_words', 'email_min_words', 'email_max_words'] } },
    });
  });

  afterAll(async () => { await closeTestPrisma(); });

  it('reads word limits from config when present', async () => {
    const prisma = getTestPrisma();
    await prisma.config.createMany({
      data: [
        { key: 'email_min_words', value: '30' },
        { key: 'email_max_words', value: '50' },
      ],
    });
    const shortBody = 'one two three four five';
    const result = await validate(goodSubject, shortBody, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/word count .* outside range 30-50/i);
  });

  it('reads spam words from config when present', async () => {
    const prisma = getTestPrisma();
    await prisma.config.create({
      data: { key: 'spam_words', value: JSON.stringify(['cryptocoin', 'bitcoin']) },
    });
    // Body is 50 words (inside default 40-90 range) and contains a config-sourced spam word
    const body = 'Hi John I wanted to reach out about cryptocoin opportunities. ' +
                 'Businesses like yours rarely think about it but overlooking this means missing a huge market. ' +
                 'I help teams explore safe ways forward quickly and carefully over short calls. ' +
                 'Reply if interested. Best regards Darshan here to help.';
    const result = await validate(goodSubject, body, 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/cryptocoin/);
  });
});
