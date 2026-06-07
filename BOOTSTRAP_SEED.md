# Local bootstrap seed (вариант B)

Идея: на первом запуске лаунчер не качает Forge/OptiFine/библиотеки из сети, а распаковывает локальный `bootstrap-seed.zip` в `.meloncher/`.

## Что должно быть в seed

Внутри архива должна лежать структура будущей `.meloncher/`:

- `versions/`
- `libraries/`
- `runtime/` — желательно, чтобы не зависеть от Java у пользователя
- `assets/` — желательно для самого быстрого первого запуска
- `resourcepacks/`, `options.txt` — по необходимости

Не клади туда:

- `logs/`
- `crash-reports/`
- временные файлы
- пользовательские токены / профили входа

## FPS-дефолты, которые автоматически вшиваются в seed

Скрипт сборки автоматически подмешивает шаблоны:

- `assets/default-options.txt` → `options.txt`
- `assets/default-optionsof.txt` → `optionsof.txt`

То есть даже если в исходной `.meloncher` были другие настройки, в готовый `bootstrap-seed.zip` попадут именно эти дефолты.

## Где должен лежать seed

Лаунчер ищет один из вариантов:

- `assets/bootstrap-seed.zip`
- `assets/bootstrap-seed/` (распакованная папка)
- рядом с ресурсами packaged-app в `resources/assets/` или `resources/bootstrap/`

Manifest опционален, но желателен:

- `assets/bootstrap-seed.manifest.json`

Пример:

```json
{
  "version": "1.0.0",
  "builtAt": "2026-06-07T12:00:00.000Z",
  "fileCount": 1234,
  "uncompressedSize": 987654321
}
```

## Как собрать seed

1. Подготовь эталонную папку `.meloncher` на своей машине.
2. Проверь, что версия запускается без ошибок.
3. Выполни:

```bash
npm run build-seed -- "C:\\path\\to\\.meloncher"
```

Или укажи вручную output dir и версию:

```bash
node scripts/build-bootstrap-seed.js "C:\\path\\to\\.meloncher" "./assets" "1.21.4-forge-optifine-v1"
```

Текущие FPS-дефолты лежат в:

- `assets/default-options.txt`
- `assets/default-optionsof.txt`

Если хочешь поменять render distance / simulation distance / OptiFine performance flags для всех пользователей по умолчанию — редактируй именно эти два файла перед сборкой seed.

Скрипт создаст:

- `assets/bootstrap-seed.zip`
- `assets/bootstrap-seed.manifest.json`

## Как это работает в лаунчере

На старте лаунчер:

1. создаёт `.meloncher/`
2. проверяет, пустая ли она
3. если пустая и найден локальный seed — распаковывает его
4. дальше работает уже с готовыми `versions/libraries/runtime`

## Важно

- Seed применяется только когда `.meloncher/` ещё пустая.
- Если пользователь уже что-то скачал, seed повторно не накатывается.
- Для максимально быстрого первого запуска включай в seed и `runtime`, и нужные `assets`.
