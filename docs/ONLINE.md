# Онлайн

Локально: `npm run server` (порт 8787) и `npm run dev`. Клиент на localhost сам подключается к `ws://localhost:8787`. Свой адрес сервера: `?server=wss://...` в ссылке.

Прод: Render, Blueprint `render.yaml` (сервис `titans-server`, free, Frankfurt). Клиент по умолчанию идёт на `wss://titans-server.onrender.com` (`SERVER_FALLBACK` в `client/play/online.ts`); если Render выдал другой адрес, поправить константу или задать `VITE_SERVER_URL` при сборке.

Free-тариф засыпает после 15 минут простоя, первое подключение занимает до минуты: меню показывает это и само повторяет попытки.

Протокол: `shared/net.ts`. Клиент шлёт намерения (`move`, `begin`, `target`, `release`, `cancel`, `repair`), сервер каждые 3 шага (20 Гц) шлёт снимок + события. Тесты: `tests/net.test.ts` (снимки и зеркальность правил), `tests/lobby.test.ts` (комнаты, пароли, бой).
