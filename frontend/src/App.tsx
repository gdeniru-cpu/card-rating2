import { useMemo, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const categories = ["Общие", "Электроника", "Одежда", "Красота"];

function App() {
  const [imageUrl, setImageUrl] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | null>(null);
  const [useUrl, setUseUrl] = useState(true);
  const [category, setCategory] = useState(categories[0]);
  const [analysisData, setAnalysisData] = useState<any | null>(null);
  const [analysisText, setAnalysisText] = useState<string>("");
  const [expandedCriteria, setExpandedCriteria] = useState<Record<string, number | null>>({});
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const previewSource = useMemo(() => {
    if (useUrl) {
      return resolvedImageUrl || imageUrl || null;
    }
    return imageData;
  }, [useUrl, imageUrl, imageData, resolvedImageUrl]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImageData(result);
      setUseUrl(false);
      setResolvedImageUrl(null);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    setError("");
    setAnalysisData(null);
    setAnalysisText("");

    const useImageUrl = useUrl && imageUrl.trim().length > 0;
    const useImageData = !useUrl && imageData;

    if (!useImageUrl && !useImageData) {
      setError("Выберите файл или вставьте URL изображения или карточки товара.");
      return;
    }

    const payload: Record<string, unknown> = {
      category,
    };

    if (useImageUrl) {
      const trimmedUrl = imageUrl.trim();
      const isImage = /\.(jpe?g|png|webp|avif|gif|svg)(?:[\?#]|$)/i.test(trimmedUrl);
      if (isImage) {
        payload.imageUrl = trimmedUrl;
      } else {
        payload.pageUrl = trimmedUrl;
      }
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
      if (data.resolvedImageUrl && useImageUrl) {
        setResolvedImageUrl(data.resolvedImageUrl);
      }

      if (data.assistant && typeof data.assistant === "object") {
        setAnalysisData(data.assistant);
        setAnalysisText(JSON.stringify(data.assistant, null, 2));
      } else {
        setAnalysisData(null);
        setAnalysisText(String(data.assistant ?? JSON.stringify(data.raw, null, 2)));
      }
      setDemoMode(Boolean(data.demo));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setDemoMode(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleCriterion = (sectionKey: string, criterionId: number) => {
    setExpandedCriteria((prev) => ({
      ...prev,
      [sectionKey]: prev[sectionKey] === criterionId ? null : criterionId,
    }));
  };

  const renderCriterion = (sectionKey: string, criterion: any) => {
    const expanded = expandedCriteria[sectionKey] === criterion.id;
    return (
      <div key={criterion.id} className="analysis-criterion">
        <button
          type="button"
          className="criterion-toggle"
          onClick={() => toggleCriterion(sectionKey, criterion.id)}
        >
          <span className="criterion-name">{criterion.name}</span>
          <span className="criterion-score">{criterion.score}/10</span>
          <span className="criterion-toggle-icon">{expanded ? "▼" : "▶"}</span>
        </button>
        {expanded && (
          <div className="criterion-text">
            <p><strong>Кратко:</strong> {criterion.summary}</p>
            <p><strong>Рекомендация:</strong> {criterion.recommendation}</p>
          </div>
        )}
      </div>
    );
  };

  const renderSection = (index: number, sectionKey: string, section: any) => {
    if (!section) return null;
    return (
      <div key={sectionKey} className="analysis-section">
        <h3>{index}. {section.title}</h3>
        <div className="section-meta">
          <span>Вес: {section.weight}%</span>
          <span>Оценка: {section.score}/10</span>
        </div>
        <div className="section-criteria">
          {Array.isArray(section.criteria) && section.criteria.map((criterion: any) => renderCriterion(sectionKey, criterion))}
        </div>
        <div className="section-summary">
          <p><strong>Краткий вывод:</strong> {section.summary}</p>
          <p><strong>Рекомендация по разделу:</strong> {section.recommendation}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <header>
        <h1>Card Rating 2</h1>
        <p>Загрузите фото карточки товара или вставьте URL, чтобы получить структурированный анализ в JSON.</p>
      </header>

      <main>
        <section className="controls">
          <div className="switch-row">
            <button className={useUrl ? "active" : ""} onClick={() => {
              setUseUrl(true);
              setResolvedImageUrl(null);
            }}>
              Использовать URL
            </button>
            <button className={!useUrl ? "active" : ""} onClick={() => {
              setUseUrl(false);
              setResolvedImageUrl(null);
            }}>
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
              Ссылка на изображение или на карточку товара Wildberries / Ozon
              <input
                type="url"
                placeholder="https://www.wildberries.ru/catalog/... или https://www.ozon.ru/product/..."
                value={imageUrl}
                onChange={(e) => {
                  setImageUrl(e.target.value);
                  setResolvedImageUrl(null);
                }}
              />
              <small>Если вы вставите страницу товара Wildberries или Ozon, сервис попытается извлечь главное фото.</small>
            </label>
          ) : (
            <label>
              Файл изображения
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </label>
          )}

          <button className="analyze-button" onClick={handleAnalyze} disabled={loading}>
            {loading ? "Анализируется..." : "Получить рекомендации"}
          </button>
          {resolvedImageUrl && (
            <div className="alert info">
              Извлечено изображение из товарной страницы: {resolvedImageUrl}
            </div>
          )}

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
            {demoMode && (
              <div className="alert info">
                Сейчас показывается демонстрационный результат, потому что для реального анализа недостаточно кредитов API.
              </div>
            )}

            {analysisData ? (
              <div className="analysis-result">
                <div className="analysis-summary">
                  <div>Overall score: {analysisData.overallScore}/10</div>
                  <div>Category: {analysisData.category}</div>
                  {analysisData.subcategory && <div>Узкая категория: {analysisData.subcategory}</div>}
                  {analysisData.brand && <div>Бренд: {analysisData.brand}</div>}
                </div>

                {analysisData.sections && Object.entries(analysisData.sections).map(([key, section], index) => renderSection(index + 1, key, section))}

                {analysisData.aiCroCriteria && (
                  <div className="analysis-section">
                    <h3>AI-SPECIFIC CRO CRITERIA</h3>
                    <div className="section-meta">
                      <span>Оценка: {analysisData.aiCroCriteria.score}/10</span>
                    </div>
                    {Array.isArray(analysisData.aiCroCriteria.criteria) && analysisData.aiCroCriteria.criteria.map(renderCriterion)}
                  </div>
                )}
              </div>
            ) : (
              <pre>{analysisText || "Результат появится здесь."}</pre>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
