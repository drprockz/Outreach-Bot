import { describe, it, expect, vi } from 'vitest';

describe('telegram stub', () => {
  it('sendAlert does not throw when token absent', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { sendAlert } = await import('../../../src/core/integrations/telegram.js');
    await expect(sendAlert('test message')).resolves.not.toThrow();
  });
});
