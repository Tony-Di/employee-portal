import { parseArgs } from 'node:util';
import { createPool } from '../src/db.js';
import { createAdmin, listAdmins, resetPassword, setAdminActive } from '../src/services/admins.js';

const usage = `Usage:
  npm run admin -- create --email <email> --name <name>
  npm run admin -- reset-password --email <email>
  npm run admin -- deactivate --email <email>
  npm run admin -- activate --email <email>
  npm run admin -- list`;

// Piped stdin (automation) is read line by line; an interactive terminal gets a hidden prompt.
const pipedLines = process.stdin.isTTY ? null : (async function* () {
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) { yield buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1); }
  }
  if (buffer) yield buffer;
})();

async function askHidden(prompt) {
  process.stdout.write(prompt);
  if (pipedLines) {
    const { value = '' } = await pipedLines.next();
    process.stdout.write('\n');
    return value;
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = key => {
      for (const char of key) {
        if (char === '') { cleanup(); reject(new Error('Cancelled.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    process.stdin.on('data', onData);
  });
}

async function askNewPassword() {
  const password = await askHidden('New password (12–128 characters): ');
  const confirm = await askHidden('Repeat password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');
  return password;
}

const { positionals: [command], values } = parseArgs({
  allowPositionals: true, options: { email: { type: 'string' }, name: { type: 'string' } },
});
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required. Configure .env first.'); process.exit(1); }
const needsEmail = ['create', 'reset-password', 'deactivate', 'activate'].includes(command);
if (!needsEmail && command !== 'list') { console.error(usage); process.exit(1); }
if (needsEmail && !values.email) { console.error(`--email is required.\n${usage}`); process.exit(1); }

const pool = createPool(process.env.DATABASE_URL);
const found = ok => { if (!ok) throw new Error(`No admin with email ${values.email}.`); };
try {
  if (command === 'create') {
    if (!values.name) throw new Error('--name is required.');
    const admin = await createAdmin(pool, { name: values.name, email: values.email, password: await askNewPassword() });
    console.log(`Created admin ${admin.email}.`);
  } else if (command === 'reset-password') {
    found(await resetPassword(pool, values.email, await askNewPassword()));
    console.log(`Password updated for ${values.email}. Existing sessions stay valid until they expire or the admin is deactivated.`);
  } else if (command === 'deactivate' || command === 'activate') {
    found(await setAdminActive(pool, values.email, command === 'activate'));
    console.log(`${command === 'activate' ? 'Activated' : 'Deactivated'} ${values.email}.`);
  } else {
    const admins = await listAdmins(pool);
    if (!admins.length) console.log('No admins yet. Create one with: npm run admin -- create --email <email> --name <name>');
    for (const a of admins) console.log(`${a.id}\t${a.active ? 'active' : 'inactive'}\t${a.email}\t${a.name}`);
  }
  process.exitCode = 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  process.stdin.destroy();
}
