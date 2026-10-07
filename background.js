const ALARM = 'net-regime-check';
const DEFAULTS = { intervalMinutes: 5, timeoutSeconds: 10, consecutiveRequired: 2, notifications: true };
const HISTORY_LIMIT = 500;
const PING_LIMIT = 10000;

const GROUPS = {
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
    ['Rutube', 'https://rutube.ru/']
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
    ['Cloudflare Edge', 'https://cloudflare.com/']
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
    ['Medium', 'https://medium.com/']
  ]
};

let currentAbortController = null;

chrome.runtime.onInstalled.addListener(async () => { await ensureAlarm(); await runCheck(); });
chrome.runtime.onStartup.addListener(async () => { await ensureAlarm(); await runCheck(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) runCheck(); });

// Авто-проверка при смене сетевого статуса компьютера:
// - в Service Worker ловим online/offline (когда поддерживается),
// - дополнительно popup/dashboard шлют 'network-changed' при window online/offline.
try {
  self.addEventListener('online', () => { runCheck(true).catch(e => console.error(e)); });
  self.addEventListener('offline', () => { runCheck(true).catch(e => console.error(e)); });
} catch (e) {}

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.type === 'run-check') {
    runCheck(true).then(sendResponse).catch(e => console.error(e));
    return true;
  }
  if (message.type === 'save-settings') {
    saveSettings(message.settings).then(sendResponse);
    return true;
  }
  if (message.type === 'get-custom-sites') {
    chrome.storage.local.get(['customSites']).then(d => sendResponse(d.customSites || []));
    return true;
  }
  if (message.type === 'add-custom-site') {
    chrome.storage.local.get(['customSites']).then(async d => {
      const list = d.customSites || [];
      const newSite = { id: 'custom_' + Date.now(), name: message.site.name, url: message.site.url, group: message.site.group };
      list.push(newSite);
      await chrome.storage.local.set({ customSites: list });
      sendResponse({ ok: true, customSites: list });
    });
    return true;
  }
  if (message.type === 'remove-custom-site') {
    chrome.storage.local.get(['customSites']).then(async d => {
      const list = (d.customSites || []).filter(x => x.id !== message.id);
      await chrome.storage.local.set({ customSites: list });
      sendResponse({ ok: true, customSites: list });
    });
    return true;
  }
  if (message.type === 'network-changed') {
    runCheck(true).then(sendResponse).catch(e => console.error(e));
    return true;
  }
  if (message.type === 'get-netinfo') {
    chrome.storage.local.get(['netInfo']).then(d => sendResponse(d.netInfo || null));
    return true;
  }
  if (message.type === 'get-dns-config') {
    getDnsConfig().then(sendResponse);
    return true;
  }
  if (message.type === 'save-dns-config') {
    saveDnsConfig(message.config || {}).then(sendResponse);
    return true;
  }
  if (message.type === 'get-history') {
    chrome.storage.local.get(['history','pingLog','lastCheck','stableState','netInfo']).then(d => sendResponse({
      history: d.history || [],
      pingLog: d.pingLog || [],
      lastCheck: d.lastCheck || null,
      stableState: d.stableState || null,
      netInfo: d.netInfo || null
    }));
    return true;
  }
  if (message.type === 'clear-history') {
    chrome.storage.local.set({ history: [], pingLog: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'export-history') {
    chrome.storage.local.get(['history','pingLog']).then(d => sendResponse({ history: d.history||[], pingLog: d.pingLog||[] }));
    return true;
  }
});

async function settings() {
  const d = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...d };
}

async function ensureAlarm() {
  const s = await settings();
  const minutes = Math.max(0.5, Number(s.intervalMinutes) || 1);
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
}

async function saveSettings(next) {
  const intervalMinutes = Number(next.intervalMinutes) || 5;
  const timeoutSeconds = Number(next.timeoutSeconds) || 10;
  await chrome.storage.local.set({
    intervalMinutes: Math.max(0.5, Math.min(60, intervalMinutes)),
    timeoutSeconds: Math.max(1, Math.min(60, timeoutSeconds)),
    notifications: !!next.notifications
  });
  await ensureAlarm();
  return { ok: true };
}

async function probe(name, url, signal, timeoutMs, onComplete) {
  const started = Date.now();
  const controller = new AbortController();
  const combinedSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  try {
    const response = await fetch(url + (url.includes('?') ? '&' : '?') + '_nrm=' + Date.now(), {
      method: 'GET', cache: 'no-store', redirect: 'follow', signal: combinedSignal
    });
    const latency = Date.now() - started;
    const ok = response.status >= 200 && response.status < 500;
    result = { name, url, ok, status: response.status, latency, error: ok ? null : `${response.status}` };
  } catch (e) {
    const latency = Date.now() - started;
    const isTimeout = e.name === 'AbortError' || e.message?.includes('aborted');
    result = { name, url, ok: false, status: null, latency, error: isTimeout ? 'Таймаут' : 'Ошибка сети' };
  } finally {
    clearTimeout(timer);
    if (onComplete) onComplete(result);
  }
  return result;
}

function anySignal(signals) {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) { controller.abort(); break; }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function classify(groups) {
  const allResults = [...groups.ru, ...groups.global, ...groups.restricted];
  const finishedResults = allResults.filter(x => !x.loading);
  if (finishedResults.length === 0) return { code: 'CHECKING', label: 'Проверка доступности…', color: '#3b82f6' };
  const totalOk = allResults.filter(x => x.ok).length;
  const allTimeouts = finishedResults.length > 0 && finishedResults.every(x => x.error === 'Таймаут' || (!x.ok && !x.status));
  if (totalOk === 0) {
    if (finishedResults.length < allResults.length) return { code: 'CHECKING', label: 'Проверка доступности…', color: '#3b82f6' };
    if (allTimeouts) return { code: 'OUTAGE', label: 'Высокая задержка / таймауты сети', color: '#f59e0b' };
    return { code: 'OUTAGE', label: 'Нет сети / вероятный blackout', color: '#ef4444' };
  }
  const ruOk = groups.ru.filter(x => x.ok).length;
  const globalOk = groups.global.filter(x => x.ok).length;
  const restrictedOk = groups.restricted.filter(x => x.ok).length;
  const ruAny = ruOk > 0, globalAny = globalOk > 0, restrictedAny = restrictedOk > 0;
  if (!ruAny && (globalAny || restrictedAny)) return { code: 'FOREIGN', label: 'Зарубежный доступ в интернет РФ', color: '#8b5cf6' };
  if (ruAny && !globalAny) return { code: 'ALLOWLIST', label: 'Ограничения (белые списки / фильтрация)', color: '#f59e0b' };
  if (ruAny && globalAny && !restrictedAny) return { code: 'FILTERED', label: 'Селективная блокировка зарубежных сервисов', color: '#f97316' };
  if (ruAny && globalAny && restrictedAny) return { code: 'OPEN', label: 'Свободный доступ к сети', color: '#10b981' };
  return { code: 'MIXED', label: 'Смешанный или нестабильный режим', color: '#64748b' };
}

async function updateAction(state) {
  const short = { OUTAGE:'!', ALLOWLIST:'WL', FILTERED:'BL', OPEN:'OK', MIXED:'?', FOREIGN:'F' }[state.code] || '?';
  await chrome.action.setBadgeText({ text: short });
  await chrome.action.setBadgeBackgroundColor({ color: state.color });
  await chrome.action.setTitle({ title: `Net Regime Monitor: ${state.label}` });
}

function buildSiteStats(historyOrdered) {
  const map = new Map();
  for (const rec of historyOrdered) {
    for (const g of ['ru','global','restricted']) {
      for (const r of (rec.groups[g]||[])) {
        const key = r.url;
        if (!map.has(key)) map.set(key,{ name:r.name, url:r.url, group:g, total:0, ok:0, fail:0, latSum:0, latCount:0, lastOk:null, lastFail:null });
        const s = map.get(key);
        s.group = g; s.name = r.name;
        if (!r.loading) {
          s.total++;
          if (r.ok) { s.ok++; s.lastOk = rec.at; if (r.latency) { s.latSum+=r.latency; s.latCount++; } }
          else { s.fail++; s.lastFail = rec.at; }
        }
      }
    }
  }
  return [...map.values()].map(s=>({ ...s, uptime: s.total? (s.ok/s.total*100):0, avgLatency: s.latCount? Math.round(s.latSum/s.latCount): null }));
}

function broadcastUpdate(record) {
  chrome.runtime.sendMessage({ type: 'check-updated', record }).catch(() => {});
}

async function getActiveGroups() {
  const data = await chrome.storage.local.get(['customSites', 'disabledDefaultSites']);
  const customSites = data.customSites || [];
  const disabledDefaults = data.disabledDefaultSites || [];
  const groups = {
    ru: GROUPS.ru.filter(([name, url]) => !disabledDefaults.includes(url)),
    global: GROUPS.global.filter(([name, url]) => !disabledDefaults.includes(url)),
    restricted: GROUPS.restricted.filter(([name, url]) => !disabledDefaults.includes(url))
  };
  for (const site of customSites) {
    const targetGroup = groups[site.group] ? site.group : 'ru';
    if (!groups[targetGroup]) groups[targetGroup] = [];
    groups[targetGroup].push([site.name, site.url]);
  }
  return groups;
}

// --- Показатели текущего соединения: IP -> DNS ---
// Всё хранится в отдельном ключе storage 'netInfo', историю (history/pingLog)
// не трогаем и не перезаписываем, чтобы не потерять локальную БД.
async function timedFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const ms = Date.now() - started;
    return { res, ms };
  } catch (e) {
    return { res: null, ms: Date.now() - started, error: e };
  } finally {
    clearTimeout(timer);
  }
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

// Настраиваемые DNS-провайдеры (админка дашборда). DoH-эндпоинты в стиле
// cheburcheck (Quad9 DoH для обхода локальных ограничений + остальные).
const DEFAULT_DNS_PROVIDERS = [
  { id: 'cf', name: 'Cloudflare DNS', target: '1.1.1.1', doh: 'https://cloudflare-dns.com/dns-query', kind: 'dns-json', enabled: true },
  { id: 'google', name: 'Google DNS', target: '8.8.8.8', doh: 'https://dns.google/resolve', kind: 'google', enabled: true },
  { id: 'quad9', name: 'Quad9', target: '9.9.9.9', doh: 'https://dns.quad9.net/dns-query', kind: 'dns-json', enabled: true },
  { id: 'opendns', name: 'OpenDNS', target: '208.67.222.222', doh: 'https://doh.opendns.com/dns-query', kind: 'dns-json', enabled: true }
];
const DEFAULT_DNS_DOMAINS = ['example.com', 'ya.ru', 'instagram.com'];

async function getDnsConfig() {
  const d = await chrome.storage.local.get(['dnsProviders', 'dnsDomains']);
  const providers = Array.isArray(d.dnsProviders) && d.dnsProviders.length ? d.dnsProviders : DEFAULT_DNS_PROVIDERS;
  const domains = Array.isArray(d.dnsDomains) && d.dnsDomains.length ? d.dnsDomains : DEFAULT_DNS_DOMAINS;
  return { providers, domains };
}

async function saveDnsConfig(config) {
  const patch = {};
  if (Array.isArray(config.providers)) {
    patch.dnsProviders = config.providers
      .filter(p => p && p.doh)
      .map(p => ({ id: String(p.id || ('dns_' + Date.now() + Math.floor(Math.random() * 1000))), name: String(p.name || p.doh), target: String(p.target || ''), doh: String(p.doh), kind: p.kind === 'google' ? 'google' : 'dns-json', enabled: p.enabled !== false }))
      .slice(0, 20);
  }
  if (Array.isArray(config.domains)) {
    patch.dnsDomains = config.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean).slice(0, 20);
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  return { ok: true, ...(await getDnsConfig()) };
}

// Один DoH-запрос A-записи. Никогда не кидает исключение — возвращает объект результата.
async function dohQuery(provider, domain, timeoutMs) {
  const started = Date.now();
  try {
    const url = `${provider.doh}?name=${encodeURIComponent(domain)}&type=A`;
    const headers = provider.kind === 'google' ? {} : { accept: 'application/dns-json' };
    const { res } = await timedFetch(url, { headers, cache: 'no-store' }, timeoutMs);
    const ms = Date.now() - started;
    if (!res || !res.ok) return { ok: false, ms, error: 'Нет ответа' };
    let json = null;
    try { json = await res.json(); } catch (e) { return { ok: false, ms, error: 'Битый ответ' }; }
    const answers = (json.Answer || []).filter(a => a.type === 1 && a.data).map(a => a.data);
    return { ok: true, ms, answers, dnsStatus: (json.Status ?? null) };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: 'Ошибка сети' };
  }
}

function buildDnsVerdict(dnsResults, domains) {
  const notes = [];
  const inconsistentDomains = [];
  for (const domain of domains) {
    const answered = dnsResults.filter(r => r.answers && r.answers[domain]);
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
  const dead = dnsResults.filter(r => !r.ok);
  for (const r of dead) notes.push(`${r.name} (${r.target}): недоступен — возможно блокировка DoH или нет сети`);
  // Помечаем провайдеров, чей ответ отличается от большинства
  for (const domain of domains) {
    const answered = dnsResults.filter(r => r.answers && r.answers[domain]);
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

async function collectNetInfo(timeoutSeconds) {
  const timeoutMs = Math.max(2000, Math.min(30000, (Number(timeoutSeconds) || 10) * 1000));
  const started = Date.now();
  const { providers, domains } = await getDnsConfig().catch(() => ({ providers: DEFAULT_DNS_PROVIDERS, domains: DEFAULT_DNS_DOMAINS }));
  const active = providers.filter(p => p && p.enabled !== false && p.doh);
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
  const online = trace.ok || dnsResults.some(r => r.ok);
  const dnsVerdict = buildDnsVerdict(dnsResults, domains);
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
    dnsVerdict
  };
}

function broadcastNetInfo(netInfo) {
  chrome.runtime.sendMessage({ type: 'netinfo-updated', netInfo }).catch(() => {});
}

async function runCheck(isManual = false) {
  if (isManual && currentAbortController) {
    try { currentAbortController.abort(); } catch (e) {}
  }
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  const s = await settings();
  const activeGroups = await getActiveGroups();

  const groupsData = {
    ru: activeGroups.ru.map(([name, url]) => ({ name, url, ok: false, status: null, latency: 0, error: null, loading: true })),
    global: activeGroups.global.map(([name, url]) => ({ name, url, ok: false, status: null, latency: 0, error: null, loading: true })),
    restricted: activeGroups.restricted.map(([name, url]) => ({ name, url, ok: false, status: null, latency: 0, error: null, loading: true }))
  };

  const now = Date.now();
  const old = await chrome.storage.local.get(['stableState', 'candidateCode', 'candidateCount', 'history', 'pingLog', 'netInfo']);

  // Показатели соединения собираем параллельно опросам сайтов, не блокируя их.
  const netInfoPromise = collectNetInfo(s.timeoutSeconds).catch(() => ({ at: Date.now(), online: false, publicIp: null, dns: [], dnsDomains: [], dnsVerdict: { consistent: true, inconsistentDomains: [], notes: ['Не удалось собрать данные соединения'] } }));

  const initialCandidate = classify(groupsData);
  const initialRecord = {
    at: now,
    candidate: initialCandidate,
    stable: old.stableState || initialCandidate,
    groups: groupsData,
    intervalMinutes: s.intervalMinutes,
    netInfo: old.netInfo || null
  };
  await chrome.storage.local.set({ lastCheck: initialRecord });
  broadcastUpdate(initialRecord);

  const handleProbeComplete = async (groupKey, index, res) => {
    if (signal.aborted) return;
    groupsData[groupKey][index] = { ...res, loading: false };
    const candidate = classify(groupsData);
    const currentRecord = { at: now, candidate, stable: old.stableState || candidate, groups: groupsData, intervalMinutes: s.intervalMinutes, netInfo: old.netInfo || null };
    await chrome.storage.local.set({ lastCheck: currentRecord });
    broadcastUpdate(currentRecord);
  };

  const promises = [];
  ['ru', 'global', 'restricted'].forEach(groupKey => {
    activeGroups[groupKey].forEach(([name, url], index) => {
      const p = probe(name, url, signal, s.timeoutSeconds * 1000, (res) => handleProbeComplete(groupKey, index, res));
      promises.push(p);
    });
  });

  await Promise.allSettled(promises);
  const netInfo = await netInfoPromise;
  // Отдельный ключ — историю не перезаписываем и не чистим.
  // Сохраняем и рассылаем сразу, не дожидаясь конца опроса сайтов,
  // чтобы блок соединения не висел в «Сбор данных…».
  await chrome.storage.local.set({ netInfo });
  broadcastNetInfo(netInfo);

  if (signal.aborted) {
    const record = { at: now, candidate: classify(groupsData), stable: old.stableState, groups: groupsData, intervalMinutes: s.intervalMinutes, netInfo };
    return record;
  }

  const candidate = classify(groupsData);
  const fresh = await chrome.storage.local.get(['stableState', 'candidateCode', 'candidateCount', 'history', 'pingLog']);
  const baseCode = fresh.candidateCode ?? old.candidateCode;
  const baseCount = fresh.candidateCount ?? old.candidateCount;
  const baseStable = fresh.stableState ?? old.stableState;
  let candidateCount = baseCode === candidate.code ? (baseCount || 0) + 1 : 1;
  let stableState = baseStable || candidate;
  let changed = false;
  if (candidateCount >= s.consecutiveRequired && stableState.code !== candidate.code) { stableState = candidate; changed = true; }
  if (!baseStable) stableState = candidate;

  const record = { at: now, candidate, stable: stableState, groups: groupsData, intervalMinutes: s.intervalMinutes, netInfo };
  const history = [record, ...(fresh.history || old.history || [])].slice(0, HISTORY_LIMIT);
  const pingEntries = [];
  for (const g of ['ru','global','restricted']) for (const r of groupsData[g]) pingEntries.push({ at: now, group: g, name: r.name, url: r.url, ok: !!r.ok, status: r.status, latency: r.latency||0, error: r.error||null });
  const pingLog = [...pingEntries, ...(fresh.pingLog || old.pingLog || [])].slice(0, PING_LIMIT);
  const siteStats = buildSiteStats([...history].reverse());

  await chrome.storage.local.set({ stableState, candidateCode: candidate.code, candidateCount, lastCheck: record, history, pingLog, siteStats });
  // миграция: удалить чанки от неудачных оптимизаций
  chrome.storage.local.get(null).then(all=>{
    const bad=Object.keys(all).filter(k=>k.startsWith('history_chunk_')||k.startsWith('ping_chunk_'));
    if(bad.length) chrome.storage.local.remove(bad);
  });
  currentAbortController = null;
  await updateAction(stableState);
  if (changed && s.notifications) {
    await chrome.notifications.create(`network-${now}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Net Regime Monitor', message: stableState.label, priority: 1 });
  }
  broadcastUpdate(record);
  return record;
}
