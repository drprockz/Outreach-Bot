import TelegramBot from 'node-telegram-bot-api'

let _bot: TelegramBot | null = null

function getBot(): TelegramBot | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null
  if (!_bot) _bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)
  return _bot
}

/**
 * Send an alert to the configured Telegram chat. Failures never throw —
 * if the bot or chat is misconfigured, we log and move on. Calling
 * code MUST NOT depend on this returning successfully.
 */
export async function sendAlert(message: string): Promise<void> {
  try {
    const bot = getBot()
    if (!bot || !process.env.TELEGRAM_CHAT_ID) {
      // eslint-disable-next-line no-console
      console.log('[Telegram stub]', message)
      return
    }
    await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Telegram error]', (err as Error).message)
  }
}
