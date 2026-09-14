// Fast pre-flight: syntax-checks every JavaScript file and compiles every EJS template.
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { root } from '../src/config.js';

async function files(dir, extension) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true, recursive: true });
  return entries.filter(e => e.isFile() && e.name.endsWith(extension)).map(e => path.join(e.parentPath, e.name));
}

let failed = 0;
const scripts = (await Promise.all(['src', 'scripts', 'tests', 'public/js'].map(dir => files(dir, '.js')))).flat();
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed++; console.error(result.stderr); }
}
const templates = await files('views', '.ejs');
for (const file of templates) {
  try {
    ejs.compile(await readFile(file, 'utf8'), { filename: file });
  } catch (error) {
    failed++;
    console.error(`${path.relative(root, file)}: ${error.message}`);
  }
}
console.log(`Checked ${scripts.length} scripts and ${templates.length} templates: ${failed ? `${failed} failed` : 'all OK'}.`);
process.exitCode = failed ? 1 : 0;
