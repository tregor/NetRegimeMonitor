import test from 'node:test';
import assert from 'node:assert';

function classify(groups) {
  const allResults = [...groups.ru, ...groups.global, ...groups.restricted];
  const totalOk = allResults.filter(x => x.ok).length;
  const allTimeouts = allResults.every(x => x.error === 'Таймаут' || (!x.ok && !x.status));

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

  if (!ruAny && (globalAny || restrictedAny)) return { code: 'FOREIGN', label: 'Зарубежный доступ в интернет РФ', color: '#8b5cf6' };
  if (ruAny && !globalAny) return { code: 'ALLOWLIST', label: 'Ограничения (белые списки / фильтрация)', color: '#f59e0b' };
  if (ruAny && globalAny && !restrictedAny) return { code: 'FILTERED', label: 'Селективная блокировка зарубежных сервисов', color: '#f97316' };
  if (ruAny && globalAny && restrictedAny) return { code: 'OPEN', label: 'Свободный доступ к сети', color: '#10b981' };

  return { code: 'MIXED', label: 'Смешанный или нестабильный режим', color: '#64748b' };
}

test('classify: total outage when all fail', () => {
  const groups = {
    ru: [{ ok: false, error: 'Ошибка сети' }],
    global: [{ ok: false, error: 'Ошибка сети' }],
    restricted: [{ ok: false, error: 'Ошибка сети' }]
  };
  const res = classify(groups);
  assert.strictEqual(res.code, 'OUTAGE');
});

test('classify: timeout outage when all timeout', () => {
  const groups = {
    ru: [{ ok: false, error: 'Таймаут' }],
    global: [{ ok: false, error: 'Таймаут' }],
    restricted: [{ ok: false, error: 'Таймаут' }]
  };
  const res = classify(groups);
  assert.strictEqual(res.code, 'OUTAGE');
  assert.strictEqual(res.label, 'Высокая задержка / таймауты сети');
});

test('classify: open network when all groups have working sites', () => {
  const groups = {
    ru: [{ ok: true, status: 200, latency: 100 }],
    global: [{ ok: true, status: 200, latency: 200 }],
    restricted: [{ ok: true, status: 200, latency: 300 }]
  };
  const res = classify(groups);
  assert.strictEqual(res.code, 'OPEN');
});

test('classify: allowlist when only ru works', () => {
  const groups = {
    ru: [{ ok: true, status: 200, latency: 100 }],
    global: [{ ok: false, error: 'Таймаут' }],
    restricted: [{ ok: false, error: 'Таймаут' }]
  };
  const res = classify(groups);
  assert.strictEqual(res.code, 'ALLOWLIST');
});
