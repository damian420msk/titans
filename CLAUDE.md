# Титаны: правила работы

Игра: GDD лежит в Claude-проекте «Game Dev» (Docs). Здесь только то, что нужно для кода.

## Принципы
- Правила боя только в `shared/battle.ts` (+ `shared/bot.ts`). Без Babylon и DOM, детерминированно, шаг 1/60 с. Клиент только читает состояние и посылает намерения (`setMove`, `beginCharge`, `setTarget`, `releaseCharge`, `cancelCharge`, `beginRepair`).
- Числа берём из `docs/concept/titans_concept_v01/rules_v01.json` и `map_9x11.json`. Не менять баланс молча: правим JSON и записываем причину в `docs/DECISIONS.md`.
- Камера всегда смотрит на остров врага. Прицел = клетка под пальцем/мышью (`World.pick`). Камера отъезжает пока держишь бросок, возврат с задержкой. Отмена: ПКМ/Esc или палец на ✕.
- Любое изменение механики сопровождается тестом в `tests/battle.test.ts`. `npm run check` должен проходить перед коммитом.
- Проверять игру в настоящем браузере (Playwright + swiftshader в облаке) и в мобильном эмулированном режиме. Одной компиляции мало.
- Node strip-types: в `shared/` и `tests/` нельзя parameter properties (`constructor(private x)`), enum, namespace.

## Структура
- `shared/world.ts` сетка и координаты (сторона 0 игрок, сторона 1 враг, повёрнута на 180°). `shared/battle.ts` правила. `shared/bot.ts` бот (easy/normal/hard).
- `client/play/world.ts` сцена, острова из GLB, титаны, снаряды, эффекты, камера. `controls.ts` ввод. `main.ts` цикл и HUD. `hud.css` стили.
- `public/art/`: `blocks-abc-v03` плиты, `titans-v03` титаны Meshy (rigged, webp), `bg-v01` спрайты неба/облаков/островов (пока не подключены).
- `tools/concept/` сцена для концепт-скриншотов (`/tools/concept/concept.html?scene=mid`).
- `docs/archive/` документы эпохи Codex, только для справки.
- `.mcp.json` проектные MCP (Playwright, Babylon NME/NPE/GUI). Установка локальных (Meshy, Blender): `docs/MCP_SETUP.md`.

## Коммиты
Короткие, по-русски или по-английски, в конце строки `Co-Authored-By` и `Claude-Session` из напоминания сессии.
