# Установка MCP для «Титанов» (Windows, Claude Code)

Инструкция для ИИ-агента в Claude Code на ПК разработчика. Выполняй по шагам, перед каждой установкой проверяй, не стоит ли уже. В конце дай отчёт по таблице из шага 7.

Правила для агента:
- API-ключи (Meshy) никогда не пиши в репозиторий и в чат. Команду с ключом пользователь вводит сам.
- Перед установкой программ (`winget`, аддон Blender) спроси разрешения.
- Если команда упала, не пробуй обходные пути вслепую: покажи ошибку и предложи вариант из этой инструкции.

## 0. Что уже есть

```bat
claude --version
claude mcp list
uv --version
where npx
where uvx
echo %MESHY_API_KEY%
type tools\blender-path.txt
```

Запиши, какие серверы уже есть в `claude mcp list` и в каком статусе. Серверы со статусом `✓ Connected` не трогай.

## 1. Проектные серверы (уже в репо, `.mcp.json`)

В `.mcp.json` лежат `playwright`, `babylon-nme` (Node Material), `babylon-npe` (Node Particle) и `babylon-gui` (GUI Editor). В облаке они проверены: все стартуют, у каждого 25–29 инструментов.

1. Запусти `claude` в корне репо и одобри серверы из `.mcp.json` (статус `⏸ Pending approval`).
2. Проверь `claude mcp list`: все четыре должны быть `✓ Connected`.
3. Если на Windows они падают из-за `npx`, добавь локальные переопределения с теми же именами. Local-скоуп главнее project, `.mcp.json` трогать не нужно:

```bat
claude mcp add -s local -t stdio playwright -- cmd /c npx -y @playwright/mcp@latest --headless --isolated
claude mcp add -s local -t stdio babylon-nme -- cmd /c npx -y @babylonjs/mcp-servers nme
claude mcp add -s local -t stdio babylon-npe -- cmd /c npx -y @babylonjs/mcp-servers npe
claude mcp add -s local -t stdio babylon-gui -- cmd /c npx -y @babylonjs/mcp-servers gui
```

Playwright по умолчанию использует установленный Google Chrome. Если Chrome нет, переопредели сервер с `--browser msedge`: Edge в Windows есть всегда. Если хочешь видеть окно браузера, убери `--headless` в локальном переопределении.

## 2. Meshy (риггинг, анимации, ремеш; тратит API-кредиты)

1. Пользователь берёт ключ на странице API Keys в Meshy Developer Platform.
2. Пользователь сам вводит команду (user-скоуп, работает во всех проектах):

```bat
claude mcp add -s user -e MESHY_API_KEY=msy_ВАШ_КЛЮЧ -t stdio meshy -- cmd /c npx -y @meshy-ai/meshy-mcp-server
```

3. Проверка: `claude mcp get meshy`, затем в сессии вызови `meshy_check_balance`.

## 3. Blender (Blender 5.2, путь в `tools/blender-path.txt`)

1. Если `uv` нет, установи его (с разрешения пользователя) и открой новый терминал:
   `winget install --id=astral-sh.uv -e`
2. Сервер с безопасным режимом и без телеметрии:

```bat
claude mcp add -s user -e BLENDER_MCP_SAFE_MODE=1 -e DISABLE_TELEMETRY=true -t stdio blender -- uvx mcp-for-blender
```

3. Аддон: `uvx mcp-for-blender install-addon`, затем в Blender: Edit → Preferences → Add-ons → включить «Interface: MCP for Blender».
4. В Blender: N в 3D-вьюпорте → вкладка MCP for Blender → Start MCP Server (порт 9876).
5. Проверка: в сессии запроси информацию о сцене. Если аддон не встаёт на Blender 5.2, сообщи версию и текст ошибки.

Перед работой через Blender MCP сохраняй .blend: сервер умеет выполнять Python в Blender.

## 4. Плагины claude.ai

- `code-review`: уже включён.
- `typescript-native-lsp`: включи из карточки в claude.ai или через `/plugin` в Claude Code. Проект на TypeScript 7, плагин использует его нативный LSP.
- Плагин `playwright` из каталога НЕ ставь: тот же сервер уже есть в `.mcp.json`, дубль запутает.

## 5. Не ставить без надобности

Другие Babylon-серверы (`nge`, `nrge`, `flow-graph`, `smart-filters`) добавляй, только когда понадобится конкретный редактор: каждый сервер съедает контекст своими ~25 инструментами.

## 6. Смоук-тест

1. `npm run dev`
2. Через Playwright: открой `http://localhost:5173/`, сделай скриншот, прочитай ошибки консоли. Повтори с `browser_resize` 915×412 (телефон горизонтально).
3. Через `babylon-nme` вызови `list_block_types`.

## 7. Отчёт

| Сервер | Было | Стало | Проверка |
|---|---|---|---|
| playwright | | | скриншот + консоль |
| babylon-nme / npe / gui | | | list_block_types |
| meshy | | | баланс кредитов |
| blender | | | инфо о сцене |
| typescript-native-lsp | | | `/plugin` |
