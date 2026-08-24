const $ = s => document.querySelector(s);
const color = code => ({OUTAGE:'#ef4444',ALLOWLIST:'#f59e0b',FILTERED:'#f97316',OPEN:'#10b981',MIXED:'#64748b',FOREIGN:'#8b5cf6'})[code] || '#64748b';

let lastRecord = null;
let isChecking = false;
let timerInterval = null;
let lastTooltip = '';

const GROUP_TITLES = {
  ru: 'Российские сервисы',
  global: 'Нейтральные зарубежные',
  restricted: 'Ограниченные ресурсы (ЧС)'
};

const INTERVAL_VALUES = [1, 2, 3, 5, 10, 15, 20, 30];
const TIMEOUT_VALUES = [1, 3, 5, 10, 20, 30];

function formatClock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatAge(timestamp) {
  if (!timestamp) return 'ещё не проверялось';
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (s < 60) return `последняя проверка ${s} сек. назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `последняя проверка ${m} мин. назад`;
  const h = Math.round(m / 60);
  return `последняя проверка ${h} ч. назад`;
}

function updateRing(record) {
  const circle = $('#ring-circle');
  if (!circle) return;
  const radius = Number(circle.getAttribute('r'));
  const circumference = radius * 2 * Math.PI;
  circle.style.strokeDasharray = `${circumference} ${circumference}`;

  if (!record || !record.at) {
    circle.style.strokeDashoffset = circumference;
    $('#status-timing').title = 'Ещё не проверялось';
    lastTooltip = 'Ещё не проверялось';
    return;
  }

  const elapsedSec = Math.max(0, Math.round((Date.now() - record.at) / 1000));
  const intervalSec = (Number(record.intervalMinutes) || 5) * 60;
  const remainingSec = Math.max(0, intervalSec - elapsedSec);
  const progress = Math.min(1, elapsedSec / intervalSec);

  circle.style.strokeDashoffset = circumference - progress * circumference;

  const pastText = elapsedSec < 60 ? `Проверено ${elapsedSec} сек. назад` : `Проверено ${Math.round(elapsedSec/60)} мин. назад`;
  const nextText = `До след. проверки ${remainingSec} сек.`;
  const tooltip = `${pastText} · ${nextText}`;
  // Обновляем tooltip только при изменении значения, чтобы не сбрасывать наведение
  if (tooltip !== lastTooltip) {
    $('#status-timing').title = tooltip;
    lastTooltip = tooltip;
  }
}

function renderSub() {
  const sub = $('#last-check-sub');
  if (isChecking) {
    sub.textContent = lastRecord && lastRecord.at
      ? `Проверка выполняется… последняя была в ${formatClock(lastRecord.at)}`
      : 'Проверка выполняется…';
    sub.className = 'last-check-sub checking';
    return;
  }
  if (!lastRecord || !lastRecord.at) {
    sub.textContent = 'ещё не проверялось';
    sub.className = 'last-check-sub';
    return;
  }
  sub.textContent = formatAge(lastRecord.at);
  sub.className = 'last-check-sub';
}

function renderGroups(record) {
  const groupKeys = ['ru', 'global', 'restricted'];
  let html = '';
  for (const groupKey of groupKeys) {
    const results = record.groups[groupKey];
    if (!results) continue;
    const groupTitle = GROUP_TITLES[groupKey] || groupKey;
    html += `<div class="group-section"><h3>${groupTitle}</h3>`;
    const sortedResults = [...results].sort((a, b) => a.name.localeCompare(b.name));
    for (const x of sortedResults) {
      let statusText = '';
      let markColor = '#64748b';
      if (x.loading) {
        statusText = `<span class="row-loader" title="Проверка…"></span>`;
        markColor = '#64748b';
      } else if (x.ok) {
        statusText = `<span class="badge-success">${x.status} · ${x.latency}мс</span>`;
        markColor = '#10b981';
      } else {
        statusText = `<span class="badge-error">${x.error || 'Ошибка'}</span>`;
        markColor = '#ef4444';
      }
      html += `<div class="row"><span class="mark" style="background:${markColor}"></span><span class="name">${x.name}</span><span class="meta">${statusText}</span></div>`;
    }
    html += `</div>`;
  }
  $('#groups').innerHTML = html || '<div class="empty-groups">Нажмите «Проверить сейчас» для начала диагностики</div>';
}

function render(record) {
  lastRecord = record;
  const state = record?.stable || record?.candidate;

  // Текущий статус всегда показывает последний известный статус
  if (state) {
    $('#state').textContent = state.label;
    $('#state').style.color = color(state.code);
    $('#dot').style.background = color(state.code);
  } else {
    $('#state').textContent = 'Проверка доступности…';
    $('#state').style.color = '#64748b';
    $('#dot').style.background = '#64748b';
  }

  $('#dot').classList.toggle('pulse', isChecking);

  if (record) renderGroups(record);
  renderSub();
  updateRing(record);
}

function setChecking(value) {
  isChecking = value;
  $('#dot').classList.toggle('pulse', isChecking);
  renderSub();
  updateRing(lastRecord);
}

function setupSlider(id, values, valueId, current, unit, onchange) {
  const slider = $(id);
  const scale = document.getElementById(id.replace('slider', 'scale'));
  const label = $(valueId);
  slider.max = values.length - 1;
  const idx = values.indexOf(current);
  const initial = idx >= 0 ? idx : 0;
  slider.value = initial;
  label.textContent = values[initial];

  // Подписи-минимальные значения снизу
  if (scale) {
    scale.innerHTML = values.map(v => `<span>${v}</span>`).join('');
  }

  slider.addEventListener('input', () => {
    const i = Number(slider.value);
    label.textContent = values[i];
    if (onchange) onchange(values[i]);
  });
}

async function load() {
  const d = await chrome.storage.local.get(['lastCheck','intervalMinutes','timeoutSeconds','notifications']);

  setupSlider('#interval-slider', INTERVAL_VALUES, '#interval-value', d.intervalMinutes ?? 5, 'мин');
  setupSlider('#timeout-slider', TIMEOUT_VALUES, '#timeout-value', d.timeoutSeconds ?? 10, 'сек');

  $('#notifications').checked = d.notifications ?? true;
  render(d.lastCheck || null);
  await loadCustomSites();
}

async function loadCustomSites() {
  const res = await chrome.runtime.sendMessage({ type: 'get-custom-sites' });
  renderCustomSites(res || []);
}

function renderCustomSites(sites) {
  const listEl = $('#custom-sites-list');
  if (!listEl) return;
  if (!sites || sites.length === 0) {
    listEl.innerHTML = '<div class="empty-custom-sites">Нет добавленных сайтов</div>';
    return;
  }
  const groupNames = { ru: 'Российские', global: 'Зарубежные', restricted: 'ЧС' };
  let html = '';
  for (const s of sites) {
    const gName = groupNames[s.group] || s.group;
    html += `<div class="custom-site-item">
      <div class="custom-site-info">
        <span class="custom-site-title">${s.name} (${gName})</span>
        <span class="custom-site-url">${s.url}</span>
      </div>
      <button class="custom-site-delete" data-id="${s.id}" title="Удалить">×</button>
    </div>`;
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('.custom-site-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const res = await chrome.runtime.sendMessage({ type: 'remove-custom-site', id });
      renderCustomSites(res.customSites || []);
      setChecking(true);
      try {
        const checkRes = await chrome.runtime.sendMessage({ type: 'run-check' });
        setChecking(false);
        render(checkRes);
      } catch (e) {
        setChecking(false);
      }
    });
  });
}

$('#add-custom-site').addEventListener('click', async () => {
  const nameInput = $('#custom-name');
  const urlInput = $('#custom-url');
  const groupSelect = $('#custom-group');
  const name = nameInput.value.trim();
  let url = urlInput.value.trim();
  const group = groupSelect.value;

  if (!name || !url) {
    alert('Пожалуйста, введите название и URL сайта');
    return;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const res = await chrome.runtime.sendMessage({
    type: 'add-custom-site',
    site: { name, url, group }
  });

  nameInput.value = '';
  urlInput.value = '';
  renderCustomSites(res.customSites || []);

  setChecking(true);
  try {
    const checkRes = await chrome.runtime.sendMessage({ type: 'run-check' });
    setChecking(false);
    render(checkRes);
  } catch (e) {
    setChecking(false);
  }
});

$('#check').addEventListener('click', async () => {
  const btn = $('#check');
  btn.disabled = true;
  $('#btn-spinner').style.display = 'inline-block';
  btn.querySelector('.btn-text').textContent = 'Проверяем…';

  setChecking(true);

  try {
    const res = await chrome.runtime.sendMessage({ type: 'run-check' });
    setChecking(false);
    render(res);
  } catch (e) {
    setChecking(false);
    await load();
  } finally {
    btn.disabled = false;
    $('#btn-spinner').style.display = 'none';
    btn.querySelector('.btn-text').textContent = 'Проверить сейчас';
  }
});

$('#save').addEventListener('click', async () => {
  const saveBtn = $('#save');
  const intervalMinutes = INTERVAL_VALUES[Number($('#interval-slider').value)];
  const timeoutSeconds = TIMEOUT_VALUES[Number($('#timeout-slider').value)];
  await chrome.runtime.sendMessage({
    type: 'save-settings',
    settings: { intervalMinutes, timeoutSeconds, notifications: $('#notifications').checked }
  });
  saveBtn.textContent = 'Сохранено!';
  setTimeout(() => saveBtn.textContent = 'Сохранить настройки', 1200);
});

// Обновляем интерфейс при обновлении прогресса или завершении проверки в фоне
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'check-updated' && message.record) {
    render(message.record);
    const allResults = [...(message.record.groups.ru||[]), ...(message.record.groups.global||[]), ...(message.record.groups.restricted||[])];
    const stillLoading = allResults.some(x => x.loading);
    if (!stillLoading) {
      setChecking(false);
    }
  }
});

// Синхронизация при изменении данных в фоне (например, авто-проверка по таймеру)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastCheck) {
    const rec = changes.lastCheck.newValue;
    if (rec) {
      render(rec);
      const allResults = [...(rec.groups.ru||[]), ...(rec.groups.global||[]), ...(rec.groups.restricted||[])];
      const stillLoading = allResults.some(x => x.loading);
      if (!stillLoading) {
        setChecking(false);
      }
    } else {
      setChecking(false);
      render(null);
    }
  }
});

if (timerInterval) clearInterval(timerInterval);
timerInterval = setInterval(() => {
  if (lastRecord) {
    updateRing(lastRecord);
    renderSub();
  }
}, 1000);

load();
