// Порт логики background.js расширения в чистый fetch (без chrome.*).
// Группы сайтов, опрос, классификация режима, DoH-замеры DNS, вердикт.

export const GROUPS = {
  ru: [
    ['Яндекс', 'https://ya.ru/'],
    ['VK', 'https://vk.com/'],
    ['Госуслуги', 'https://www.gosuslugi.ru/'],
    ['Mail.ru', 'https://mail.ru/'],
    ['Lenta.ru', 'https://lenta.ru/'],
    ['Habr', 'https://habr.com/'],
    ['Сбер', 'https://www.sberbank.ru/'],
    ['РИА Новости', 'https://ria.ru/'],
    ['РБК', 'https://www.rbc.ru/'],
    ['ВТБ', 'https://www.vtb.ru/'],
    ['Кинопоиск', 'https://www.kinopoisk.ru/'],
    ['Rutube', 'https://rutube.ru/'],
  ],
  global: [
    ['Example', 'https://example.com/'],
    ['Cloudflare', 'https://www.cloudflare.com/cdn-cgi/trace'],
    ['Wikipedia', 'https://www.wikipedia.org/'],
    ['Google', 'https://www.google.com/'],
    ['Cloudflare DNS', 'https://1.1.1.1/'],
    ['GitHub', 'https://github.com/'],
    ['Microsoft', 'https://www.microsoft.com/'],
    ['Apple', 'https://www.apple.com/'],
    ['Amazon', 'https://www.amazon.com/'],
    ['Cloudflare Edge', 'https://cloudflare.com/'],
  ],
  restricted: [
    ['Instagram', 'https://www.instagram.com/'],
    ['Facebook', 'https://www.facebook.com/'],
    ['X (Twitter)', 'https://x.com/'],
    ['YouTube', 'https://www.youtube.com/'],
    ['Discord', 'https://discord.com/'],
    ['Telegram', 'https://telegram.org/'],
    ['TikTok', 'https://www.tiktok.com/'],
    ['Netflix', 'https://www.netflix.com/'],
    ['Twitch', 'https://www.twitch.tv/'],
    ['Medium', 'https://medium.com/'],
  ],
};

export const DEFAULT_DNS_PROVIDERS = [
  { id: 'cf', name: 'Cloudflare DNS', target: '1.1.1.1', doh: 'https://cloudflare-dns.com/dns-query', kind: 'dns-json', enabled: true },
  { id: 'google', name: 'Google DNS', target: '8.8.8.8', doh: 'https://dns.google/resolve', kind: 'google', enabled: true },
  { id: 'quad9', name: 'Quad9', target: '9.9.9.9', doh: 'https://dns.quad9.net/dns-query', kind: 'dns-json', enabled: true },
  { id: 'opendns', name: 'OpenDNS', target: '208.67.222.222', doh: 'https://doh.opendns.com/dns-query', kind: 'dns-json', enabled: true },
];
export const DEFAULT_DNS_DOMAINS = ['example.com', 'ya.ru', 'instagram.com'];

export async function timedFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return { res, ms: Date.now() - started };
  } catch (e) {
    return { res: null, ms: Date.now() - started, error: e };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSite(name, url, timeoutMs, onComplete) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  try {
    const response = await fetch(url + (url.includes('?') ? '&' : '?') + '_nrm=' + Date.now(), {
      method: 'GET', cache: 'no-store', redirect: 'follow', signal: controller.signal,
    });
    const latency = Date.now() - started;
    const ok = response.status >= 200 && response.status < 500;
    result = { name, url, ok, status: response.status, latency, error: ok ? null : `${response.status}` };
  } catch (e) {
    const latency = Date.now() - started;
    result = { name, url, ok: false, status: null, latency, error: 'Ошибка сети' };
  } finally {
    clearTimeout(timer);
    if (onComplete) onComplete(result);
  }
  return result;
}

export function classify(groups) {
  const allResults = [...groups.ru, ...groups.global, ...groups.restricted];
  const finishedResults = allResults.filter((x) => !x.loading);
  if (finishedResults.length === 0) return { code: 'CHECKING', label: 'Проверка доступности…', color: '#3b82f6' };
  const totalOk = allResults.filter((x) => x.ok).length;
  const allTimeouts = finishedResults.length > 0 && finishedResults.every((x) => x.error === 'Таймаут' || (!x.ok && !x.status));
  if (totalOk === 0) {
    if (finishedResults.length < allResults.length) return { code: 'CHECKING', label: 'Проверка доступности…', color: '#3b82f6' };
    if (allTimeouts) return { code: 'OUTAGE', label: 'Высокая задержка / таймауты сети', color: '#f59e0b' };
    return { code: 'OUTAGE', label: 'Нет сети / вероятный blackout', color: '#ef4444' };
  }
  const ruOk = groups.ru.filter((x) => x.ok).length;
  const globalOk = groups.global.filter((x) => x.ok).length;
  const restrictedOk = groups.restricted.filter((x) => x.ok).length;
  const ruAny = ruOk > 0, globalAny = globalOk > 0, restrictedAny = restrictedOk > 0;
  if (!ruAny && (globalAny || restrictedAny)) return { code: 'FOREIGN', label: 'Зарубежный доступ в интернет РФ', color: '#8b5cf6' };
  if (ruAny && !globalAny) return { code: 'ALLOWLIST', label: 'Ограничения (белые списки / фильтрация)', color: '#f59e0b' };
  if (ruAny && globalAny && !restrictedAny) return { code: 'FILTERED', label: 'Селективная блокировка зарубежных сервисов', color: '#f97316' };
  if (ruAny && globalAny && restrictedAny) return { code: 'OPEN', label: 'Свободный доступ к сети', color: '#10b981' };
  return { code: 'MIXED', label: 'Смешанный или нестабильный режим', color: '#64748b' };
}

function parseTrace(text) {
  const out = {};
  if (!text) return out;
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export async function dohQuery(provider, domain, timeoutMs) {
  const started = Date.now();
  try {
    const url = `${provider.doh}?name=${encodeURIComponent(domain)}&type=A`;
    const headers = provider.kind === 'google' ? {} : { accept: 'application/dns-json' };
    const { res } = await timedFetch(url, { headers, cache: 'no-store' }, timeoutMs);
    const ms = Date.now() - started;
    if (!res || !res.ok) return { ok: false, ms, error: 'Нет ответа' };
    let json = null;
    try { json = await res.json(); } catch { return { ok: false, ms, error: 'Битый ответ' }; }
    const answers = (json.Answer || []).filter((a) => a.type === 1 && a.data).map((a) => a.data);
    return { ok: true, ms, answers, dnsStatus: (json.Status ?? null) };
  } catch {
    return { ok: false, ms: Date.now() - started, error: 'Ошибка сети' };
  }
}

export function buildDnsVerdict(dnsResults, domains) {
  const notes = [];
  const inconsistentDomains = [];
  for (const domain of domains) {
    const answered = dnsResults.filter((r) => r.answers && r.answers[domain]);
    if (answered.length < 2) continue;
    const variants = new Map();
    for (const r of answered) {
      const key = [...r.answers[domain]].sort().join(',');
      if (!variants.has(key)) variants.set(key, []);
      variants.get(key).push(r.name);
    }
    if (variants.size > 1) {
      inconsistentDomains.push(domain);
      const detail = [...variants.entries()].map(([ips, names]) => `${names.join('+')}: [${ips || 'пусто'}]`).join(' vs ');
      notes.push(`${domain}: ответы резолверов различаются (${detail}) — возможна подмена/фильтрация DNS`);
    }
  }
  for (const r of dnsResults.filter((r) => !r.ok)) {
    notes.push(`${r.name} (${r.target}): недоступен — возможно блокировка DoH или нет сети`);
  }
  for (const domain of domains) {
    const answered = dnsResults.filter((r) => r.answers && r.answers[domain]);
    if (!answered.length) continue;
    const counts = new Map();
    for (const r of answered) {
      const key = [...r.answers[domain]].sort().join(',');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let majority = null, best = -1;
    for (const [key, n] of counts) if (n > best) { best = n; majority = key; }
    for (const r of answered) {
      if ([...r.answers[domain]].sort().join(',') !== majority) r.diff = true;
    }
  }
  return { consistent: inconsistentDomains.length === 0, inconsistentDomains, notes };
}

export async function collectNetInfo(timeoutMs, providers, domains) {
  const started = Date.now();
  const active = (providers || []).filter((p) => p && p.enabled !== false && p.doh);
  const traceP = (async () => {
    const { res, ms } = await timedFetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' }, timeoutMs);
    if (!res || !res.ok) return { ok: false, ms };
    const t = parseTrace(await res.text().catch(() => ''));
    return { ok: true, ms, ip: t.ip || null, loc: t.loc || null, colo: t.colo || null, warp: t.warp || null };
  })();
  const dnsP = Promise.all(active.map(async (p) => {
    const answers = {};
    let ok = false, ms = null;
    for (const domain of domains) {
      const r = await dohQuery(p, domain, timeoutMs);
      if (ms === null) ms = r.ms;
      if (r.ok) { ok = true; answers[domain] = r.answers; }
      else answers[domain] = null;
    }
    return { id: p.id, name: p.name, target: p.target, ok, ms: ms ?? 0, answers, diff: false };
  }));
  const [trace, dnsResults] = await Promise.all([traceP, dnsP]);
  const online = trace.ok || dnsResults.some((r) => r.ok);
  return {
    at: Date.now(),
    durationMs: Date.now() - started,
    online,
    publicIp: trace.ip || null,
    loc: trace.loc || null,
    colo: trace.colo || null,
    warp: trace.warp || null,
    traceMs: trace.ok ? trace.ms : null,
    dns: dnsResults,
    dnsDomains: domains,
    dnsVerdict: buildDnsVerdict(dnsResults, domains),
  };
}
