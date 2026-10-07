// Постобработка vite-сборки: генерирует dist/sw.js со списком precache-URL
// (все файлы dist, кроме самого sw.js). Запуск: часть `npm run build`.
import { readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(WEB, '..');
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
  .filter((u) => !u.endsWith('/sw.js') && !u.includes('.vite/') && u !== '/_headers' && u !== '/_redirects' && u !== '/extension.zip');
if (!urls.includes('/index.html')) urls.unshift('/index.html');
if (!urls.includes('/')) urls.unshift('/');

const template = readFileSync(join(WEB, 'src', 'sw-template.js'), 'utf8');
const sw = template
  .replace('__BUILD_ID__', buildId)
  .replace('__PRECACHE_URLS__', JSON.stringify(urls));
writeFileSync(join(DIST, 'sw.js'), sw);
console.log(`sw.js: precache ${urls.length} URLs, cache nrm-shell-${buildId}`);
console.log(urls.join('\n'));

// Кнопка «Установить расширение»: кладём свежий архив из releases/ как /extension.zip.
try {
  const rel = join(ROOT, 'releases');
  const zips = readdirSync(rel).filter((f) => f.endsWith('.zip')).sort();
  if (zips.length) {
    const latest = join(rel, zips[zips.length - 1]);
    copyFileSync(latest, join(DIST, 'extension.zip'));
    console.log(`extension.zip: ${zips[zips.length - 1]}`);
  } else {
    console.log('extension.zip: нет архивов в releases/ (сначала node ../tools/pack.mjs)');
  }
} catch {
  console.log('extension.zip: нет папки releases/ (сначала node ../tools/pack.mjs)');
}
