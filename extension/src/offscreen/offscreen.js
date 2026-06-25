(function () {
  'use strict';

  const GROUP_MAX_CUES = 10;
  const GROUP_MAX_SECONDS = 25;
  const GROUP_MAX_CHARS = 600;
  const REQUEST_TIMEOUT_MS = 60000;
  const MAX_RETRIES = 2;
  const RETRY_BASE_DELAY_MS = 1200;
  const WORKER_COUNT = 4;
  const MAX_TOKENS = 1024;
  const controllers = new Map();

  // 自适应限速器：动态调整并发度和请求间隔，响应 API 429 限速
  const RateLimiter = {
    maxConcurrency: 6,
    minConcurrency: 1,
    currentConcurrency: 4,
    inFlight: 0,
    waiters: [],
    consecutive429s: 0,
    consecutiveSuccesses: 0,
    baseDelayMs: 30,
    currentDelayMs: 30,
    rampUpThreshold: 20,

    async acquire() {
      while (this.inFlight >= this.currentConcurrency) {
        await new Promise(function (r) { RateLimiter.waiters.push(r); });
      }
      this.inFlight++;
    },

    release() {
      this.inFlight--;
      var next = this.waiters.shift();
      if (next) next();
    },

    report429() {
      this.consecutive429s++;
      this.consecutiveSuccesses = 0;
      if (this.currentConcurrency > this.minConcurrency) {
        this.currentConcurrency--;
      }
      this.currentDelayMs = Math.min(5000, this.currentDelayMs * 2);
    },

    reportSuccess() {
      this.consecutiveSuccesses++;
      this.consecutive429s = 0;
      if (this.consecutiveSuccesses > this.rampUpThreshold && this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        this.consecutiveSuccesses = 0;
        this.currentDelayMs = Math.max(this.baseDelayMs, Math.floor(this.currentDelayMs / 2));
      }
    },

    getDelay() {
      return this.consecutive429s > 0 ? this.currentDelayMs : this.baseDelayMs;
    },
  };

  // translate-prompt.js 已由 offscreen.html 加载，提供 TranslatePrompt

  chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
    if (request.type === 'OFFSCREEN_START_TRANSLATION') {
      startTask(request.task).catch(function (err) {
        report(request.task.videoId, { status: 'failed', error: err.message });
      });
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === 'OFFSCREEN_CANCEL_TRANSLATION') {
      const controller = controllers.get(request.videoId);
      if (controller) controller.abort();
      controllers.delete(request.videoId);
      sendResponse({ ok: true });
      return false;
    }
  });

  async function startTask(task) {
    const controller = new AbortController();
    controllers.set(task.videoId, controller);

    const groups = buildTranslationGroups(task.cues || []);
    let completedGroups = 0;
    report(task.videoId, {
      status: 'translating',
      progress: 0,
      completedGroups,
      totalGroups: groups.length,
    });

    const pending = groups.slice();
    var contextByGroupIndex = [];
    const workers = [];
    for (let i = 0; i < WORKER_COUNT; i++) {
      workers.push(runWorker());
    }
    await Promise.all(workers);

    if (!controller.signal.aborted) {
      report(task.videoId, {
        status: 'completed',
        progress: 100,
        completedGroups: groups.length,
        totalGroups: groups.length,
      });
    }
    controllers.delete(task.videoId);

    async function runWorker() {
      while (pending.length && !controller.signal.aborted) {
        const group = pending.shift();

        // 收集前 N 组已完成翻译作为上下文（N 基于源语言上下文依赖等级）
        var groupIndex = groups.indexOf(group);
        var contextWindowSize = TranslatePrompt.getContextWindowSize(task.sourceLanguage);
        var prevContexts = [];
        for (var ci = groupIndex - 1; ci >= 0 && prevContexts.length < contextWindowSize; ci--) {
          if (contextByGroupIndex[ci]) {
            prevContexts.unshift(contextByGroupIndex[ci]);
          }
        }

        const translations = await translateGroupWithCache(group, task, controller.signal, prevContexts);

        // 存储当前组的翻译结果作为上下文
        if (translations && translations.length > 0) {
          contextByGroupIndex[groupIndex] = {
            texts: group.texts.slice(),
            translations: translations.slice(),
          };
        }
        await sendMessage({
          type: 'VIDEO_TASK_GROUP_TRANSLATED',
          videoId: task.videoId,
          payload: {
            cueIndices: group.cueIndices,
            translations,
          },
        });
        completedGroups += 1;
        report(task.videoId, {
          status: 'translating',
          progress: groups.length ? Math.round(completedGroups / groups.length * 100) : 0,
          completedGroups,
          totalGroups: groups.length,
        });
        if (pending.length) await delay(RateLimiter.getDelay());
      }
    }
  }

  async function translateGroupWithCache(group, task, signal, prevContexts) {
    const cacheKey = getCacheKey(group.text, task);
    const cached = await sendMessage({ type: 'CACHE_GET', key: cacheKey });
    if (Array.isArray(cached.value) && cached.value.length >= group.cueIndices.length) {
      return normalizeArray(cached.value, group.cueIndices.length);
    }
    if (typeof cached.value === 'string' && cached.value && group.cueIndices.length === 1) {
      return [cached.value];
    }

    let translations;
    try {
      translations = await translateWithRetry(group.texts, task, signal, prevContexts);
    } catch (err) {
      translations = [];
      for (const text of group.texts) {
        if (signal.aborted) throw new Error('Translation canceled');
        translations.push(await translateWithRetry(text, task, signal, prevContexts));
        await delay(RateLimiter.getDelay());
      }
    }

    translations = Array.isArray(translations)
      ? normalizeArray(translations, group.cueIndices.length)
      : group.cueIndices.map(function () { return translations || '翻译失败'; });
    await sendMessage({ type: 'CACHE_SET', key: cacheKey, value: translations });
    return translations;
  }

  async function translateWithRetry(text, task, signal, prevContexts) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * attempt);
        return await translate(text, task, signal, prevContexts);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Translation failed');
  }

  async function translate(text, task, signal, prevContexts) {
    const isBatch = Array.isArray(text);
    const inputTexts = isBatch ? text : [text];

    // 使用共享 prompt 构建器
    var prompt = TranslatePrompt.buildSubtitlePrompt({
      texts: inputTexts,
      targetLanguage: task.targetLanguage,
      sourceLanguage: task.sourceLanguage,
      prevContexts: prevContexts && prevContexts.length > 0 ? prevContexts : null,
      videoTitle: task.title || null,
    });

    await RateLimiter.acquire();
    var response;
    try {
      response = await fetchWithTimeout(task.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + task.apiKey,
        },
        body: JSON.stringify({
          model: task.modelId,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: MAX_TOKENS,
          temperature: 0.35,
        }),
        signal,
      }, REQUEST_TIMEOUT_MS);
    } finally {
      RateLimiter.release();
    }

    if (response.status === 429) {
      RateLimiter.report429();
      var retryAfter = response.headers.get('Retry-After');
      var waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RateLimiter.getDelay();
      await delay(waitMs);
      throw new Error('API rate limited (429)');
    }

    if (!response.ok) {
      const errText = await response.text().catch(function () { return ''; });
      throw new Error('API error ' + response.status + ': ' + errText.slice(0, 200));
    }

    RateLimiter.reportSuccess();

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    return isBatch ? parseArray(content, inputTexts.length) : content;
  }

  function buildTranslationGroups(cues) {
    const groups = [];
    let current = { cueIndices: [], texts: [], start: null, end: null };
    cues.forEach(function (cue, index) {
      const text = TranslatePrompt.cleanCueText(cue.text, { forTranslation: true });
      if (!text) return;
      if (current.cueIndices.length > 0 && wouldOverflow(current, cue, text)) {
        groups.push(finalize(current));
        current = { cueIndices: [], texts: [], start: null, end: null };
      }
      current.cueIndices.push(index);
      current.texts.push(text);
      current.start = current.start == null ? cue.start : current.start;
      current.end = cue.end;
      if (/[.?!。？！]$/.test(text)) {
        groups.push(finalize(current));
        current = { cueIndices: [], texts: [], start: null, end: null };
      }
    });
    if (current.cueIndices.length) groups.push(finalize(current));
    return groups;
  }

  function finalize(group) {
    return {
      cueIndices: group.cueIndices.slice(),
      texts: group.texts.slice(),
      start: group.start,
      end: group.end,
      text: group.texts.join(' '),
    };
  }

  function wouldOverflow(group, cue, text) {
    const nextText = group.texts.concat(text).join(' ');
    return group.cueIndices.length >= GROUP_MAX_CUES ||
      nextText.length > GROUP_MAX_CHARS ||
      cue.end - group.start > GROUP_MAX_SECONDS;
  }

  function cleanCueText(text, forTranslation) {
    return TranslatePrompt.cleanCueText(text, { forTranslation: !!forTranslation });
  }

  function getCacheKey(text, task) {
    return [
      'ytSubCache',
      task.videoId || '',
      task.sourceLanguage || '',
      task.targetLanguage || '',
      task.modelKey || '',
      task.modelId || '',
      hashText(TranslatePrompt.cleanCueText(text, { forTranslation: true }).toLowerCase()),
    ].join(':');
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function parseArray(text, expectedLength) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      const match = String(text || '').match(/\[[\s\S]*\]/);
      if (match) parsed = JSON.parse(match[0]);
    }
    return normalizeArray(parsed, expectedLength);
  }

  function normalizeArray(value, expectedLength) {
    if (!Array.isArray(value)) throw new Error('Translation response is not an array');
    const normalized = value.map(function (item) { return String(item || '').trim(); });
    while (normalized.length < expectedLength) normalized.push('');
    return normalized.slice(0, expectedLength);
  }

  function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    if (init.signal) {
      init.signal.addEventListener('abort', function () {
        controller.abort();
      }, { once: true });
    }
    return fetch(url, { ...init, signal: controller.signal }).finally(function () {
      clearTimeout(timer);
    });
  }

  function report(videoId, payload) {
    sendMessage({ type: 'VIDEO_TASK_PROGRESS', videoId, payload }).catch(function () {});
  }

  function sendMessage(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
})();
