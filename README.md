# Card Rating 2

Проект: анализ контента карточек товара для маркетплейсов.

## Что здесь

- `backend` — Node.js + Express API для вызова Segmind GPT-5.5
- `frontend` — React + Vite веб-интерфейс для загрузки фото и URL

## Старт

1. Скопируйте `.env.example` в `.env`
2. Установите ключ:

```env
SEGMIND_API_KEY=SG_f3d91c3f7237aefd
BACKEND_PORT=4000
VITE_API_BASE_URL=http://localhost:4000
```

3. Установите зависимости:

```bash
npm run install:all
```

4. Запустите в режиме разработки:

```bash
npm run dev
```

5. Откройте фронтенд в браузере:

`http://localhost:5173`

## Архитектура

- Фронтенд принимает файл или URL изображения
- Выбирается категория товара
- Отправляет данные на сервер
- Сервер формирует запрос к Segmind GPT-5.5 с учётом категории, узкой категории и бренда
- Возвращает структурированный JSON с оценками по разделам, пунктам и рекомендациями

Если API возвращает `406`, это обычно означает, что на вашем ключе Segmind недостаточно кредитов.

## API

`POST /api/analyze`

Тело запроса:

```json
{
  "imageUrl": "https://example.com/image.jpg",
  "category": "Общие",
  "subcategory": "смартфоны",
  "brand": "Apple"
}
```

или

```json
{
  "imageBase64": "data:image/jpeg;base64,...",
  "category": "Общие",
  "subcategory": "кроссовки",
  "brand": "Nike"
}
```

---

## Развёртывание

### 1. Подготовьте GitHub

Если у вас уже есть репозиторий для предыдущей версии, можно использовать его заново:

- добавьте `origin` с URL существующего репозитория
- отправьте ветку `main`

```bash
git remote add origin <GITHUB_REPO_URL>
git branch -M main
git push -u origin main
```

Если репозитория ещё нет, создайте новый на GitHub и затем выполните те же команды.

### 2. Настройте Render

В Render можно подключить GitHub-репозиторий и использовать `render.yaml` для определения сервисов.

- `card-rating2-backend` — `web_service`, `Node`, `buildCommand: npm install && npm --workspace backend run build`, `startCommand: npm --workspace backend run start`
- `card-rating2-frontend` — `static_site`, `Static`, `buildCommand: npm install && npm --workspace frontend run build`, `publishPath: frontend/dist`

Для backend нужно добавить переменную окружения `SEGMIND_API_KEY` в настройках сервиса.

### 3. Настройте Cloudflare

Если хотите показывать результат по собственному домену:

- добавьте CNAME-запись, указывающую на адрес статического сайта Render (`<project>.onrender.com`)
- если домен на уровне `@`, используйте ALIAS/ANAME или перенаправление Cloudflare на Render

### 4. Проверка

После деплоя:

- откройте URL фронтенд-сайта
- проверьте, что изображение загружается
- проверьте, что backend отвечает на `POST /api/analyze`

---

Если нужно, могу прямо сейчас:

- добавить удалённый GitHub-репозиторий, если вы дадите URL
- подготовить Render сервисы с помощью `render.yaml`
- дать точные записи Cloudflare для текущего домена
