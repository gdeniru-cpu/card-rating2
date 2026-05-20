import { useMemo, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const categories = ["Общие", "Электроника", "Одежда", "Красота"];
const criteria = [
  "Хорошо ли видно продукт",
  "Отображены ли основные уникальные торговые предложения",
  "Не перегружено ли изображение дополнительными, минорными элементами",
];

function App() {
  const [imageUrl, setImageUrl] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [useUrl, setUseUrl] = useState(true);
  const [category, setCategory] = useState(categories[0]);
  const [analysis, setAnalysis] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const previewSource = useMemo(() => {
    if (useUrl) {
      return imageUrl || null;
    }
    return imageData;
  }, [useUrl, imageUrl, imageData]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImageData(result);
      setUseUrl(false);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    setError("");
    setAnalysis("");

    const useImageUrl = useUrl && imageUrl.trim().length > 0;
    const useImageData = !useUrl && imageData;

    if (!useImageUrl && !useImageData) {
      setError("Выберите файл или вставьте URL изображения.");
      return;
    }

    const payload: Record<string, unknown> = {
      category,
    };

    if (useImageUrl) {
      payload.imageUrl = imageUrl.trim();
    } else if (imageData) {
      payload.imageBase64 = imageData;
    }

    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json();
        const details = body.details ? `\n${JSON.stringify(body.details, null, 2)}` : "";
        throw new Error(`${body.error ?? "Ошибка запроса"}${details}`);
      }

      const data = await response.json();
      setAnalysis(data.assistant ?? JSON.stringify(data.raw, null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header>
        <h1>Card Rating 2</h1>
        <p>Загрузите фото карточки товара или передайте URL, чтобы получить рекомендации по улучшению.</p>
      </header>

      <main>
        <section className="controls">
          <div className="switch-row">
            <button className={useUrl ? "active" : ""} onClick={() => setUseUrl(true)}>
              Использовать URL
            </button>
            <button className={!useUrl ? "active" : ""} onClick={() => setUseUrl(false)}>
              Загрузить файл
            </button>
          </div>

          <label>
            Категория товара
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          {useUrl ? (
            <label>
              Ссылка на изображение
              <input
                type="url"
                placeholder="https://example.com/image.jpg"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </label>
          ) : (
            <label>
              Файл изображения
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </label>
          )}

          <div className="criteria">
            <div className="criteria-title">Критерии оценки</div>
            <ul>
              {criteria.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <button className="analyze-button" onClick={handleAnalyze} disabled={loading}>
            {loading ? "Анализируется..." : "Получить рекомендации"}
          </button>

          {error && <div className="alert error">{error}</div>}
        </section>

        <section className="preview-panel">
          <div className="preview-card">
            <h2>Превью</h2>
            {previewSource ? (
              <img src={previewSource} alt="Preview" />
            ) : (
              <div className="empty-state">Здесь появится изображение</div>
            )}
          </div>

          <div className="result-card">
            <h2>Рекомендации</h2>
            <pre>{analysis || "Результат появится здесь."}</pre>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
