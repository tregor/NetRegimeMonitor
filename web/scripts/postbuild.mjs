// Постобработка vite-сборки: генерирует dist/sw.js со списком precache-URL
// (все файлы dist, кроме самого sw.js). Запуск: часть `npm run build`.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB, 'dist');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const buildId = Date.now().toString(36);
const urls = walk(DIST)
  .map((p) => '/' + p.slice(DIST.length + 1).replace(/\\/g, '/'))
  .filter((u) => !u.endsWith('/sw.js') && !u.includes('.vite/') && u !== '/_headers' && u !== '/_redirects');
if (!urls.includes('/index.html')) urls.unshift('/index.html');
if (!urls.includes('/')) urls.unshift('/');

const template = readFileSync(join(WEB, 'src', 'sw-template.js'), 'utf8');
const sw = template
  .replace('__BUILD_ID__', buildId)
  .replace('__PRECACHE_URLS__', JSON.stringify(urls));
writeFileSync(join(DIST, 'sw.js'), sw);
console.log(`sw.js: precache ${urls.length} URLs, cache nrm-shell-${buildId}`);
console.log(urls.join('\n'));
