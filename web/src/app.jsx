import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { store } from './lib/store.js';
import {
  GROUPS, DEFAULT_DNS_PROVIDERS, DEFAULT_DNS_DOMAINS,
  probeSite, classify, collectNetInfo,
} from './lib/probe.js';
import {
  COLORS, STATE_COLORS, fmtShort, fmtTime, groupAvail, groupLatency, pearson,
  drawLineChart, drawStateDist, drawHeatmap,
} from './lib/charts.js';
import DnsTab from './components/DnsTab.jsx';

const GROUP_KEYS = ['ru', 'global', 'restricted'];
const GROUP_TITLES = { ru: 'Российские сервисы', global: 'Нейтральные зарубежные', restricted: 'Ограниченные ресурсы' };

function useOrdered(history, range) {
  return useMemo(() => {
    const n = Math.min(range, history.length || 0);
    if (!n) return [];
    const ordered = [...history].reverse();
    return ordered.slice(Math.max(0, ordered.length - n));
  }, [history, range]);
}

export default function App() {
  const [history, setHistory] = useState(() => store.history);
  const [live, setLive] = useState(null); // текущая/последняя проверка (с loading)
  const [netInfo, setNetInfo] = useState(() => store.netInfo);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState('overview');
  const [settings, setSettings] = useState(() => store.settings);
  const [dnsProviders, setDnsProviders] = useState(() => store.dnsProviders || DEFAULT_DNS_PROVIDERS);
  const [dnsDomains, setDnsDomains] = useState(() => store.dnsDomains || DEFAULT_DNS_DOMAINS);
  const [range, setRange] = useState(100);
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const runId = useRef(0);

  const saveSettings = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    store.settings = next;
  };
  const saveDns = (providers, domains) => {
    setDnsProviders(providers);
    setDnsDomains(domains);
    store.dnsProviders = providers;
    store.dnsDomains = domains;
  };

  async function runCheck() {
    const id = ++runId.current;
    setChecking(true);
    const timeoutMs = Math.max(1000, Math.min(60000, (Number(settings.timeoutSeconds) || 10) * 1000));
    const groupsData = {
      ru: GROUPS.ru.map(([name, url]) => ({ name, url, ok: false, status: null, latency: 0, error: null, loading: true })),
      global: GROUPS.global.map(([name, url]) => ({ name, url, ok: false, status: null, latency: 0, error: null, loading: true })),
      restricted: GROUPS.restricted.map(([name, url]) => ({ name, url, ok: false, status: null, latency: 0, error: null, loading: true })),
    };
    const now = Date.now();
    const snap = () => ({ at: now, candidate: classify(groupsData), stable: classify(groupsData), groups: JSON.parse(JSON.stringify(groupsData)), intervalMinutes: settings.intervalMinutes, netInfo: null });
    setLive(snap());

    // Соединение (IP→DNS) — сохраняем сразу, не ждём сайты
    collectNetInfo(timeoutMs, dnsProviders, dnsDomains)
      .then((ni) => {
        if (runId.current !== id) return;
        setNetInfo(ni);
        store.netInfo = ni;
      })
      .catch(() => {});

    const jobs = [];
    for (const g of GROUP_KEYS) {
      GROUPS[g].forEach(([name, url], index) => {
        jobs.push(
          probeSite(name, url, timeoutMs, (res) => {
            if (runId.current !== id) return;
            groupsData[g][index] = { ...res, loading: false };
            setLive(snap());
          }),
        );
      });
    }
    await Promise.allSettled(jobs);
    if (runId.current !== id) return;
    const candidate = classify(groupsData);
    const record = { at: now, candidate, stable: candidate, groups: groupsData, intervalMinutes: settings.intervalMinutes };
    const next = [record, ...store.history].slice(0, 500);
    store.history = next;
    setHistory(next);
    setLive({ ...record, netInfo: undefined });
    setChecking(false);
  }

  // Автопроверка по интервалу + при смене сетевого статуса
  useEffect(() => {
    const t = setInterval(() => { if (!checking) runCheck(); }, Math.max(1, Number(settings.intervalMinutes) || 5) * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.intervalMinutes]);
  useEffect(() => {
    const on = () => { setOnline(true); runCheck(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dnsProviders, dnsDomains, settings.timeoutSeconds]);

  const ordered = useOrdered(history, range);
  const display = live || history[0] || null;
  const state = display?.stable || display?.candidate || null;

  const titles = { overview: 'Дашборд доступности', history: 'Журнал пингов', sites: 'Сайты', dns: 'DNS-серверы', correlations: 'Корреляции' };

  return (
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-dot"></div>
          <div>
            <div class="brand-title">Net Regime Monitor</div>
            <div class="brand-sub">Веб-версия · работает офлайн</div>
          </div>
        </div>
        {!online && <div class="offline-banner">Нет сети — показаны сохранённые данные</div>}
        <nav class="nav">
          {Object.keys(titles).map((k) => (
            <button key={k} class={`nav-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              {k === 'overview' ? 'Обзор' : k === 'history' ? 'Журнал пингов' : k === 'sites' ? 'Сайты' : k === 'dns' ? 'DNS' : 'Корреляции'}
            </button>
          ))}
        </nav>
        <div class="sidebar-foot">
          <button class="btn primary w100" disabled={checking} onClick={runCheck}>
            {checking ? 'Проверяем…' : '↻ Проверить сейчас'}
          </button>
          <button
            class="btn danger w100"
            onClick={() => { if (confirm('Очистить всю историю пингов?')) { store.clearHistory(); setHistory([]); } }}
          >
            Очистить историю
          </button>
          <div class="settings-row">
            <div class="setting"><label>Интервал, мин</label><input type="number" min="1" max="60" value={settings.intervalMinutes} onChange={(e) => saveSettings({ intervalMinutes: Number(e.target.value) || 5 })} /></div>
            <div class="setting"><label>Таймаут, сек</label><input type="number" min="1" max="60" value={settings.timeoutSeconds} onChange={(e) => saveSettings({ timeoutSeconds: Number(e.target.value) || 10 })} /></div>
          </div>
          <div class="foot-note">{history.length}/500 проверок · офлайн-режим через кеш</div>
        </div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div>
            <h1>{titles[tab]}</h1>
            <div class="sub">{display ? `Последняя проверка: ${fmtTime(display.at)} · интервал ${display.intervalMinutes} мин` : 'Ещё не проверялось — нажмите «Проверить сейчас»'}</div>
          </div>
          <div class="top-actions">
            <span class="badge" style={state ? `background:${STATE_COLORS[state.code] || '#334155'};color:#fff` : ''}>
              {state ? state.label : 'Нет данных'}
            </span>
            <label class="range-label">Период
              <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
                <option value="50">Последние 50</option>
                <option value="100">Последние 100</option>
                <option value="250">Последние 250</option>
                <option value="500">Все (до 500)</option>
              </select>
            </label>
          </div>
        </header>

        {tab === 'overview' && <Overview ordered={ordered} history={history} display={display} netInfo={netInfo} state={state} />}
        {tab === 'history' && <HistoryTab ordered={ordered} />}
        {tab === 'sites' && <SitesTab ordered={ordered} />}
        {tab === 'dns' && <DnsTab netInfo={netInfo} providers={dnsProviders} domains={dnsDomains} onSave={saveDns} onCheck={runCheck} checking={checking} />}
        {tab === 'correlations' && <CorrTab ordered={ordered} />}
      </main>
    </div>
  );
}

function Overview({ ordered, history, display, netInfo, state }) {
  const availRef = useRef(null), latRef = useRef(null), statesRef = useRef(null), heatRef = useRef(null);
  const ni = netInfo || display?.netInfo || null;

  const kpi = useMemo(() => {
    const avg = (g) => {
      const vals = ordered.map((r) => groupAvail(r, g)).filter((v) => v !== null);
      if (!vals.length) return null;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    const allLat = ordered
      .map((r) => {
        const vals = GROUP_KEYS.map((g) => groupLatency(r, g)).filter((v) => v !== null);
        if (!vals.length) return null;
        return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      })
      .filter((v) => v !== null);
    return {
      ru: avg('ru'), global: avg('global'), restricted: avg('restricted'),
      lat: allLat.length ? Math.round(allLat.reduce((s, v) => s + v, 0) / allLat.length) : null,
    };
  }, [ordered]);

  useEffect(() => {
    const labels = ordered.map((r) => fmtShort(r.at));
    drawLineChart(availRef.current, [
      { color: COLORS.ru, data: ordered.map((r) => groupAvail(r, 'ru')) },
      { color: COLORS.global, data: ordered.map((r) => groupAvail(r, 'global')) },
      { color: COLORS.restricted, data: ordered.map((r) => groupAvail(r, 'restricted')) },
    ], { labels });
    const latSeries = [
      { color: COLORS.ru, data: ordered.map((r) => groupLatency(r, 'ru')) },
      { color: COLORS.global, data: ordered.map((r) => groupLatency(r, 'global')) },
      { color: COLORS.restricted, data: ordered.map((r) => groupLatency(r, 'restricted')) },
    ];
    const maxLat = Math.max(10, ...latSeries.flatMap((s) => s.data.filter((v) => v !== null)), 200);
    drawLineChart(latRef.current, latSeries, { labels, yMaxLatency: Math.ceil(maxLat / 100) * 100 });
    const counts = {};
    ordered.forEach((r) => { const c = (r.stable || r.candidate)?.code || 'MIXED'; counts[c] = (counts[c] || 0) + 1; });
    drawStateDist(statesRef.current, counts, ordered.length);
    drawHeatmap(heatRef.current, ordered);
  }, [ordered]);

  const kpiCell = (title, val) => (
    <div class="kpi"><div class="kpi-title">{title}</div>
      <div class="kpi-val">{val === null ? '—' : val.toFixed(1) + '%'}</div>
      <div class="kpi-bar"><i style={`width:${val === null ? 0 : val}%`}></i></div>
    </div>
  );

  return (
    <section class="tab active">
      <div class="card">
        <div class="card-head"><h3>Текущее соединение: IP → DNS</h3>
          <span class="badge" style={ni ? `background:${ni.online ? '#10b981' : '#ef4444'};color:#fff` : ''}>
            {ni ? (ni.online ? 'ONLINE' : 'OFFLINE') : 'Сбор…'}
          </span>
        </div>
        {!ni
          ? <span class="hint">Нет данных — нажмите «Проверить сейчас». Без интернета покажем последние сохранённые.</span>
          : <div class="net-grid">
            <div class="net-item"><div class="label">Внешний IP</div><div class="val">{ni.publicIp || '—'}</div><div class="sub">{[ni.loc, ni.colo].filter(Boolean).join(' · ') || 'локация неизвестна'}</div></div>
            <div class="net-item"><div class="label">До Cloudflare (trace)</div><div class={`val ${ni.traceMs != null ? 'ok' : 'bad'}`}>{ni.traceMs != null ? ni.traceMs + ' мс' : 'недоступно'}</div><div class="sub">IP → CDN edge</div></div>
            {(ni.dns || []).map((d) => (
              <div class="net-item" key={d.id}><div class="label">{d.name}</div>
                <div class={`val ${d.ok ? 'ok' : 'bad'}`}>{(d.ok ? d.ms + ' мс' : 'FAIL') + (d.diff ? ' ⚠' : '')}</div>
                <div class="sub">{d.target}</div>
              </div>
            ))}
          </div>}
        {ni && <div class="hint" style="margin-top:8px">Обновлено {fmtTime(ni.at)} · автообновление при смене сети (online/offline).</div>}
      </div>

      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-title">Проверок</div><div class="kpi-val">{history.length}</div>
          <div class="kpi-sub">{ordered.length ? `показано ${ordered.length}` : 'нет данных'}</div></div>
        {kpiCell('RU доступность', kpi.ru)}
        {kpiCell('Global доступность', kpi.global)}
        {kpiCell('Restricted доступность', kpi.restricted)}
        <div class="kpi"><div class="kpi-title">Средняя задержка</div><div class="kpi-val">{kpi.lat !== null ? kpi.lat + ' мс' : '—'}</div></div>
        <div class="kpi"><div class="kpi-title">Текущий режим</div>
          <div class="kpi-val small" style={state ? `color:${STATE_COLORS[state.code] || '#e2e8f0'}` : ''}>{state ? state.label : '—'}</div>
          <div class="kpi-sub">{state ? state.code : ''}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Доступность по группам во времени (%)</h3>
          <div class="legend"><span class="lg ru"></span> RU <span class="lg global"></span> Global <span class="lg restricted"></span> Restricted</div></div>
        <canvas ref={availRef} class="chart" width="1100" height="280"></canvas>
      </div>
      <div class="grid2">
        <div class="card"><div class="card-head"><h3>Средняя задержка по группам (мс)</h3></div>
          <canvas ref={latRef} class="chart" width="540" height="260"></canvas></div>
        <div class="card"><div class="card-head"><h3>Режимы сети (распределение)</h3></div>
          <canvas ref={statesRef} class="chart" width="540" height="260"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Лента проверок (heatmap)</h3><span class="hint">каждый столбец — одна проверка</span></div>
        <canvas ref={heatRef} class="chart" width="1100" height="140"></canvas>
      </div>

      {display && (
        <div class="card">
          <div class="card-head"><h3>Контрольные группы — последняя проверка</h3></div>
          {GROUP_KEYS.map((g) => (
            <div key={g} style="margin-bottom:10px">
              <div class="hint" style="margin-bottom:4px">{GROUP_TITLES[g]}</div>
              {(display.groups[g] || []).map((x) => (
                <div key={x.url} style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px dashed #1e293b;font-size:12px">
                  <span style={`width:8px;height:8px;border-radius:50%;flex:none;background:${x.loading ? '#64748b' : x.ok ? '#10b981' : '#ef4444'}`}></span>
                  <span style="flex:1">{x.name}</span>
                  <span style={`color:${x.loading ? '#64748b' : x.ok ? '#34d399' : '#f87171'}`}>
                    {x.loading ? '…' : x.ok ? `${x.status} · ${x.latency}мс` : (x.error || 'Ошибка')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryTab({ ordered }) {
  const [filter, setFilter] = useState('');
  const [fok, setFok] = useState('');
  const rows = useMemo(() => {
    const needle = filter.toLowerCase();
    return ordered
      .map((rec) => ({ rec, aRu: groupAvail(rec, 'ru'), aG: groupAvail(rec, 'global'), aR: groupAvail(rec, 'restricted') }))
      .filter((r) => {
        if (fok === 'ok' && ![r.aRu, r.aG, r.aR].every((v) => v === 100)) return false;
        if (fok === 'fail' && ![r.aRu, r.aG, r.aR].some((v) => v !== null && v < 100)) return false;
        if (needle && !((r.rec.stable || r.rec.candidate)?.label || '').toLowerCase().includes(needle)) return false;
        return true;
      })
      .reverse();
  }, [ordered, filter, fok]);
  const c = (v) => (v === null ? '—' : v.toFixed(0) + '%');
  return (
    <section class="tab active">
      <div class="card">
        <div class="card-head"><h3>Журнал проверок</h3>
          <div class="filters">
            <input value={filter} onInput={(e) => setFilter(e.target.value)} placeholder="Фильтр по режиму…" />
            <select value={fok} onChange={(e) => setFok(e.target.value)}>
              <option value="">Все</option><option value="ok">Только OK (100%)</option><option value="fail">Только с FAIL</option>
            </select>
          </div>
        </div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Время</th><th>Режим</th><th>RU</th><th>Global</th><th>Restricted</th></tr></thead>
          <tbody>
            {rows.map(({ rec, aRu, aG, aR }) => {
              const st = rec.stable || rec.candidate;
              return (
                <tr key={rec.at}>
                  <td>{fmtTime(rec.at)}</td>
                  <td><span class="mode-badge" style={`background:${STATE_COLORS[st?.code] || '#334155'}`}>{st?.code || '—'}</span> <span class="hint">{st?.label || ''}</span></td>
                  <td>{c(aRu)}</td><td>{c(aG)}</td><td>{c(aR)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colspan="5" style="text-align:center;color:#64748b">Нет записей</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  );
}

function SitesTab({ ordered }) {
  const rows = useMemo(() => {
    const map = new Map();
    ordered.forEach((rec) => GROUP_KEYS.forEach((g) => (rec.groups[g] || []).forEach((r) => {
      const key = r.url;
      if (!map.has(key)) map.set(key, { name: r.name, url: r.url, group: g, total: 0, ok: 0, fail: 0, latSum: 0, latCnt: 0, lastOk: null, lastFail: null });
      const s = map.get(key);
      s.group = g; s.name = r.name;
      if (!r.loading) {
        s.total++;
        if (r.ok) { s.ok++; s.latSum += (r.latency || 0); if (r.latency) s.latCnt++; s.lastOk = rec.at; }
        else { s.fail++; s.lastFail = rec.at; }
      }
    })));
    return [...map.values()]
      .map((s) => ({ ...s, uptime: s.total ? (s.ok / s.total) * 100 : 0, avg: s.latCnt ? Math.round(s.latSum / s.latCnt) : null }))
      .sort((a, b) => b.uptime - a.uptime);
  }, [ordered]);
  return (
    <section class="tab active">
      <div class="card">
        <div class="card-head"><h3>Рейтинг стабильности — все сайты</h3></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Сайт</th><th>Группа</th><th>Uptime %</th><th>OK / Fail</th><th>Ср. задержка</th><th>Последний OK</th><th>Последний FAIL</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.url}>
                <td>{s.name}</td><td>{s.group}</td>
                <td style={`color:${s.uptime > 80 ? '#10b981' : s.uptime > 50 ? '#f59e0b' : '#ef4444'};font-weight:700`}>{s.uptime.toFixed(1)}%</td>
                <td>{s.ok} / {s.fail}</td><td>{s.avg !== null ? s.avg + 'мс' : '—'}</td>
                <td>{s.lastOk ? fmtTime(s.lastOk) : '—'}</td><td>{s.lastFail ? fmtTime(s.lastFail) : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colspan="7" style="text-align:center;color:#64748b">Нет данных</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  );
}

function CorrTab({ ordered }) {
  const data = useMemo(() => {
    const ru = ordered.map((r) => groupAvail(r, 'ru') || 0);
    const gl = ordered.map((r) => groupAvail(r, 'global') || 0);
    const re = ordered.map((r) => groupAvail(r, 'restricted') || 0);
    return [
      { label: 'RU ↔ Global', r: pearson(ru, gl) },
      { label: 'RU ↔ Restricted', r: pearson(ru, re) },
      { label: 'Global ↔ Restricted', r: pearson(gl, re) },
    ];
  }, [ordered]);
  return (
    <section class="tab active">
      <div class="card">
        <div class="card-head"><h3>Корреляция доступности групп (Pearson r)</h3></div>
        <div class="corr-grid">
          {data.map((p) => (
            <div class="corr-cell" key={p.label}>
              <div class="label">{p.label}</div>
              <div class="val" style={`color:${p.r === null ? '#94a3b8' : p.r > 0 ? '#10b981' : '#ef4444'}`}>{p.r === null ? '—' : p.r.toFixed(3)}</div>
              <div class="bar"><i style={`width:${p.r === null ? 0 : Math.abs(p.r) * 100}%;background:${p.r !== null && p.r < 0 ? '#ef4444' : '#10b981'}`}></i></div>
            </div>
          ))}
        </div>
        <div class="hint" style="margin-top:8px">{ordered.length < 5 ? 'Мало данных для корреляции (нужно ≥5 проверок).' : `Рассчитано по ${ordered.length} точкам.`}</div>
      </div>
    </section>
  );
}
