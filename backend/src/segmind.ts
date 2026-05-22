import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

const API_URL = "https://api.segmind.com/v1/gpt-5.5";

const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "backend", ".env"),
  path.resolve(__dirname, "../../.env"),
];

let API_KEY = process.env.SEGMIND_API_KEY;

for (const candidate of envPaths) {
  if (API_KEY) break;
  if (!fs.existsSync(candidate)) continue;
  const envContent = fs.readFileSync(candidate, "utf-8");
  const match = envContent.match(/^SEGMIND_API_KEY\s*=\s*(.*)$/m);
  if (match) {
    API_KEY = match[1].trim();
  }
}

function getSegmindApiKey(): string {
  if (!API_KEY) {
    throw new Error("SEGMIND_API_KEY is not defined in environment variables or in any .env file");
  }
  return API_KEY;
}

interface AnalyzeImageOptions {
  imageUrl?: string;
  pageUrl?: string;
  imageBase64?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  prompt?: string;
}

interface AnalysisCriterion {
  id: number;
  name: string;
  score: number;
  summary: string;
  recommendation: string;
}

interface AnalysisSection {
  title: string;
  weight: number;
  score: number;
  criteria: AnalysisCriterion[];
  summary: string;
  recommendation: string;
}

interface AiCroSection {
  score: number;
  criteria: AnalysisCriterion[];
}

interface StructuredAnalysis {
  overallScore: number;
  weights: {
    productVisibility: number;
    commercialMessage: number;
    simplicityAndUX: number;
    ctrMarketplace: number;
    trustBrand: number;
  };
  sections: {
    productVisibility: AnalysisSection;
    commercialMessage: AnalysisSection;
    visualOverload: AnalysisSection;
    textQuality: AnalysisSection;
    visualAesthetics: AnalysisSection;
    marketplaceClickability: AnalysisSection;
    trustCredibility: AnalysisSection;
    categoryFit: AnalysisSection;
    informationCompleteness: AnalysisSection;
    brandStyle: AnalysisSection;
  };
  aiCroCriteria: AiCroSection;
  category: string;
  subcategory?: string;
  brand?: string;
  notes?: string;
  version: string;
}

const CATEGORY_HINTS: Record<string, string> = {
  "Общие": "Используй общий подход для оценки карточки товара.",
  "Электроника": "Оцени важность визуального представления товара, акцент на функциональности, чистоте и доверии.",
  "Одежда": "Оцени, насколько хорошо показаны ткань, посадка, стиль и уникальные детали товара.",
  "Красота": "Оцени, насколько изображение выглядит аккуратно, привлекательно и концентрированно на продукте.",
};

function extractJsonObject(text: string): string | null {
  const startIndex = text.indexOf("{");
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (!escape && ch === "\\") {
        escape = true;
      } else if (!escape && ch === '"') {
        inString = false;
      } else {
        escape = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonBody = extractJsonObject(trimmed);
    if (!jsonBody) return value;

    try {
      return JSON.parse(jsonBody);
    } catch {
      return value;
    }
  }
}

function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp|avif|gif|svg)(?:[\?#]|$)/i.test(url);
}

function normalizeResolvedUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function findMetaImageUrl(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function isMarketplaceUrl(url: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?(wildberries\.ru|ozon\.ru)/i.test(url);
}

function isOzonUrl(url: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?ozon\.ru/i.test(url);
}

function isWildberriesUrl(url: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?wildberries\.ru/i.test(url);
}

function parseOzonProductUrl(pageUrl: string): { path: string; id: string } | null {
  try {
    const parsed = new URL(pageUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/g, "");
    const match = normalizedPath.match(/\/product\/(.+)-(\d+)$/) || normalizedPath.match(/\/product\/(\d+)$/);
    if (!match) return null;

    if (match[2]) {
      return {
        path: `/product/${match[1]}-${match[2]}`,
        id: match[2],
      };
    }

    return {
      path: `/product/${match[1]}`,
      id: match[1],
    };
  } catch {
    return null;
  }
}

function buildOzonComposerUrl(pageUrl: string): string | null {
  const parsed = parseOzonProductUrl(pageUrl);
  if (!parsed) return null;
  const encodedUrl = encodeURIComponent(`${parsed.path}/`);
  return `https://www.ozon.ru/api/composer-api.bx/_action/render/?url=${encodedUrl}&page=1&use_default_date=1&lang=ru&locale=ru&pr_state=1&platform=web&product=${parsed.id}`;
}

function findFirstImageUrl(value: unknown): string | null {
  if (typeof value === "string") {
    if (isImageUrl(value)) return value;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstImageUrl(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object" && value !== null) {
    const objectValue = value as Record<string, unknown>;

    if (typeof objectValue.coverImageUrl === "string" && isImageUrl(objectValue.coverImageUrl)) {
      return objectValue.coverImageUrl;
    }

    if (Array.isArray(objectValue.images)) {
      for (const item of objectValue.images) {
        if (typeof item === "object" && item !== null) {
          const src = (item as any).src;
          if (typeof src === "string" && isImageUrl(src)) return src;
        }
        const found = findFirstImageUrl(item);
        if (found) return found;
      }
    }

    for (const key of Object.keys(objectValue)) {
      const found = findFirstImageUrl(objectValue[key]);
      if (found) return found;
    }
  }

  return null;
}

async function resolveOzonImageUrl(pageUrl: string): Promise<string | null> {
  const parsed = parseOzonProductUrl(pageUrl);
  if (!parsed) return null;

  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://www.ozon.ru/",
    },
    validateStatus: null,
  }));

  await client.get(pageUrl);
  const composerUrl = buildOzonComposerUrl(pageUrl);
  if (!composerUrl) return null;

  const response = await client.get(composerUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: pageUrl,
    },
  });

  if (response.status !== 200 || !response.data) {
    return null;
  }

  const imageUrl = findFirstImageUrl(response.data);
  return imageUrl ? normalizeResolvedUrl(imageUrl, pageUrl) : null;
}

function parseWildberriesProductId(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl);
    const match = parsed.pathname.match(/\/catalog\/(\d+)(?:\/|$)|\/product\/(\d+)(?:\/|$)|\/goods\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return match[1] || match[2] || match[3] || null;
  } catch {
    return null;
  }
}

function resolveWildberriesImageUrl(pageUrl: string): string | null {
  const productId = parseWildberriesProductId(pageUrl);
  if (!productId) return null;
  return `https://images.wbstatic.net/c516x688/new/${productId}-1.jpg`;
}

function isAntiBotResponse(html: string, status: number): boolean {
  if (status === 403 || status === 498) return true;
  const lowercase = html.toLowerCase();
  return lowercase.includes("antibot") || lowercase.includes("почти готово") || lowercase.includes("challenge page");
}

async function resolveImageUrlFromPage(pageUrl: string): Promise<string | null> {
  const response = await axios.get(pageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    validateStatus: null,
  });

  const html = String(response.data);
  const imageUrl = findMetaImageUrl(html);

  if (imageUrl && !isAntiBotResponse(html, response.status)) {
    return normalizeResolvedUrl(imageUrl, pageUrl);
  }

  if (isOzonUrl(pageUrl)) {
    const ozonImageUrl = await resolveOzonImageUrl(pageUrl);
    if (ozonImageUrl) return ozonImageUrl;
  }

  if (isWildberriesUrl(pageUrl)) {
    const wbImageUrl = resolveWildberriesImageUrl(pageUrl);
    if (wbImageUrl) return wbImageUrl;
  }

  return imageUrl ? normalizeResolvedUrl(imageUrl, pageUrl) : null;
}

function buildPrompt(category: string | undefined, subcategory?: string, brand?: string): string {
  const categoryName = category || "Общие";
  const hint = CATEGORY_HINTS[categoryName] ?? CATEGORY_HINTS["Общие"];
  const targetCategory = subcategory ? `Узкая категория: ${subcategory}.` : "";
  const targetBrand = brand ? `Бренд: ${brand}.` : "";

  return `Проанализируй изображение карточки товара по категории: ${categoryName}.
${hint}
${targetCategory}
${targetBrand}

Верни ТОЛЬКО корректный JSON-объект, без markdown, без комментариев, без дополнительных слов.

Структура ответа должна быть точно такой:
{
  "overallScore": число,
  "weights": {
    "productVisibility": 25,
    "commercialMessage": 25,
    "simplicityAndUX": 20,
    "ctrMarketplace": 20,
    "trustBrand": 10
  },
  "sections": {
    "productVisibility": { "title": "PRODUCT VISIBILITY", "weight": 25, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "commercialMessage": { "title": "COMMERCIAL MESSAGE", "weight": 25, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "visualOverload": { "title": "VISUAL OVERLOAD / SIMPLICITY", "weight": 20, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "textQuality": { "title": "TEXT QUALITY ON IMAGE", "weight": 20, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "visualAesthetics": { "title": "VISUAL AESTHETICS", "weight": 20, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "marketplaceClickability": { "title": "MARKETPLACE CLICKABILITY", "weight": 20, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "trustCredibility": { "title": "TRUST / CREDIBILITY", "weight": 10, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "categoryFit": { "title": "CATEGORY FIT", "weight": 10, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "informationCompleteness": { "title": "INFORMATION COMPLETENESS", "weight": 10, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] },
    "brandStyle": { "title": "BRAND / STYLE", "weight": 10, "score": число, "summary": строка, "recommendation": строка, "criteria": [ ... ] }
  },
  "aiCroCriteria": { "score": число, "criteria": [ ... ] },
  "category": "${categoryName}",
  "subcategory": "${subcategory ?? ""}",
  "brand": "${brand ?? ""}",
  "notes": "",
  "version": "1.0"
}

Каждое поле criteria должно иметь формат:
{
  "id": число,
  "name": строка,
  "score": число (1-10),
  "summary": строка,
  "recommendation": строка
}

Каждый раздел должен также содержать итоговые поля:
{
  "summary": строка,
  "recommendation": строка
}

Для раздела PRODUCT VISIBILITY оцени пункт:
1. Хорошо ли виден продукт (занимает ли достаточно площади, не слишком ли мелкий)
2. Читаемость формы товара (понятен ли силуэт, нет ли слияния с фоном)
3. Видимость ключевых деталей (кнопки, экран, фактура ткани, фурнитура, разъёмы)
4. Продукт не перекрыт графикой (текст/бейджи/стрелки не закрывают товар)
5. Правильный ракурс товара (показан ли лучший angle для понимания)

Для раздела COMMERCIAL MESSAGE оцени:
6. Видны УТП
7. УТП считываются быстро (за 1-2 секунды понятно ли)
8. УТП действительно важные (не "100% quality", а buying trigger)
9. Есть ли differentiator (понятно ли, почему выбрать этот товар)
10. Коммерческая сила оффера (фото продаёт или просто показывает)

Для раздела VISUAL OVERLOAD / SIMPLICITY оцени:
11. Не перегружено ли минорными визуальными элементами
12. Иерархия внимания (куда падает взгляд первым: товар, текст, мусор)
13. Количество competing elements (слишком много competing объектов?)
14. Визуальный шум (паттерны, лишние иконки, рамки, плашки)

Для раздела TEXT QUALITY ON IMAGE оцени:
15. Читаемость текста (размер, contrast, font)
16. Объём текста адекватен (не простыня)
17. Приоритетность текста (главный message выделен)
18. Language clarity (нет сложных формулировок, жаргона, мусора)

Для раздела VISUAL AESTHETICS оцени:
19. Общая визуальная аккуратность (clean/premium/cheap)
20. Композиция (баланс, spacing, alignment)
21. Цветовой баланс (не кислотно, contrast хороший)
22. Качество изображения (sharpness, compression, blur)
23. Профессиональность дизайна (выглядит как бренд или как колхозный маркетплейс креатив)

Для раздела MARKETPLACE CLICKABILITY оцени:
24. CTR potential (хочется ли кликнуть)
25. Выделяемость среди конкурентов (заметно ли фото)
26. Thumbnail readability (на маленьком размере всё понятно)
27. Shelf impact (в сетке из 20 товаров карточка выделяется)

Для раздела TRUST / CREDIBILITY оцени:
28. Вызывает ли доверие (не выглядит scam-like)
29. Не выглядит слишком рекламно (много SALE!!! WOW!!!)
30. Не вызывает когнитивного сомнение (нет ощущения, что-то мутное)

Для раздела CATEGORY FIT оцени:
31. Соответствие категории
32. Соответствие buyer expectations (то, что ищет пользователь, видно сразу)
33. Отображён ли category buying trigger (для одежды: посадка, фактура; для смартфонов: камера, батарея; для косметики: эффект, texture)

Для раздела INFORMATION COMPLETENESS оцени:
34. Достаточно ли фото объясняет товар (можно понять, что покупаешь)
35. Есть ли missing key information
36. Есть ли ambiguity (не надо ли догадываться)

Для раздела BRAND / STYLE оцени:
37. Brand visibility (если бренд нужен, бренд читается)
38. Brand consistency (соответствует ли бренд-стилю)
39. Premiumness perception (насколько дорого выглядит)

Для AI-SPECIFIC CRO CRITERIA оцени:
40. Attention focus score (насколько фокус внимания сконцентрирован на нужном)
41. Cognitive load score (сколько мозг тратит на decoding)
42. Message extraction speed (за сколько секунд понял смысл)
43. Purchase trigger strength (фото вызывает желание купить)
44. Confusion risk (может ли человек неправильно понять товар)
45. Discount dependency (карточка продаёт сама или только скидкой)

Выведи итоговую оценку overallScore в формате числа от 1 до 10, рассчитанную как взвешенное среднее разделов по веса.
`;
}

function buildImageContent(imageUrl?: string, imageBase64?: string) {
  if (imageUrl) {
    return {
      type: "image_url",
      image_url: { url: imageUrl },
    };
  }

  if (!imageBase64) {
    throw new Error("No image data provided");
  }

  const imageData = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  return {
    type: "image_url",
    image_url: { url: imageData },
  };
}

function normalizeAssistantContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (typeof block === "object" && block !== null) {
          const text = (block as any).text;
          if (typeof text === "string") return text;
        }
        return JSON.stringify(block);
      })
      .join("\n");
  }

  return JSON.stringify(content, null, 2);
}

export async function analyzeImage(options: AnalyzeImageOptions) {
  const prompt = options.prompt ?? buildPrompt(options.category, options.subcategory, options.brand);

  let imageUrl = options.imageUrl;
  if (!imageUrl && options.pageUrl) {
    imageUrl = options.pageUrl;
  }

  let resolvedImageUrl: string | undefined;
  if (imageUrl && !isImageUrl(imageUrl)) {
    const resolved = await resolveImageUrlFromPage(imageUrl);
    if (!resolved) {
      throw new Error(`Не удалось извлечь главное изображение с карточки товара: ${imageUrl}`);
    }
    imageUrl = resolved;
    resolvedImageUrl = resolved;
  }

  const imageContent = buildImageContent(imageUrl, options.imageBase64);

  const data = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          imageContent,
        ],
      },
    ],
  };

  try {
    const response = await axios.post(API_URL, data, {
      headers: {
        "x-api-key": getSegmindApiKey(),
        "Content-Type": "application/json",
      },
    });

    const assistantContent = response.data.choices?.[0]?.message?.content;
    const parsedAssistant = parseJsonString(assistantContent);

    return {
      raw: response.data,
      assistant: parsedAssistant ?? normalizeAssistantContent(assistantContent),
      assistantRaw: normalizeAssistantContent(assistantContent),
      resolvedImageUrl,
    };
  } catch (error: unknown) {
    const err = error as any;
    const status = err.response?.status;
    const details = err.response?.data;

    if (status === 406) {
      const categoryName = options.category ?? "Общие";
      const subcategoryValue = options.subcategory ?? "";
      const brandValue = options.brand ?? "";

      return {
        raw: details,
        assistant: {
          overallScore: 5,
          weights: {
            productVisibility: 25,
            commercialMessage: 25,
            simplicityAndUX: 20,
            ctrMarketplace: 20,
            trustBrand: 10,
          },
          sections: {
            productVisibility: {
              title: "PRODUCT VISIBILITY",
              weight: 25,
              score: 6,
              summary: "Продукт видно неплохо, но можно усилить фокус и убрать лишнюю графику.",
              recommendation: "Сделайте товар более крупным и добавьте контраст между ним и фоном.",
              criteria: [
                {
                  id: 1,
                  name: "Хорошо ли видно продукт",
                  score: 6,
                  summary: "Продукт виден, но можно увеличить площадь и контраст.",
                  recommendation: "Сделайте товар крупнее и уменьшите фоновые элементы.",
                },
                {
                  id: 2,
                  name: "Читаемость формы товара",
                  score: 6,
                  summary: "Силуэт понятен, но часть товара слегка сливается с фоном.",
                  recommendation: "Добавьте лёгкую отделку или контрастный фон за товаром.",
                },
                {
                  id: 3,
                  name: "Видимость ключевых деталей",
                  score: 5,
                  summary: "Некоторые детали потеряны из-за освещения и композиции.",
                  recommendation: "Сфокусируйтесь на ключевых деталях, таких как кнопки или фурнитура.",
                },
                {
                  id: 4,
                  name: "Продукт не перекрыт графикой",
                  score: 7,
                  summary: "Текст не сильно закрывает товар, но стоит убрать лишние элементы.",
                  recommendation: "Передвиньте бейджи и текст в свободные зоны изображения.",
                },
                {
                  id: 5,
                  name: "Правильный ракурс товара",
                  score: 6,
                  summary: "Ракурс понятный, но не самый продающий.",
                  recommendation: "Выберите более выразительный угол, который показывает форму товара.",
                },
              ],
            },
            commercialMessage: {
              title: "COMMERCIAL MESSAGE",
              weight: 25,
              score: 5,
              summary: "Коммерческое сообщение присутствует, но пока не полностью понятно и не продаёт достаточно сильно.",
              recommendation: "Сделайте УТП более явными, понятными и выгодными для пользователя.",
              criteria: [
                {
                  id: 6,
                  name: "Видны УТП",
                  score: 5,
                  summary: "УТП присутствуют, но неочевидны.",
                  recommendation: "Добавьте ясные ключевые преимущества рядом с товаром.",
                },
                {
                  id: 7,
                  name: "УТП считываются быстро",
                  score: 5,
                  summary: "Сообщение читается не сразу.",
                  recommendation: "Сократите текст и используйте простой язык.",
                },
                {
                  id: 8,
                  name: "УТП действительно важные",
                  score: 5,
                  summary: "Текущие УТП выглядят общими и не триггерят.",
                  recommendation: "Сфокусируйтесь на реальной выгоде покупателя.",
                },
                {
                  id: 9,
                  name: "Есть ли differentiator",
                  score: 4,
                  summary: "Неясно, почему выбрать именно этот товар.",
                  recommendation: "Укажите уникальное отличие, которое конкуренты не предлагают.",
                },
                {
                  id: 10,
                  name: "Коммерческая сила оффера",
                  score: 5,
                  summary: "Фото больше информирует, чем продаёт.",
                  recommendation: "Добавьте эмоциональный триггер или benefit.",
                },
              ],
            },
            visualOverload: {
              title: "VISUAL OVERLOAD / SIMPLICITY",
              weight: 20,
              score: 5,
              summary: "Изображение выглядит немного перегруженным визуальными элементами.",
              recommendation: "Упростите композицию и оставьте больше пространства вокруг товара.",
              criteria: [
                {
                  id: 11,
                  name: "Не перегружено ли минорными визуальными элементами",
                  score: 5,
                  summary: "Есть лишние детали, которые отвлекают от товара.",
                  recommendation: "Уберите мелкие значки и второстепенные графические элементы.",
                },
                {
                  id: 12,
                  name: "Иерархия внимания",
                  score: 5,
                  summary: "Взгляд распределяется между товаром и текстом.",
                  recommendation: "Сделайте товар главным визуальным фокусом.",
                },
                {
                  id: 13,
                  name: "Количество competing elements",
                  score: 5,
                  summary: "Слишком много конкурирующих объектов.",
                  recommendation: "Сократите количество второстепенных элементов.",
                },
                {
                  id: 14,
                  name: "Визуальный шум",
                  score: 5,
                  summary: "Фон и графика создают поверхностный шум.",
                  recommendation: "Упростите фон и уберите лишние иконки.",
                },
              ],
            },
            textQuality: {
              title: "TEXT QUALITY ON IMAGE",
              weight: 20,
              score: 5,
              summary: "Текст на изображении читается, но нуждается в более чёткой иерархии.",
              recommendation: "Снизьте объём текста и выделите главное сообщение.",
              criteria: [
                {
                  id: 15,
                  name: "Читаемость текста",
                  score: 5,
                  summary: "Текст читаем, но контраст мог бы быть лучше.",
                  recommendation: "Увеличьте размер текста и контраст с фоном.",
                },
                {
                  id: 16,
                  name: "Объём текста адекватен",
                  score: 5,
                  summary: "Текст не слишком длинный, но все ещё кажется плотным.",
                  recommendation: "Сократите фразы до самого важного.",
                },
                {
                  id: 17,
                  name: "Приоритетность текста",
                  score: 5,
                  summary: "Главное сообщение не выделено явно.",
                  recommendation: "Сделайте ключевой заголовок более заметным.",
                },
                {
                  id: 18,
                  name: "Language clarity",
                  score: 6,
                  summary: "Формулировки понятны, но можно убрать жаргон.",
                  recommendation: "Используйте простой и короткий язык.",
                },
              ],
            },
            visualAesthetics: {
              title: "VISUAL AESTHETICS",
              weight: 20,
              score: 6,
              summary: "Визуально картинка аккуратная, но ещё не выглядит достаточно премиально.",
              recommendation: "Сделайте оформление более чистым и профессиональным.",
              criteria: [
                {
                  id: 19,
                  name: "Общая визуальная аккуратность",
                  score: 6,
                  summary: "Изображение выглядит прилично, но не premium.",
                  recommendation: "Сделайте дизайн более чистым и аккуратным.",
                },
                {
                  id: 20,
                  name: "Композиция",
                  score: 6,
                  summary: "Композиция сбалансирована, но можно улучшить spacing.",
                  recommendation: "Увеличьте пространство вокруг товара.",
                },
                {
                  id: 21,
                  name: "Цветовой баланс",
                  score: 6,
                  summary: "Цвета достаточно гармоничны.",
                  recommendation: "Проверьте контраст и избегайте кислотных оттенков.",
                },
                {
                  id: 22,
                  name: "Качество изображения",
                  score: 6,
                  summary: "Изображение выглядит резким, но есть небольшие артефакты.",
                  recommendation: "Убедитесь, что нет размытия и сжатие не ухудшает детали.",
                },
                {
                  id: 23,
                  name: "Профессиональность дизайна",
                  score: 6,
                  summary: "Выглядит аккуратно, но не сильно профессионально.",
                  recommendation: "Сделайте оформление более брендированным.",
                },
              ],
            },
            marketplaceClickability: {
              title: "MARKETPLACE CLICKABILITY",
              weight: 20,
              score: 6,
              summary: "Карточка в целом кликабельная, но пока не достаточно выражена среди конкурентов.",
              recommendation: "Усилите визуальную выделяемость и лаконично донесите причину клика.",
              criteria: [
                {
                  id: 24,
                  name: "CTR potential",
                  score: 6,
                  summary: "Фото привлекает внимание, но не сильно.",
                  recommendation: "Усилите продающий элемент или эмоцию.",
                },
                {
                  id: 25,
                  name: "Выделяемость среди конкурентов",
                  score: 6,
                  summary: "Карточка заметна, но ещё не выделяется ярко.",
                  recommendation: "Добавьте уникальный визуальный акцент.",
                },
                {
                  id: 26,
                  name: "Thumbnail readability",
                  score: 5,
                  summary: "На маленьком размере детали теряются.",
                  recommendation: "Упростите композицию и уменьшите текст.",
                },
                {
                  id: 27,
                  name: "Shelf impact",
                  score: 6,
                  summary: "Карточка слабовато выделяется в сетке.",
                  recommendation: "Сделайте товар более ярким и центрированным.",
                },
              ],
            },
            trustCredibility: {
              title: "TRUST / CREDIBILITY",
              weight: 10,
              score: 6,
              summary: "Карточка вызывает доверие, но местами выглядит немного рекламно.",
              recommendation: "Сделайте дизайн менее агрессивным и больше ориентируйтесь на качество товара.",
              criteria: [
                {
                  id: 28,
                  name: "Вызывает ли доверие",
                  score: 6,
                  summary: "В целом вызывает доверие, но можно улучшить стабильность дизайна.",
                  recommendation: "Уберите слишком яркие рекламные детали.",
                },
                {
                  id: 29,
                  name: "Не выглядит слишком рекламно",
                  score: 6,
                  summary: "Есть признаки рекламы, но не слишком агрессивно.",
                  recommendation: "Снизьте количество восклицательных знаков и SALE.",
                },
                {
                  id: 30,
                  name: "Не вызывает когнитивного сомнения",
                  score: 6,
                  summary: "Нет сильного ощущения, что-то мутное.",
                  recommendation: "Сделайте сообщение ещё яснее и проще.",
                },
              ],
            },
            categoryFit: {
              title: "CATEGORY FIT",
              weight: 10,
              score: 6,
              summary: "Соответствие категории есть, но можно лучше показать ключевые ожидания покупателей.",
              recommendation: "Сфокусируйтесь на одном или двух buying trigger’ах для текущей категории.",
              criteria: [
                {
                  id: 31,
                  name: "Соответствие категории",
                  score: 6,
                  summary: "Общее соответствие категории есть.",
                  recommendation: "Уточните визуальные признаки для выбранной категории.",
                },
                {
                  id: 32,
                  name: "Соответствие buyer expectations",
                  score: 6,
                  summary: "Покупатель может понять основные характеристики.",
                  recommendation: "Добавьте больше специфики, чтобы соответствовать ожиданиям.",
                },
                {
                  id: 33,
                  name: "Отображён ли category buying trigger",
                  score: 6,
                  summary: "Некоторые характерные триггеры видны, но не все.",
                  recommendation: "Чётче покажите то, что важно для категории.",
                },
              ],
            },
            informationCompleteness: {
              title: "INFORMATION COMPLETENESS",
              weight: 10,
              score: 6,
              criteria: [
                {
                  id: 34,
                  name: "Достаточно ли фото объясняет товар",
                  score: 6,
                  summary: "Фото объясняет товар, но детали можно уточнить.",
                  recommendation: "Добавьте визуальные сигналы, поясняющие товар.",
                },
                {
                  id: 35,
                  name: "Есть ли missing key information",
                  score: 6,
                  summary: "Некоторая ключевая информация отсутствует.",
                  recommendation: "Укажите характеристики, важные для покупки.",
                },
                {
                  id: 36,
                  name: "Есть ли ambiguity",
                  score: 6,
                  summary: "Не требуется догадываться, но ясность могла бы быть лучше.",
                  recommendation: "Устраните любые двойственные элементы или сообщения.",
                },
              ],
            },
            brandStyle: {
              title: "BRAND / STYLE",
              weight: 10,
              score: 6,
              criteria: [
                {
                  id: 37,
                  name: "Brand visibility",
                  score: 6,
                  summary: "Бренд видно слабо, если он есть.",
                  recommendation: "Чётче обозначьте бренд, если он важен.",
                },
                {
                  id: 38,
                  name: "Brand consistency",
                  score: 6,
                  summary: "Стилистика должна лучше соответствовать бренду.",
                  recommendation: "Сделайте цветовую и типографскую согласованность.",
                },
                {
                  id: 39,
                  name: "Premiumness perception",
                  score: 6,
                  summary: "Выглядит неплохо, но не премиально.",
                  recommendation: "Добавьте дорогие визуальные элементы и чистоту дизайна.",
                },
              ],
            },
          },
          aiCroCriteria: {
            score: 6,
            criteria: [
              {
                id: 40,
                name: "Attention focus score",
                score: 6,
                summary: "Фокус внимания в основном на товаре.",
                recommendation: "Сделайте товар ещё более центральным.",
              },
              {
                id: 41,
                name: "Cognitive load score",
                score: 6,
                summary: "Нагрузка умеренная.",
                recommendation: "Снизьте количество элементов для упрощения восприятия.",
              },
              {
                id: 42,
                name: "Message extraction speed",
                score: 6,
                summary: "Смысл считывается за несколько секунд.",
                recommendation: "Упростите текст и структуру, чтобы ускорить понимание.",
              },
              {
                id: 43,
                name: "Purchase trigger strength",
                score: 6,
                summary: "Есть потенциал для покупки.",
                recommendation: "Добавьте более явный стимул к действию.",
              },
              {
                id: 44,
                name: "Confusion risk",
                score: 5,
                summary: "Некоторая неоднозначность остаётся.",
                recommendation: "Сделайте структуру и текст яснее.",
              },
              {
                id: 45,
                name: "Discount dependency",
                score: 6,
                summary: "Карточка продаёт скорее за счёт товара, чем скидки.",
                recommendation: "Подчеркните качество товара, не только цену.",
              },
            ],
          },
          category: categoryName,
          subcategory: subcategoryValue,
          brand: brandValue,
          notes: "DEMO-режим. Для реального анализа нужен рабочий кредитный ключ.",
          version: "1.0",
        },
        demo: true,
      };
    }

    throw err;
  }
}
