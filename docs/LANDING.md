# NetRegimeMonitor: сайт, веб-монитор и деплой

Актуально на 19 октября 2026 года.

`https://net-regime-monitor.therephrase.com/` остаётся в репозитории **NetRegtimeMonitor**, в `web/`. Статический маркетинговый текст и рабочий монитор публикуются вместе. Этот сайт не входит в Astro-сборки `tregor-ecosystem` и не имеет там SITE_ID `netmonitor` или `net-regime-monitor`.

В `tregor-ecosystem/packages/registry/index.ts` есть только карточка и ссылка NetRegimeMonitor. Общие Astro-шаблоны и генератор JSON-LD на этот сайт автоматически не распространяются.

## Где менять

- `web/index.html` — индексируемое описание, CTA, изображение расширения и JSON-LD.
- `web/src/app.jsx`, `web/src/styles.css` — рабочий интерфейс и оформление.
- `web/public/extension-popup.webp` — собственный снимок расширения.
- `web/wrangler.jsonc` — существующий Worker `net-regime-monitor`, домен и `web/dist`.

## Сборка и выпуск

```bash
cd /mnt/e/Developer/NetRegtimeMonitor/web
npm run build
cd /mnt/e/Developer/tregor-ecosystem
node scripts/deploy-existing.mjs netmonitor
```

Зависимости проекта должны быть установлены (`npm ci` в `web/` при первом запуске). Helper использует Cloudflare-окружение Windows и Wrangler экосистемы, но выпускает **NetRegtimeMonitor/web/dist** по конфигу этого проекта. Он не собирает приложение, поэтому `npm run build` обязателен перед публикацией. При переносе рабочего каталога обновите абсолютные пути helper.

При самостоятельно настроенном Wrangler и Cloudflare-окружении экосистема для выпуска не обязательна:

```bash
cd /mnt/e/Developer/NetRegtimeMonitor/web
npm run build
npx wrangler deploy --config wrangler.jsonc
```

Не используйте `npm run deploy -- netmonitor` из экосистемы: такого SITE_ID нет. Обновление сайта не публикует новую версию расширения в Chrome Web Store; публикация расширения остаётся отдельным действием.

После выпуска проверьте статический текст/JSON-LD, canonical, sitemap, неизвестный URL (404), изображение, вкладки монитора и DNS, локальную историю и service worker. После изменения ссылок/описания обновите карточку в экосистеме и выпустите затронутые каталоги.

[Общая карта сайтов](../../tregor-ecosystem/docs/LANDING-OWNERSHIP.md).
