import { readFile, access, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const sources = ['public/app.js', 'netlify/functions/api.mjs', 'netlify/functions/lib/core.mjs'];
await copyFile('worker/worker.py', 'public/connect.py');
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(`${file}: ${result.stderr}`);
}
const html = await readFile('public/index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (ids.length !== new Set(ids).size) throw new Error('Duplicate HTML identifier.');
const app = await readFile('public/app.js', 'utf8');
for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) if (!ids.includes(id)) throw new Error(`Missing interface element: ${id}`);
for (const [, asset] of html.matchAll(/(?:src|href)="\/(?!\/)([^"]+)"/g)) await access(`public/${asset}`);
if (/innerHTML|eval\(|new Function\(/.test(app)) throw new Error('Unsafe model-output rendering.');
console.log('Build checks passed: JavaScript syntax, interface references, static assets, and plain-text rendering.');
