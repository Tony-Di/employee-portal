import { root } from '../src/config.js';
import { createEnvFile } from '../src/setup.js';

if (await createEnvFile(root)) {
  console.log('Created .env with a random SESSION_SECRET. Review DATABASE_URL before starting.');
} else {
  console.log('.env already exists; left unchanged.');
}
console.log('Next: docker compose -f compose.dev.yml up -d, npm run migrate, npm run admin -- create, npm run dev');
