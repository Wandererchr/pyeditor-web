# PyEditor Web

Адаптивна веб-версія PyEditor: редактор Python, що працює прямо в браузері на iPhone, iPad, Android і десктопі.

Стек: CodeMirror 6 (редактор) + Pyodide (CPython, скомпільований у WebAssembly) у Web Worker.

## Можливості

- Підсвічування Python, нумерація рядків, автодужки, undo/redo, пошук
- **Запустити / Стоп**: Python працює в окремому воркері; Стоп — `worker.terminate()` (аналог `killProcess()` в Android-версії), зупиняє навіть `while True`
- `input()`: інтерактивний у браузерах з JSPI (Chrome, Edge); у Safari — прозорий перезапуск із уже введеними значеннями (random фіксується)
- Банер помилки з переходом до рядка, жива перевірка синтаксису (0,6 с)
- Файли й теки (`уроки/цикли.py`) у localStorage, імпорт `.py`, копіювання коду
- 8 прикладів, панель символів з ⇥, розмір шрифту, автозбереження чернетки
- Інтерфейс UK/EN (за мовою браузера), світла/темна тема
- PWA: на GitHub Pages працює офлайн і ставиться на головний екран iPhone (Safari → Поділитися → «На початковий екран»)
- Пакети з дистрибутиву Pyodide (numpy тощо) підвантажуються автоматично за `import`

## Структура

| Файл | Що робить |
| --- | --- |
| `index.html` | Інтерфейс, файли, консоль, логіка запуску |
| `worker.js` | Pyodide + Python-раннер (stdout/stderr, input, трасування) |
| `editor.js` | Зібраний бандл CodeMirror (з `src/editor-src.js`) |
| `sw.js`, `manifest.webmanifest`, іконки | PWA та офлайн-кеш |

## Запуск локально

Потрібен будь-який статичний сервер (Web Worker не працює з `file://`):

```bash
python3 -m http.server 8000
# відкрити http://localhost:8000
```

На `localhost` сторінка шукає Pyodide в `./pyodide/` (можна зробити симлінк на `node_modules/pyodide`), а `#replay` в адресі примусово вмикає режим вводу як у Safari.

## Перезбірка редактора

```bash
npm install
npm run build   # src/editor-src.js -> editor.js
```

## GitHub Pages

Settings → Pages → Source: `Deploy from a branch`, гілка `main`, тека `/ (root)`.
Після зміни файлів збільш `V` у `sw.js`, щоб клієнти отримали нову версію кешу.
