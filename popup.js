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
    html += `<div class="group-section" data-group="${groupKey}">
      <div class="group-header-row">
        <h3>${groupTitle}</h3>
        <button class="add-site-trigger" data-group="${groupKey}" title="Добавить сайт">+</button>
      </div>
      <div class="group-form-container"></div>
      <div class="group-items-list">`;

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
      html += `<div class="row">
        <span class="mark" style="background:${markColor}"></span>
        <span class="name">${x.name}</span>
        <span class="meta">${statusText}</span>
        <button class="row-delete" data-name="${encodeURIComponent(x.name)}" data-url="${encodeURIComponent(x.url)}" title="Удалить сайт">×</button>
      </div>`;
    }
    html += `</div></div>`;
  }
  $('#groups').innerHTML = html || '<div class="empty-groups">Нажмите «Проверить сейчас» для начала диагностики</div>';

  attachGroupInteractions();
}

function attachGroupInteractions() {
  const groupsEl = $('#groups');
  if (!groupsEl) return;

  groupsEl.querySelectorAll('.add-site-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupKey = btn.getAttribute('data-group');
      const sectionEl = btn.closest('.group-section');
      const formContainer = sectionEl.querySelector('.group-form-container');
      if (formContainer.innerHTML.trim() !== '') {
        formContainer.innerHTML = '';
        return;
      }
      formContainer.innerHTML = `
        <div class="group-add-form">
          <input type="text" class="new-site-name" placeholder="Название (например, Мой сайт)">
          <input type="text" class="new-site-url" placeholder="URL (например, https://example.com/)">
          <div class="group-form-actions">
            <button class="group-form-btn primary-btn submit-add">Добавить</button>
            <button class="group-form-btn cancel-btn cancel-add">Отмена</button>
          </div>
        </div>
      `;

      formContainer.querySelector('.cancel-add').addEventListener('click', () => {
        formContainer.innerHTML = '';
      });

      formContainer.querySelector('.submit-add').addEventListener('click', async () => {
        const nameInput = formContainer.querySelector('.new-site-name');
        const urlInput = formContainer.querySelector('.new-site-url');
        const name = nameInput.value.trim();
        let url = urlInput.value.trim();
        if (!name || !url) {
          alert('Введите название и URL');
          return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }

        const data = await chrome.storage.local.get(['customSites']);
        const customSites = data.customSites || [];
        const newSite = { id: 'custom_' + Date.now(), name, url, group: groupKey };
        customSites.push(newSite);
        await chrome.storage.local.set({ customSites });

        formContainer.innerHTML = '';
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
  });

  groupsEl.querySelectorAll('.row-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = decodeURIComponent(btn.getAttribute('data-name'));
      const url = decodeURIComponent(btn.getAttribute('data-url'));

      const data = await chrome.storage.local.get(['customSites', 'disabledDefaultSites']);
      const customSites = data.customSites || [];
      const disabledDefaults = data.disabledDefaultSites || [];

      const customIdx = customSites.findIndex(s => s.url === url || s.name === name);
      if (customIdx >= 0) {
        customSites.splice(customIdx, 1);
        await chrome.storage.local.set({ customSites });
      } else {
        if (!disabledDefaults.includes(url)) {
          disabledDefaults.push(url);
          await chrome.storage.local.set({ disabledDefaultSites: disabledDefaults });
        }
      }

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

function render(record) {
  lastRecord = record;
  const state = record?.stable || record?.candidate;

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

  if (scale) {
    scale.innerHTML = values.map(v => `<span>${v}</span>`).join('');
  }

  slider.addEventListener('input', () => {
    const i = Number(slider.value);
    label.textContent = values[i];
    if (onchange) onchange(values[i]);
  });
}

async function saveCurrentSettings() {
  const intervalMinutes = INTERVAL_VALUES[Number($('#interval-slider').value)];
  const timeoutSeconds = TIMEOUT_VALUES[Number($('#timeout-slider').value)];
  const notifications = $('#notifications').checked;
  await chrome.runtime.sendMessage({
    type: 'save-settings',
    settings: { intervalMinutes, timeoutSeconds, notifications }
  });
}

async function load() {
  const d = await chrome.storage.local.get(['lastCheck','intervalMinutes','timeoutSeconds','notifications']);

  setupSlider('#interval-slider', INTERVAL_VALUES, '#interval-value', d.intervalMinutes ?? 5, 'мин', async () => {
    await saveCurrentSettings();
  });
  setupSlider('#timeout-slider', TIMEOUT_VALUES, '#timeout-value', d.timeoutSeconds ?? 10, 'сек', async () => {
    await saveCurrentSettings();
  });

  const notifCheckbox = $('#notifications');
  notifCheckbox.checked = d.notifications ?? true;
  notifCheckbox.addEventListener('change', async () => {
    await saveCurrentSettings();
  });

  render(d.lastCheck || null);
}

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
  await saveCurrentSettings();
  saveBtn.textContent = 'Сохранено!';
  setTimeout(() => saveBtn.textContent = 'Сохранить настройки', 1200);
});

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
