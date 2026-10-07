import { useState } from 'preact/hooks';
import { fmtTime } from '../lib/charts.js';

export default function DnsTab({ netInfo, providers, domains, onSave, onCheck, checking }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [doh, setDoh] = useState('');
  const [kind, setKind] = useState('dns-json');
  const [newDomain, setNewDomain] = useState('');

  const addProvider = () => {
    if (!doh.trim()) { alert('Укажите DoH URL'); return; }
    if (!/^https:\/\//.test(doh.trim())) { alert('DoH URL должен начинаться с https://'); return; }
    onSave(
      [...(providers || []), { id: 'dns_' + Date.now(), name: name.trim() || doh.trim(), target: target.trim(), doh: doh.trim(), kind, enabled: true }],
      domains,
    );
    setName(''); setTarget(''); setDoh('');
  };
  const addDomain = () => {
    const v = newDomain.trim().toLowerCase();
    if (!v) return;
    if (!(domains || []).includes(v)) onSave(providers, [...(domains || []), v]);
    setNewDomain('');
  };

  const lastMs = {};
  (netInfo?.dns || []).forEach((r) => { lastMs[r.id] = r; });
  const results = netInfo?.dns || [];
  const doms = netInfo?.dnsDomains || domains || [];

  return (
    <section class="tab active">
      <div class="card">
        <div class="card-head"><h3>DNS-провайдеры — настройка</h3>
          <span class="hint">опрос через DoH, как у cheburcheck</span></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Вкл</th><th>Имя</th><th>IP / цель</th><th>DoH URL</th><th>Задержка</th><th></th></tr></thead>
          <tbody>
            {(providers || []).map((p) => (
              <tr key={p.id}>
                <td><input type="checkbox" checked={p.enabled !== false} onChange={(e) => onSave(providers.map((x) => (x.id === p.id ? { ...x, enabled: e.target.checked } : x)), domains)} /></td>
                <td>{p.name}</td><td>{p.target || '—'}</td>
                <td style="word-break:break-all;max-width:280px">{p.doh}</td>
                <td>{lastMs[p.id] ? (lastMs[p.id].ok ? lastMs[p.id].ms + ' мс' : 'FAIL') + (lastMs[p.id].diff ? ' ⚠' : '') : '—'}</td>
                <td><button class="btn ghost" style="padding:4px 8px" onClick={() => onSave(providers.filter((x) => x.id !== p.id), domains)}>×</button></td>
              </tr>
            ))}
            {!(providers || []).length && <tr><td colspan="6" style="text-align:center;color:#64748b">Нет провайдеров — будут использованы встроенные по умолчанию</td></tr>}
          </tbody>
        </table></div>
        <div class="dns-form">
          <input value={name} onInput={(e) => setName(e.target.value)} placeholder="Имя (напр. Мой DNS)" />
          <input value={target} onInput={(e) => setTarget(e.target.value)} placeholder="IP (напр. 77.88.8.8)" />
          <input value={doh} onInput={(e) => setDoh(e.target.value)} placeholder="DoH URL (напр. https://…/dns-query)" />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="dns-json">dns-json</option>
            <option value="google">google-совместимый</option>
          </select>
          <button class="btn" onClick={addProvider}>Добавить</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Тестовые домены</h3></div>
        <div class="dns-domains">
          {(domains || []).map((d) => (
            <span class="dns-tag" key={d}>{d}
              <button title="Убрать" onClick={() => onSave(providers, domains.filter((x) => x !== d))}>×</button>
            </span>
          ))}
        </div>
        <div class="dns-form">
          <input value={newDomain} onInput={(e) => setNewDomain(e.target.value)} placeholder="домен (напр. tiktok.com)" />
          <button class="btn" onClick={addDomain}>Добавить домен</button>
          <button class="btn primary" disabled={checking} onClick={onCheck}>{checking ? 'Проверяем…' : '↻ Проверить сейчас'}</button>
        </div>
      </div>

      <div class="card">
                <div class="card-head"><h3>Ответы резолверов (A-записи)</h3><span class="hint">подсветка = отличается от большинства; красная рамка = признаки подмены</span></div>
        {!results.length
          ? <span class="hint">Нет данных — нажмите «Проверить сейчас».</span>
          : <div class="matrix-wrap"><table class="matrix">
            <thead><tr><th></th>{results.map((r) => <th key={r.id} title={r.target || ''}>{r.name}</th>)}</tr></thead>
            <tbody>
              {doms.map((dom) => (
                <tr key={dom}>
                  <td class="row-label">{dom}</td>
                  {results.map((r) => {
                    const ips = r.answers ? r.answers[dom] : undefined;
                    if (!r.ok || !ips) return <td key={r.id} class="cell-fail">FAIL</td>;
                    const hijacked = (netInfo?.dnsVerdict?.hijackDomains || []).includes(dom);
                    const title = `DNS-статус: ${r.statuses?.[dom] ?? '—'} (0=OK, 3=NXDOMAIN)`;
                    return <td key={r.id} title={title} class={`${r.diff ? 'cell-diff' : ''}${hijacked ? ' cell-hijack' : ''}`}>{ips.length ? ips.join(', ') : 'пусто (NXDOMAIN?)'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table></div>}
      </div>

      <div class="card">
        <div class="card-head"><h3>Вердикт DNS</h3></div>
        <ul class="insights">
          {!netInfo || !(netInfo.dnsVerdict?.notes || []).length
            ? <li>{netInfo ? 'Все резолверы отвечают согласованно, подмены DNS не видно.' : 'Нет данных.'}</li>
            : netInfo.dnsVerdict.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
        {netInfo && <div class="hint" style="margin-top:8px">Обновлено {fmtTime(netInfo.at)}</div>}
      </div>
    </section>
  );
}
