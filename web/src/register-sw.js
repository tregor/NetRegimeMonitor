// Регистрация service worker: весь JS/шелл приложения живёт в кеше браузера,
// страница открывается даже при полном отсутствии интернета.
export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}
