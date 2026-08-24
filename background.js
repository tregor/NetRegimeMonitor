const ALARM = 'net-regime-check';
const DEFAULTS = { intervalMinutes: 5, timeoutSeconds: 10, consecutiveRequired: 2, notifications: true };

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

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.type === 'run-check') {
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch (e) {}
    }
    runCheck(true).then(sendResponse).catch(err => {
      if (err.message !== 'Aborted') console.error(err);
    });
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
});

async function settings() {
  const d = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...d };
}

async function ensureAlarm() {
  const s = await settings();
  const minutes = Math.max(0.5, Number(s.intervalMinutes) || 1);
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
    if (sig.aborted) {
      controller.abort();
      break;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function none(results) { return results.every(x => !x.ok); }
function all(results) { return results.every(x => x.ok); }
function any(results) { return results.some(x => x.ok); }

function classify(groups) {
  const allResults = [...groups.ru, ...groups.global, ...groups.restricted];
  const totalOk = allResults.filter(x => x.ok).length;
  const allTimeouts = allResults.every(x => x.error === 'Таймаут' || (!x.ok && !x.status));

  // Если вообще ни один сайт не ответил успехом
  if (totalOk === 0) {
    if (allTimeouts) {
      return { code: 'OUTAGE', label: 'Высокая задержка / таймауты сети', color: '#f59e0b' };
    }
    return { code: 'OUTAGE', label: 'Нет сети / вероятный blackout', color: '#ef4444' };
  }

  const ruResults = groups.ru;
  const globalResults = groups.global;
  const restrictedResults = groups.restricted;

  const ruOk = ruResults.filter(x => x.ok).length;
  const globalOk = globalResults.filter(x => x.ok).length;
  const restrictedOk = restrictedResults.filter(x => x.ok).length;

  const ruAny = ruOk > 0;
  const globalAny = globalOk > 0;
  const restrictedAny = restrictedOk > 0;

  // Частичная доступность (мало доступных сайтов)
  if (totalOk > 0 && totalOk < 4) {
    return { code: 'MIXED', label: 'Частичная доступность / деградация сети', color: '#f97316' };
  }

  // Доступны заблокированные в РФ сайты, а российские — нет
  if (!ruAny && (globalAny || restrictedAny)) return { code: 'FOREIGN', label: 'Зарубежный доступ в интернет РФ', color: '#8b5cf6' };

  // Российские доступны, а зарубежные нет — белые списки
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

function broadcastUpdate(record) {
  chrome.runtime.sendMessage({ type: 'check-updated', record }).catch(() => {});
}

async function getActiveGroups() {
  const data = await chrome.storage.local.get(['customSites']);
  const customSites = data.customSites || [];
  const groups = {
    ru: [...GROUPS.ru],
    global: [...GROUPS.global],
    restricted: [...GROUPS.restricted]
  };
  for (const site of customSites) {
    const targetGroup = groups[site.group] ? site.group : 'ru';
    if (!groups[targetGroup]) groups[targetGroup] = [];
    groups[targetGroup].push([site.name, site.url]);
  }
  return groups;
}

async function runCheck(isManual = false) {
  if (currentAbortController) {
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
  const old = await chrome.storage.local.get(['stableState', 'candidateCode', 'candidateCount', 'history']);
  
  const initialCandidate = classify(groupsData);
  const initialRecord = {
    at: now,
    candidate: initialCandidate,
    stable: old.stableState || initialCandidate,
    groups: groupsData,
    intervalMinutes: s.intervalMinutes
  };

  await chrome.storage.local.set({ lastCheck: initialRecord });
  broadcastUpdate(initialRecord);

  const handleProbeComplete = async (groupKey, index, res) => {
    if (signal.aborted) return;
    groupsData[groupKey][index] = { ...res, loading: false };

    const candidate = classify(groupsData);
    const currentRecord = {
      at: now,
      candidate,
      stable: old.stableState || candidate,
      groups: groupsData,
      intervalMinutes: s.intervalMinutes
    };

    await chrome.storage.local.set({ lastCheck: currentRecord });
    broadcastUpdate(currentRecord);
  };

  const promises = [];
  ['ru', 'global', 'restricted'].forEach(groupKey => {
    activeGroups[groupKey].forEach(([name, url], index) => {
      const p = probe(name, url, signal, s.timeoutSeconds * 1000, (res) => {
        handleProbeComplete(groupKey, index, res);
      });
      promises.push(p);
    });
  });

  await Promise.allSettled(promises);

  if (signal.aborted) {
    const record = { at: now, candidate: classify(groupsData), stable: old.stableState, groups: groupsData, intervalMinutes: s.intervalMinutes };
    return record;
  }

  const candidate = classify(groupsData);
  let candidateCount = old.candidateCode === candidate.code ? (old.candidateCount || 0) + 1 : 1;
  let stableState = old.stableState || candidate;
  let changed = false;
  if (candidateCount >= s.consecutiveRequired && stableState.code !== candidate.code) {
    stableState = candidate;
    changed = true;
  }
  if (!old.stableState) stableState = candidate;

  const record = { at: now, candidate, stable: stableState, groups: groupsData, intervalMinutes: s.intervalMinutes };
  const history = [record, ...(old.history || [])].slice(0, 100);

  await chrome.storage.local.set({ stableState, candidateCode: candidate.code, candidateCount, lastCheck: record, history });
  await updateAction(stableState);

  if (changed && s.notifications) {
    await chrome.notifications.create(`network-${now}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Net Regime Monitor', message: stableState.label, priority: 1 });
  }

  broadcastUpdate(record);
  return record;
}
