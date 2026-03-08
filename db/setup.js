import { initSchema } from './database.js';

console.log('Setting up database...');
initSchema();
console.log('Database initialized successfully.');
process.exit(0);
