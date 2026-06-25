/* ═══════════════════════════════════════════════
   crypto-utils.js — API Key 加解密工具
   使用 AES-256-GCM + PBKDF2 派生密钥
   加密种子存储在 chrome.storage.sync 便于跨设备同步
   ═══════════════════════════════════════════════ */

const ApiKeyCrypto = (() => {
  'use strict';

  const KEY_SEED_KEY = '_apiKeySeed';
  const PBKDF2_SALT = 'MinoTranslator-AES-GCM-v1';
  const PBKDF2_ITERATIONS = 100000;
  const ENC_PREFIX = '_e:';  // 加密值前缀，用于区分新旧格式

  let _seed = null;
  let _cachedKey = null;

  /**
   * 初始化或获取加密种子
   * 种子是一个 256 位随机 hex 字符串，存储在 chrome.storage.sync
   */
  async function getOrCreateSeed() {
    if (_seed) return _seed;
    try {
      const result = await chrome.storage.sync.get(KEY_SEED_KEY);
      if (result[KEY_SEED_KEY]) {
        _seed = result[KEY_SEED_KEY];
        return _seed;
      }
      // 生成新种子（32 字节 → 64 位 hex）
      const seedBytes = new Uint8Array(32);
      crypto.getRandomValues(seedBytes);
      _seed = Array.from(seedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      await chrome.storage.sync.set({ [KEY_SEED_KEY]: _seed });
      return _seed;
    } catch (e) {
      console.warn('[Crypto] getOrCreateSeed failed:', e);
      return null;
    }
  }

  /**
   * 从种子派生 AES-256-GCM 密钥（PBKDF2）
   */
  async function deriveKey(seed) {
    if (!seed) return null;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(seed),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(PBKDF2_SALT),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 获取缓存的派生密钥
   */
  async function getKey() {
    if (_cachedKey) return _cachedKey;
    const seed = await getOrCreateSeed();
    if (!seed) return null;
    _cachedKey = await deriveKey(seed);
    return _cachedKey;
  }

  /**
   * 加密明文 → `_e:base64(IV + ciphertext)`
   * @param {string} plaintext - 明文
   * @returns {Promise<string>} 加密字符串（空输入返回空）
   */
  async function encrypt(plaintext) {
    if (!plaintext) return '';
    try {
      const key = await getKey();
      if (!key) return plaintext; // 降级：无密钥则返回明文

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);

      return ENC_PREFIX + btoa(String.fromCharCode(...combined));
    } catch (e) {
      console.warn('[Crypto] encrypt failed:', e);
      return plaintext; // 降级返回明文
    }
  }

  /**
   * 解密 `_e:base64(IV + ciphertext)` → 明文
   * 自动兼容旧格式（无前缀的原始明文）
   * @param {string} ciphertext - 加密字符串
   * @returns {Promise<string>} 明文（空输入或无法解密返回空）
   */
  async function decrypt(ciphertext) {
    if (!ciphertext) return '';
    // 兼容旧格式：非加密存储的原样返回
    if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext;
    try {
      const key = await getKey();
      if (!key) return '';

      const raw = ciphertext.slice(ENC_PREFIX.length);
      const binaryStr = atob(raw);
      const combined = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        combined[i] = binaryStr.charCodeAt(i);
      }
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.warn('[Crypto] decrypt failed:', e);
      return '';
    }
  }

  /**
   * 加密 models 对象中所有 apiKey 字段
   * @param {Object} models - { key: { apiKey, ... }, ... }
   * @returns {Promise<Object>} 新对象，apiKey 已加密
   */
  async function encryptModels(models) {
    if (!models || typeof models !== 'object') return models;
    const encrypted = {};
    for (const key of Object.keys(models)) {
      const model = models[key];
      if (model && typeof model === 'object') {
        encrypted[key] = {
          ...model,
          apiKey: model.apiKey ? await encrypt(model.apiKey) : '',
        };
      } else {
        encrypted[key] = model;
      }
    }
    return encrypted;
  }

  /**
   * 解密 models 对象中所有 apiKey 字段
   * @param {Object} models - { key: { apiKey, ... }, ... }
   * @returns {Promise<Object>} 新对象，apiKey 已解密
   */
  async function decryptModels(models) {
    if (!models || typeof models !== 'object') return models;
    const decrypted = {};
    for (const key of Object.keys(models)) {
      const model = models[key];
      if (model && typeof model === 'object') {
        decrypted[key] = {
          ...model,
          apiKey: await decrypt(model.apiKey),
        };
      } else {
        decrypted[key] = model;
      }
    }
    return decrypted;
  }

  return {
    encrypt,
    decrypt,
    encryptModels,
    decryptModels,
    getOrCreateSeed,
  };
})();
