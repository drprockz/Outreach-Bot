import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn(async () => ({
        response: { text: () => 'mock response', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }
      }))
    }))
  }))
}));

describe('gemini client', () => {
  it('callGemini returns text and cost', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const { callGemini } = await import('../../../src/core/ai/gemini.js');
    const result = await callGemini('test prompt');
    expect(result.text).toBe('mock response');
    expect(typeof result.costUsd).toBe('number');
  });
});
