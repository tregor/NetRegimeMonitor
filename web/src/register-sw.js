// Регистрация service worker: весь JS/шелл приложения живёт в кеше браузера,
// страница открывается даже при полном отсутствии интернета.
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Перехватываем приглашение установки PWA — кнопка в футере вызовет prompt().
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__nrmInstallPrompt = e;
    window.dispatchEvent(new Event('nrm-pwa-ready'));
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
