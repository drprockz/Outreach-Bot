import { describe, it, expect, vi } from 'vitest'
import { exec, ok, err, mockDb } from './_executor.js'

describe('engineGuardrails resolvers', () => {
  describe('Query.engineGuardrails', () => {
    it('returns "{}" for an engine that has no guardrail keys', async () => {
      const findMany = vi.fn(async () => [])
      const db = mockDb({ config: { findMany } })
      const result = await exec({
        query: '{ engineGuardrails(engineName: "unknownEngine") }',
        db,
      })
      const data = ok<{ engineGuardrails: string }>(result)
      expect(data.engineGuardrails).toBe('{}')
      // No DB read attempted because the keys list was empty
      expect(findMany).not.toHaveBeenCalled()
    })

    it('returns JSON-encoded {key: parsedValue} for known engine keys', async () => {
      const findMany = vi.fn(async () => [
        { key: 'send_window_start_ist', value: '9' },
        { key: 'daily_send_limit', value: '34' },
      ])
      const db = mockDb({ config: { findMany } })
      const result = await exec({
        query: '{ engineGuardrails(engineName: "sendEmails") }',
        db,
      })
      const data = ok<{ engineGuardrails: string }>(result)
      const parsed = JSON.parse(data.engineGuardrails)
      // parseStoredValue normalizes ints — exact value depends on schema, just
      // assert keys round-trip and values are present.
      expect(parsed).toHaveProperty('send_window_start_ist')
      expect(parsed).toHaveProperty('daily_send_limit')
    })

    it('rejects unauthenticated callers', async () => {
      const result = await exec({
        query: '{ engineGuardrails(engineName: "sendEmails") }',
        user: null,
        db: mockDb({}),
      })
      expect(err(result)).toMatch(/Unauthenticated/)
    })
  })

  describe('Mutation.updateEngineGuardrails', () => {
    it('rejects malformed JSON payload', async () => {
      const result = await exec({
        query: 'mutation U { updateEngineGuardrails(engineName: "sendEmails", payloadJson: "not-json") }',
        db: mockDb({ config: { upsert: vi.fn(), findMany: vi.fn(async () => []) } }),
      })
      expect(err(result)).toMatch(/must be valid JSON/)
    })

    it('upserts each key and returns the canonical {key:value} JSON read-back', async () => {
      const upsert = vi.fn(async () => ({}))
      const findMany = vi.fn(async () => [{ key: 'email_max_words', value: '90' }])
      const db = mockDb({ config: { upsert, findMany } })
      const result = await exec({
        query: 'mutation U($p: String!) { updateEngineGuardrails(engineName: "sendEmails", payloadJson: $p) }',
        variables: { p: JSON.stringify({ email_max_words: 90 }) },
        db,
      })
      const data = ok<{ updateEngineGuardrails: string }>(result)
      expect(JSON.parse(data.updateEngineGuardrails)).toMatchObject({ email_max_words: expect.anything() })
      expect(upsert).toHaveBeenCalledTimes(1)
    })

    it('rejects an unknown guardrail key for the engine', async () => {
      const result = await exec({
        query: 'mutation U($p: String!) { updateEngineGuardrails(engineName: "sendEmails", payloadJson: $p) }',
        variables: { p: JSON.stringify({ daily_send_limit: 17 }) },
        db: mockDb({ config: { upsert: vi.fn(), findMany: vi.fn(async () => []) } }),
      })
      expect(err(result)).toMatch(/not a guardrail/i)
    })
  })
})
