import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

let _bot;

function getBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  if (!_bot) _bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
  return _bot;
}

export async function sendAlert(message) {
  try {
    const bot = getBot();
    if (!bot || !process.env.TELEGRAM_CHAT_ID) {
      console.log('[Telegram stub]', message);
      return;
    }
    await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
  } catch (err) {
    // Never let Telegram failures crash the calling engine
    console.error('[Telegram error]', err.message);
  }
}
