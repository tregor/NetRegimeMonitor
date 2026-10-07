// Упаковка расширения в versioned zip: releases/NetRegtimeMonitor-v<ver>-<YYYYMMDD-HHmmss>-<githash>.zip
// Без зависимостей (чистый Node): ZIP пишется методом store, плюс .sha256.txt рядом.
// Запуск: node tools/pack.mjs
// В пакет НЕ входят: .git, releases, *.zip, tools, test.js.
import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDE_DIRS = new Set(['.git', 'releases', 'tools', '.github', 'node_modules']);
const EXCLUDE_FILES = new Set(['test.js']);

// --- CRC32 (для ZIP нужен, в node:crypto его нет) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === '.git' || e === 'releases' || e === 'tools') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(e)) continue;
      walk(p, out);
    } else {
      if (EXCLUDE_FILES.has(e)) continue;
      if (e.endsWith('.zip')) continue;
      out.push(p);
    }
  }
  return out;
}

// Минимальный ZIP-writer (store, без сжатия): local header + central directory.
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // flags: UTF-8
    cd.writeUInt16LE(0, 10); // method: store
    cd.writeUInt32LE(0, 12); // time/date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    for (let i = 30; i < 42; i++) cd[i] = 0;
    cd.writeUInt32LE(offset, 42);
    central.push({ cd, nameBuf });
    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const { cd, nameBuf } of central) {
    chunks.push(cd, nameBuf);
    centralSize += cd.length + nameBuf.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  chunks.push(end);
  return Buffer.concat(chunks);
}

function gitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'nogit';
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version || '0.0.0';
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
const hash = gitHash();
const outDir = join(ROOT, 'releases');
mkdirSync(outDir, { recursive: true });
const zipName = `NetRegtimeMonitor-v${version}-${stamp}-${hash}.zip`;
const zipPath = join(outDir, zipName);

const paths = walk(ROOT).sort();
const files = paths.map((p) => ({
  name: relative(ROOT, p).replace(/\\/g, '/'),
  data: readFileSync(p),
}));
const zipBuf = buildZip(files);
writeFileSync(zipPath, zipBuf);
const sha256 = createHash('sha256').update(zipBuf).digest('hex');
writeFileSync(zipPath + '.sha256.txt', `${sha256}  ${zipName}\n`);

console.log(`Файлов в пакете: ${files.length}`);
console.log(`Архив: releases/${zipName} (${(zipBuf.length / 1024).toFixed(1)} KB)`);
console.log(`SHA256: ${sha256}`);
