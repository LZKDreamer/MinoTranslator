/* ═══════════════════════════════════════════════
   translate-prompt.js — 共享翻译 Prompt 构建模块
   为字幕翻译、划词翻译提供统一、分级的 prompt 生成
   使用 var 顶层声明，兼容 content script / service worker / offscreen 三种上下文
   ═══════════════════════════════════════════════ */

var TranslatePrompt = (function () {
  'use strict';

  // ======== 语言等级 ========
  // high:   主语频繁省略、敬语体系、高度上下文依赖（ko, ja, zh, th, vi）
  // medium: pro-drop / 部分省略（ar, es, it, pt, hi, tr, id, ms, ru, uk, el, bn, ro, fa, pl, cs, sk, sr, hr, sw, hu, fi）
  // low:    主语强制出现，语法信息词面完整（en, fr, de, nl, sv, no, da...）
  function getLanguageLevel(lang) {
    if (!lang || lang === 'unknown') return 'medium';
    var code = lang.split(/[-_]/)[0].toLowerCase();
    if (['ko', 'ja', 'zh', 'th', 'vi'].indexOf(code) !== -1) return 'high';
    if (['ar', 'es', 'it', 'pt', 'hi', 'tr', 'id', 'ms', 'ru', 'uk', 'el', 'bn', 'ro', 'fa', 'pl', 'cs', 'sk', 'sr', 'hr', 'sw', 'hu', 'fi'].indexOf(code) !== -1) return 'medium';
    return 'low';
  }

  function getContextWindowSize(sourceLanguage) {
    var level = getLanguageLevel(sourceLanguage);
    if (level === 'high') return 3;
    if (level === 'medium') return 2;
    return 1;
  }

  // ======== 语言名称映射 ========
  function getLangName(lang) {
    if (lang === 'zh-CN') return 'Simplified Chinese';
    if (lang === 'zh-TW') return 'Traditional Chinese';
    if (lang === 'en') return 'English';
    if (lang === 'ko') return 'Korean';
    if (lang === 'ja') return 'Japanese';
    if (lang === 'ar') return 'Arabic';
    if (lang === 'es') return 'Spanish';
    if (lang === 'fr') return 'French';
    if (lang === 'de') return 'German';
    if (lang === 'ru') return 'Russian';
    if (lang === 'pt') return 'Portuguese';
    if (lang === 'it') return 'Italian';
    if (lang === 'th') return 'Thai';
    if (lang === 'vi') return 'Vietnamese';
    if (lang === 'tr') return 'Turkish';
    if (lang === 'nl') return 'Dutch';
    if (lang === 'pl') return 'Polish';
    return lang || 'target language';
  }

  // ======== 构建字幕翻译 prompt（统一入口） ========

  /**
   * 构建字幕翻译的 messages 数组
   * @param {Object} opts
   * @param {string[]} opts.texts - 待翻译文本数组
   * @param {string} opts.targetLanguage - 目标语言代码
   * @param {string} opts.sourceLanguage - 源语言代码
   * @param {Array<{texts:string[], translations:string[]}>} [opts.prevContexts] - 前 N 组上下文
   * @param {string} [opts.videoTitle] - 视频标题
   * @returns {{ system: string, user: string }}  { system, user } 消息
   */
  function buildSubtitlePrompt(opts) {
    var targetName = getLangName(opts.targetLanguage);
    var sourceName = getLangName(opts.sourceLanguage);
    var isBatch = opts.texts.length > 1;

    // === System Prompt ===
    var systemLines = [];
    systemLines.push('You are a professional subtitle translator. Translate video subtitles from ' + sourceName + ' to natural, colloquial ' + targetName + '.');
    systemLines.push('');
    systemLines.push('Core rules:');
    systemLines.push('1. Produce natural, spoken ' + targetName + ' — NEVER translate word-for-word');
    systemLines.push('2. Adapt idioms, slang, and cultural references to equivalent ' + targetName + ' expressions');
    systemLines.push('3. Preserve the speaker\'s tone, emotion, and intent (humor, sarcasm, anger, affection, etc.)');
    systemLines.push('4. Keep translations concise — subtitles must be readable at speaking speed');
    systemLines.push('5. Match the register: formal/casual/polite/intimate as in the original');
    systemLines.push('6. Maintain consistent translations for character names, places, and recurring terms');

    if (opts.videoTitle) {
      systemLines.push('');
      systemLines.push('Video topic: ' + opts.videoTitle + ' — use this to disambiguate domain-specific terms.');
    }

    // === User Prompt ===
    var userParts = [];
    if (isBatch) {
      userParts.push('Translate these ' + opts.texts.length + ' subtitle lines into natural ' + targetName + '.');
      userParts.push('Return ONLY a JSON array of ' + opts.texts.length + ' strings in the same order.');
      userParts.push('Do not merge, skip, or reorder lines. No explanations.');
    } else {
      userParts.push('Translate this subtitle into natural ' + targetName + '.');
      userParts.push('Output only the translation, no explanations.');
    }

    // Context
    if (opts.prevContexts && opts.prevContexts.length > 0) {
      userParts.push('');
      userParts.push('--- Previous dialogue for context (already translated, do NOT re-translate) ---');
      opts.prevContexts.forEach(function (ctx, i) {
        userParts.push('[' + (i + 1) + '] Original: ' + ctx.texts.join(' | '));
        userParts.push('[' + (i + 1) + '] Translation: ' + ctx.translations.join(' | '));
      });
      userParts.push('--- End context ---');
    }

    // Input text
    if (isBatch) {
      userParts.push('');
      userParts.push(JSON.stringify(opts.texts));
    } else {
      userParts.push('');
      userParts.push(opts.texts[0]);
    }

    return {
      system: systemLines.join('\n'),
      user: userParts.join('\n'),
    };
  }

  /**
   * 构建全文本字幕重写 prompt
   * AI 一次性完成：清洗、断句、时间轴校正、翻译
   * 适合 Agnes-2.0-Flash 等长上下文模型
   * @param {Object} opts
   * @param {Array<{start:number, end:number, text:string}>} opts.cues - 原始 ASR 字幕数组
   * @param {string} opts.sourceLanguage - 源语言代码（传空则 AI 自动检测）
   * @param {string} opts.targetLanguage - 目标语言代码
   * @param {string} [opts.videoTitle] - 视频标题
   * @returns {{ system: string, user: string }}
   */
  function buildRewritePrompt(opts) {
    var targetName = getLangName(opts.targetLanguage);
    var sourceName = opts.sourceLanguage ? getLangName(opts.sourceLanguage) : null;
    var cues = opts.cues || [];

    // === System Prompt ===
    var systemLines = [];
    if (sourceName) {
      systemLines.push('You are a professional subtitle editor and translator. Your task is to rewrite and translate raw ASR (automatic speech recognition) output from ' + sourceName + ' to natural, colloquial ' + targetName + '.');
    } else {
      systemLines.push('You are a professional subtitle editor and translator. Your task is to rewrite and translate raw ASR (automatic speech recognition) output to natural, colloquial ' + targetName + '. Detect the source language automatically from the text.');
    }
    systemLines.push('');
    systemLines.push('The ASR output is fragmented — short pieces split by silences. Many fragments are not complete sentences.');
    systemLines.push('');
    systemLines.push('Step-by-step:');
    systemLines.push('1. CLEAN: Remove filler words (um, uh, er, ah, hmm), music markers [music], speaker indicators (>>), and recognition artifacts.');
    systemLines.push('2. RE-SEGMENT: Merge fragments that belong to the same sentence. Split run-on sentences. Add proper punctuation (periods, commas, question marks).');
    systemLines.push('3. ASSIGN TIMING: For each re-segmented sentence, use the start time from its first fragment and the end time from its last fragment. Do NOT invent times.');
    systemLines.push('4. TRANSLATE: Into natural, colloquial ' + targetName + ' — NEVER word-for-word. Adapt idioms, preserve tone and emotion. Keep concise for subtitle reading speed.');
    systemLines.push('');
    systemLines.push('CRITICAL rules:');
    systemLines.push('- Every output entry MUST have a "start" and "end" that come FROM the input timestamps, never invented.');
    systemLines.push('- Do NOT merge sentences that are far apart (>2 second gap between them).');
    systemLines.push('- Preserve the original order of speech.');
    systemLines.push('- Speaker changes (different people talking) should be in separate entries.');
    systemLines.push('- Each subtitle entry MUST be short enough to read comfortably at speaking speed:');
    systemLines.push('  • Maximum 4 seconds duration per entry');
    systemLines.push('  • Maximum 70 characters per entry (any language)');
    systemLines.push('  • If a sentence exceeds these limits, split it into multiple consecutive entries with appropriate timestamps');
    systemLines.push('- Output ONLY valid JSON. No markdown, no code blocks, no explanations.');
    systemLines.push('');
    systemLines.push('Return a JSON array of objects:');
    systemLines.push('[{"start": number, "end": number, "original": "cleaned original text", "translated": "translated text"}]');

    if (opts.videoTitle) {
      systemLines.push('');
      systemLines.push('Video topic: ' + opts.videoTitle + ' — use this to disambiguate domain-specific terms.');
    }

    // === User Prompt ===
    var userParts = [];
    userParts.push('Below is the raw ASR subtitle output. Each line has the format [start-end] text.');
    userParts.push('Clean, re-segment, assign timing, and translate into ' + targetName + '.');
    userParts.push('');
    userParts.push('--- Raw ASR transcript ---');
    for (var i = 0; i < cues.length; i++) {
      userParts.push('[' + cues[i].start.toFixed(3) + '-' + cues[i].end.toFixed(3) + '] ' + (cues[i].text || ''));
    }
    userParts.push('--- End of transcript ---');

    return {
      system: systemLines.join('\n'),
      user: userParts.join('\n'),
    };
  }

  /**
   * 构建划词翻译的 messages 数组
   * @param {Object} opts
   * @param {string} opts.text - 待翻译文本
   * @param {string} opts.targetLanguage - 目标语言代码
   * @returns {{ system: string, user: string }}
   */
  function buildFloatingPrompt(opts) {
    var targetName = getLangName(opts.targetLanguage);

    var system = [
      'You are a translator. Translate the following text to natural, accurate ' + targetName + '.',
      'Preserve the original meaning, tone, and intent.',
      'Use natural ' + targetName + ' expressions — avoid stiff, literal, or machine-like phrasing.',
      'Output ONLY the translation. No explanations, no greetings, no notes.',
    ].join('\n');

    return {
      system: system,
      user: opts.text,
    };
  }

  // ======== 字幕清洗（分语言） ========

  /**
   * 清洗字幕文本
   * @param {string} text - 原始文本
   * @param {Object} opts
   * @param {boolean} opts.forTranslation - 是否用于翻译（会做更深度清洗但保留场景标记）
   * @param {string} [opts.sourceLanguage] - 源语言代码，用于语言特定清洗
   * @returns {string}
   */
  function cleanCueText(text, opts) {
    var o = opts || {};
    var cleaned = String(text || '');
    var code = (o.sourceLanguage || '').split(/[-_]/)[0].toLowerCase();

    // 通用清洗
    cleaned = cleaned.replace(/<[^>]+>/g, '');           // HTML 标签
    cleaned = cleaned.replace(/^(>>|>|Speaker\s*\d*:)\s*/i, ''); // 说话人标记

    if (o.forTranslation) {
      // 保留方括号场景标记（仅提取内容作为上下文提示，不删除）
      // 如 [음악]→(音乐) [웃음]→(笑声) [박수]→(掌声) [환호]→(欢呼)
      // 这些对 AI 理解场景有价值
      // 但纯标记类如 [*] [♫] 删除
      cleaned = cleaned.replace(/\[[*♫♪🎵]+\]/g, '');
    } else {
      // 非翻译模式：删除方括号内容
      cleaned = cleaned.replace(/\[.*?\]/g, '');
    }

    if (o.forTranslation) {
      // 英文填充词（含扩展元音填充 eeee/aaaa/oooo 等）
      cleaned = cleaned.replace(/\b(um|uh|er|ah|hmm|mm-hmm|uh-huh|e{2,}|a{2,}|o{2,}|m{2,})\b/gi, '');

      // 韩语填充词
      if (code === 'ko') {
        cleaned = cleaned.replace(/\b(음|어|아|그|저|으+)\b/gi, '');
        cleaned = cleaned.replace(/([가-힣])\1{2,}/g, '$1$1'); // 韩文字符重复（如 그그그 → 그）
      }

      // 日语填充词
      if (code === 'ja') {
        cleaned = cleaned.replace(/\b(えーと|あの|その|まあ|えー+|うーん)\b/gi, '');
      }

      // 通用：去除重复单词（英文等）
      cleaned = cleaned.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');

      // 时间标记 (00:15)
      cleaned = cleaned.replace(/\(\d{1,2}:\d{2}(:\d{2})?\)/g, '');

      // 填充词移除后留下的孤立标点清理（如 "Oh, ." → "Oh."，"Hello ," → "Hello"）
      cleaned = cleaned.replace(/,\s*\./g, '.');
      cleaned = cleaned.replace(/\s+,/g, ',');
      cleaned = cleaned.replace(/(\s+\.){2,}/g, '.');
      cleaned = cleaned.replace(/^\s*[,.;:]+/, '');
    }

    return cleaned.replace(/\s+/g, ' ').trim();
  }

  // ======== 批量翻译 prompt（新方案：本地已断句，AI 只翻译）========

  /**
   * 构建批量字幕翻译的 messages 数组
   * 本地已完成断句和时间轴对齐，AI 只需要翻译
   * @param {Object} opts
   * @param {string[]} opts.sentences - 已断句的原文数组
   * @param {string} opts.targetLanguage - 目标语言代码
   * @param {string} [opts.sourceLanguage] - 源语言代码
   * @param {string} [opts.videoTitle] - 视频标题（提供领域上下文）
   * @param {Array<{index:number, original:string, translated:string}>} [opts.prevContexts] - 前一批的最后几句译文
   * @returns {{ system: string, user: string }}
   */
  function buildBatchTranslatePrompt(opts) {
    var targetName = getLangName(opts.targetLanguage);
    var sourceName = opts.sourceLanguage ? getLangName(opts.sourceLanguage) : 'the source language';
    var isBatch = opts.sentences.length > 1;

    // === System Prompt ===
    var systemLines = [];
    // 🔴 关键：放在最前面，任何语言对都适用
    systemLines.push('CRITICAL — READ THIS FIRST:');
    systemLines.push('- Your ONLY task is to translate. Output must be in ' + targetName + ' ONLY.');
    systemLines.push('- NEVER output any ' + sourceName + ' text. NEVER mix languages in the output.');
    systemLines.push('- If you output even one ' + sourceName + ' word, the entire response is a FAILURE.');
    systemLines.push('');
    systemLines.push('You are a professional subtitle translator.');
    systemLines.push('Translate the following lines from ' + sourceName + ' to natural, colloquial ' + targetName + '.');
    systemLines.push('');
    systemLines.push('CORE RULES:');
    systemLines.push('1. Natural spoken ' + targetName + ' — like a native speaker, NOT literal word-for-word translation');
    systemLines.push('2. Adapt idioms, slang, and cultural references to equivalent ' + targetName + ' expressions');
    systemLines.push('3. Preserve the speaker\'s tone and intent: casual, formal, humorous, serious, sarcastic, excited');
    systemLines.push('4. Keep each line concise and natural — subtitles are read at speaking speed');
    systemLines.push('5. Maintain flow and coherence — consecutive lines should read as continuous natural speech');
    systemLines.push('6. Questions stay questions, exclamations stay exclamations, commands stay commands');
    systemLines.push('');
    systemLines.push('CRITICAL:');
    systemLines.push('- Translate EACH line independently into ' + targetName);
    systemLines.push('- Do NOT merge lines, do NOT skip lines, do NOT reorder lines');
    systemLines.push('- Do NOT add explanations, notes, greetings, or commentary');
    systemLines.push('- Do NOT answer questions in the text — TRANSLATE them');
    systemLines.push('- Output ONLY the translations');

    if (isBatch) {
      systemLines.push('');
      systemLines.push('OUTPUT FORMAT:');
      systemLines.push('Return ONLY a JSON object mapping sentence index to translation.');
      systemLines.push('Keys are the [N] numbers from below, values are the ' + targetName + ' translations.');
      systemLines.push('Example: {"0":"translation of line 0","1":"translation of line 1","2":"translation of line 2"}');
      systemLines.push('- One entry per input line. If you cannot translate a line, output an empty string for it: "5":""');
      systemLines.push('- No markdown, no code blocks, no explanations.');
    }

    // === User Prompt ===
    var userParts = [];

    if (opts.videoTitle) {
      userParts.push('Video topic: "' + opts.videoTitle + '"');
      userParts.push('');
    }

    // Previous context (for sequential batches on long videos)
    if (opts.prevContexts && opts.prevContexts.length > 0) {
      userParts.push('--- Previous lines (already translated, for context only) ---');
      opts.prevContexts.forEach(function (ctx) {
        userParts.push('[' + ctx.index + '] ' + sourceName + ': ' + ctx.original);
        userParts.push('[' + ctx.index + '] ' + targetName + ': ' + ctx.translated);
      });
      userParts.push('--- End of context ---');
      userParts.push('');
    }

    if (isBatch) {
      userParts.push('Translate these ' + opts.sentences.length + ' subtitle lines to natural ' + targetName + ':');
      userParts.push('REMINDER: output ' + targetName + ' ONLY — NO ' + sourceName + ' text anywhere.');
      userParts.push('');
      opts.sentences.forEach(function (s, i) {
        userParts.push('[' + i + '] ' + s);
      });
    } else {
      userParts.push('Translate this subtitle line to natural ' + targetName + ':');
      userParts.push('');
      userParts.push(opts.sentences[0]);
    }

    return {
      system: systemLines.join('\n'),
      user: userParts.join('\n'),
    };
  }

  return {
    getLanguageLevel: getLanguageLevel,
    getContextWindowSize: getContextWindowSize,
    getLangName: getLangName,
    buildSubtitlePrompt: buildSubtitlePrompt,
    buildFloatingPrompt: buildFloatingPrompt,
    buildRewritePrompt: buildRewritePrompt,
    buildBatchTranslatePrompt: buildBatchTranslatePrompt,
    cleanCueText: cleanCueText,
  };
})();
