/* ═══════════════════════════════════════════════
   translator.js — 翻译 API 抽象层
   统一使用 OpenAI-compatible /chat/completions 格式
   ═══════════════════════════════════════════════ */

// translate-prompt.js is loaded via service-worker.js importScripts before this file
const Translator = (() => {
  // 翻译缓存：Map<`text:targetLang:modelKey`, { result, timestamp }>
  const cache = new Map();
  const CACHE_TTL = 1000 * 60 * 60; // 1 hour

  function getCacheKey(text, targetLang, modelKey) {
    return `${text}:${targetLang}:${modelKey}`;
  }

  /**
   * 翻译单段文本
   * @param {string} text - 原文
   * @param {string} modelKey - 模型配置键名（如 'agnes-ai'）
   * @returns {Promise<string>} 译文
   */
  async function translate(text, modelKey) {
    if (!text || !text.trim()) return '';

    const models = await StorageManager.get('models');
    const targetLang = resolveTargetValue(await StorageManager.get('targetLanguage'));
    const resolvedKey = modelKey || 'agnes-ai';
    const model = models[resolvedKey];

    if (!model || !model.enabled) {
      throw new Error('Model not configured or disabled');
    }
    if (!model.apiKey) {
      throw new Error('API Key not configured');
    }

    // Check cache
    const cacheKey = getCacheKey(text, targetLang, resolvedKey);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }

    // Build prompt using shared module
    const sourceLang = detectSourceLanguage(text);
    const prompt = TranslatePrompt.buildFloatingPrompt({
      text: text,
      targetLanguage: targetLang,
      sourceLanguage: sourceLang,
    });

    const response = await fetch(`${model.apiUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.trim() || '';

    // Cache result
    cache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * 批量翻译（带限速控制）
   * @param {string[]} texts - 原文数组
   * @param {string} modelKey
   * @param {function} onProgress - 每完成一条的回调
   * @returns {Promise<string[]>} 译文数组
   */
  async function translateBatch(texts, modelKey, onProgress) {
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      try {
        const t = await translate(texts[i], modelKey);
        results.push(t);
      } catch (e) {
        results.push('');
      }
      if (onProgress) onProgress(i + 1, texts.length);
      // Rate limiting: 100ms between requests
      if (i < texts.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    return results;
  }

  return { translate, translateBatch };
})();
