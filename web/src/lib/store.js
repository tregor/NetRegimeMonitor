// localStorage-хранилище веб-версии. Ключи свои (nrm_*), с расширением не пересекаются.
const HISTORY_LIMIT = 500;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — молча */ }
}

export const store = {
  get history() { return read('nrm_history', []); },
  set history(v) { write('nrm_history', (v || []).slice(0, HISTORY_LIMIT)); },
  get netInfo() { return read('nrm_netinfo', null); },
  set netInfo(v) { write('nrm_netinfo', v); },
  get dnsProviders() { return read('nrm_dns_providers', null); },
  set dnsProviders(v) { write('nrm_dns_providers', v); },
  get dnsDomains() { return read('nrm_dns_domains', null); },
  set dnsDomains(v) { write('nrm_dns_domains', v); },
  get settings() { return { intervalMinutes: 5, timeoutSeconds: 10, ...read('nrm_settings', {}) }; },
  set settings(v) { write('nrm_settings', v); },
  clearHistory() {
    write('nrm_history', []);
  },
};
