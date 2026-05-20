import axios from "axios";
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

if (!API_KEY) {
  throw new Error("SEGMIND_API_KEY is not defined in environment variables or in any .env file");
}

interface AnalyzeImageOptions {
  imageUrl?: string;
  imageBase64?: string;
  category?: string;
  prompt?: string;
}

const CRITERIA = [
  "Хорошо ли видно продукт",
  "Отображены ли основные уникальные торговые предложения",
  "Не перегружено ли изображение дополнительными, минорными элементами",
];

const CATEGORY_HINTS: Record<string, string> = {
  "Общие": "Используй общий подход для оценки карточки товара.",
  "Электроника": "Оцени важность визуального представления товара, акцент на функциональности, чистоте и доверии.",
  "Одежда": "Оцени, насколько хорошо показаны ткань, посадка, стиль и уникальные детали товара.",
  "Красота": "Оцени, насколько изображение выглядит аккуратно, привлекательно и концентрированно на продукте.",
};

function buildPrompt(category: string | undefined): string {
  const categoryName = category || "Общие";
  const hint = CATEGORY_HINTS[categoryName] ?? CATEGORY_HINTS["Общие"];

  return `Проанализируй изображение карточки товара по категории: ${categoryName}.
${hint}

Оцени изображение по следующим критериям:
${CRITERIA.map((item, index) => `${index + 1}. ${item}`).join("\n")}

Для каждого критерия напиши:
- краткий вывод
- что хорошо
- что стоит улучшить

Дай рекомендации в формате простого текста, разделённого по критериям.`;
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
  const prompt = options.prompt ?? buildPrompt(options.category);
  const imageContent = buildImageContent(options.imageUrl, options.imageBase64);

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

  const response = await axios.post(API_URL, data, {
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
  });

  const assistantContent = response.data.choices?.[0]?.message?.content;

  return {
    raw: response.data,
    assistant: normalizeAssistantContent(assistantContent),
  };
}
