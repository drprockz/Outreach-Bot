import 'dotenv/config';
import { classifyReply } from '../lib/claude.js';

const replyText = process.argv.find((a) => a.startsWith('--reply='))?.split('=').slice(1).join('=')
  || 'Sounds interesting, what are your rates?';

console.log(`Testing reply classification`);
console.log(`Reply: "${replyText}"\n`);

try {
  const result = await classifyReply('test@example.com', 'Re: Web development inquiry', replyText);
  console.log('Classification result:\n');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Error: ${err.message}`);
}
