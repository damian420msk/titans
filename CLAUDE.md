# Титаны: правила работы

Новая сессия: сначала прочитай `docs/HANDOFF.md` (контекст проекта, владелец, где что лежит), потом `docs/ROADMAP.md` (главный документ версий: что есть, текущий спринт, что дальше). После каждого сделанного шага отмечай его в ROADMAP.

Игра: GDD лежит в Claude-проекте «Game Dev» (Docs). Здесь только то, что нужно для кода.

## Принципы
- Правила боя только в `shared/battle.ts` (+ `shared/bot.ts`). Без Babylon и DOM, детерминированно, шаг 1/60 с. Клиент только читает состояние и посылает намерения (`setMove`, `beginCharge`, `setTarget`, `releaseCharge`, `cancelCharge`, `beginRepair`).
- Числа берём из `docs/concept/titans_concept_v01/rules_v01.json` и `map_9x11.json`. Не менять баланс молча: правим JSON и записываем причину в `docs/DECISIONS.md`.
- Камера всегда смотрит на остров врага. Прицел = клетка под пальцем/мышью (`World.pick`). Камера стоит на месте пока держишь бросок (иначе курсор уезжает с клетки), в остальное время едет за титаном с постоянным наклоном и зумом, без «взгляда назад». Отмена: ПКМ/Esc или палец на ✕.
- Любое изменение механики сопровождается тестом в `tests/battle.test.ts`. `npm run check` должен проходить перед коммитом.
- Проверять игру в настоящем браузере (Playwright + swiftshader в облаке) и в мобильном эмулированном режиме. Одной компиляции мало.
- Node strip-types: в `shared/` и `tests/` нельзя parameter properties (`constructor(private x)`), enum, namespace.

## Структура
- `shared/world.ts` сетка и координаты (сторона 0 игрок, сторона 1 враг, повёрнута на 180°). `shared/battle.ts` правила. `shared/bot.ts` бот (easy/normal/hard).
- `shared/net.ts` протокол и снимки состояния (+ зеркало для гостя). `server/lobby.ts` комнаты и матчи (без сети, тестируется), `server/index.ts` HTTP /health + WebSocket (`npm run server`, порт 8787). `client/play/online.ts` сокет клиента, `menu.ts` экраны меню.
- `client/play/world.ts` сцена, острова из GLB, титаны, снаряды, эффекты, камера. `controls.ts` ввод. `main.ts` цикл и HUD. `hud.css` стили.
- `public/art/`: `platform-skins-v01` четыре комплекта плит (starter, terracotta, jade, basalt; в каждом тайлы, трещины, обломки, подложки, борта, углы; выбор через `shared/platformKits.ts`), `blocks-abc-v03` старые плиты (только для tools/concept), `titans-v03` титаны Meshy (rigged, webp), `bg-v01` спрайты неба/облаков/островов (пока не подключены).
- `tools/concept/` сцена для концепт-скриншотов (`/tools/concept/concept.html?scene=mid`).
- `docs/archive/` документы эпохи Codex, только для справки.
- `.mcp.json` проектные MCP (Playwright, Babylon NME/NPE/GUI). Установка локальных (Meshy, Blender): `docs/MCP_SETUP.md`.

## Инструменты (MCP)
- Playwright: проверка после любых изменений клиента: скриншот + консоль, ПК и телефон (915×412).
- Babylon NME/NPE/GUI: материалы, частицы, HUD собирать через MCP и сохранять JSON в репо, а не писать граф вручную в коде.
- Meshy: тратит кредиты. Перед каждой генерацией/риггингом/анимацией спрашивать и называть цену.
- Blender: перед работой сохранить .blend; результат экспортировать как сейчас (GLB в `public/art/`, MANIFEST).
- Если нужного сервера нет в `/mcp`, не обходить, а сказать и сослаться на `docs/MCP_SETUP.md`.

## Коммиты
Короткие, по-русски или по-английски, в конце строки `Co-Authored-By` и `Claude-Session` из напоминания сессии.
