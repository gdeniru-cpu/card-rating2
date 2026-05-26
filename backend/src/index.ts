import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import { analyzeImage, resolveImageSource } from "./segmind";

const app = express();
const port = Number(process.env.BACKEND_PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/analyze", async (req, res) => {
  const { imageUrl, imageBase64, pageUrl, prompt, category, subcategory, brand } = req.body;

  if (!imageUrl && !imageBase64 && !pageUrl) {
    return res.status(400).json({ error: "imageUrl, pageUrl or imageBase64 is required" });
  }

  try {
    const result = await analyzeImage({ imageUrl, imageBase64, pageUrl, prompt, category, subcategory, brand });
    return res.json(result);
  } catch (error: unknown) {
    console.error("analyze error", error);
    const err = error as any;
    return res.status(err.response?.status ?? 500).json({
      error: err.message ?? "Unexpected error",
      details: err.response?.data ?? null,
    });
  }
});

app.post("/api/resolve-image", async (req, res) => {
  const { imageUrl, pageUrl } = req.body;
  const sourceUrl = imageUrl || pageUrl;

  if (!sourceUrl) {
    return res.status(400).json({ error: "imageUrl or pageUrl is required" });
  }

  try {
    const resolvedImageUrl = await resolveImageSource(sourceUrl);
    return res.json({ resolvedImageUrl });
  } catch (error: unknown) {
    console.error("resolve image error", error);
    const err = error as any;
    return res.status(err.response?.status ?? 500).json({
      error: err.message ?? "Unexpected error",
      details: err.response?.data ?? null,
    });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
