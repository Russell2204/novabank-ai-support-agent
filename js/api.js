/**
 * NovaBank AI Support Agent - Gemini API Client & Model Resolver
 * Direct client-side calls to Google Generative Language REST API (Zero-Backend BYOK)
 * Enhanced with Security Redaction & Timeout Protection
 */

import { SYSTEM_PROMPT_TEMPLATE, MODELS_CONFIG, API_KEY_REGEX, BANK_CONTACTS } from './config.js';

const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Redacts API keys from URLs and error logs for security
 * @param {string} text
 * @returns {string}
 */
export function redactSensitiveData(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/([?&]key=)[^&]+/gi, '$1REDACTED_API_KEY');
}

export class GeminiApiClient {
  constructor() {
    this.cachedAvailableModels = null;
    this.isDiscoveringModels = false;
  }

  /**
   * Validates API key format client-side
   * @param {string} apiKey
   * @returns {boolean}
   */
  isValidKeyFormat(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return false;
    const cleanKey = apiKey.trim();
    return cleanKey.length >= 20 && !/\s/.test(cleanKey) && API_KEY_REGEX.test(cleanKey);
  }

  /**
   * Verifies API key with a ping request to Google Gemini API
   * @param {string} apiKey
   * @returns {Promise<{ success: boolean, status: number, message?: string }>}
   */
  async pingKey(apiKey) {
    const key = (apiKey || '').trim();
    if (!this.isValidKeyFormat(key)) {
      return {
        success: false,
        status: 400,
        message: 'Неверный формат ключа. Проверьте правильность скопированного API-ключа (не менее 20 символов без пробелов).'
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const modelsResp = await fetch(`${API_BASE_URL}/models?key=${encodeURIComponent(key)}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (modelsResp.ok) {
        const data = await modelsResp.json();
        if (data && Array.isArray(data.models)) {
          this.cachedAvailableModels = data.models.map(m => m.name.replace('models/', ''));
        }
        return { success: true, status: 200 };
      }

      if (modelsResp.status === 400 || modelsResp.status === 403) {
        return {
          success: false,
          status: modelsResp.status,
          message: 'Ключ недействителен или отклонен сервером Google. Проверьте правильность копирования из Google AI Studio.'
        };
      }

      if (modelsResp.status === 429) {
        return {
          success: false,
          status: 429,
          message: 'Превышен лимит запросов Google AI Studio. Подождите немного или обратитесь на горячую линию банка.'
        };
      }

      // Minimal generateContent ping fallback using Gemini 3.5
      const pingUrl = `${API_BASE_URL}/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(key)}`;
      const pingResp = await fetch(pingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      });

      if (pingResp.ok) {
        return { success: true, status: 200 };
      }

      const errData = await pingResp.json().catch(() => ({}));
      return {
        success: false,
        status: pingResp.status,
        message: errData.error?.message || 'Ошибка валидации ключа Google API.'
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err.name === 'AbortError';
      return {
        success: false,
        status: 0,
        message: isAbort 
          ? 'Таймаут соединения с Google API (30 сек). Проверьте интернет или обратитесь к менеджеру: ' + BANK_CONTACTS.phoneTollFree
          : 'Сетевая ошибка при обращении к Google API. Проверьте интернет или VPN.'
      };
    }
  }

  /**
   * Resolves the best available Gemini model ID for the selected profile
   * @param {string} profileId - 'gemini-3.5' | 'gemini-3.6' | 'gemini-3.8'
   * @param {string} apiKey
   * @returns {Promise<string>}
   */
  async resolveModel(profileId, apiKey) {
    const config = MODELS_CONFIG[profileId] || MODELS_CONFIG['gemini-3.6'];
    const candidates = config.candidates || [];

    if (this.cachedAvailableModels && this.cachedAvailableModels.length > 0) {
      for (const candidate of candidates) {
        if (this.cachedAvailableModels.includes(candidate)) {
          return candidate;
        }
      }
      const fallback = this.cachedAvailableModels.find(m => 
        m.includes('gemini-3.6') || m.includes('gemini-3.5') || m.includes('gemini-3.8')
      );
      if (fallback) return fallback;
    }

    return candidates[0] || 'gemini-3.6-flash';
  }

  /**
   * Builds the System Instruction text for the current model
   * @param {string} profileId
   * @returns {string}
   */
  buildSystemInstruction(profileId) {
    const config = MODELS_CONFIG[profileId] || MODELS_CONFIG['gemini-3.6'];
    return SYSTEM_PROMPT_TEMPLATE
      .replace('{{SELECTED_MODEL_NAME}}', config.name)
      .replace('{{SELECTED_MODEL_ROLE}}', config.role);
  }

  /**
   * Formats chat history for Gemini API payload
   * @param {Array<{ role: string, content: string }>} messages
   * @returns {Array<{ role: string, parts: Array<{ text: string }> }>}
   */
  formatContents(messages) {
    return messages
      .filter(m => m.role === 'user' || m.role === 'model')
      .map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));
  }

  /**
   * Executes a generateContent request with automatic retry for 500/503 errors
   * Supports streaming if onChunk callback is provided
   * @param {Object} options
   * @param {string} options.apiKey
   * @param {string} options.profileId
   * @param {Array} options.messages
   * @param {Function} [options.onChunk]
   * @param {number} [options.retryCount=0]
   * @returns {Promise<string>}
   */
  async generateResponse({ apiKey, profileId, messages, onChunk = null, retryCount = 0 }) {
    const config = MODELS_CONFIG[profileId] || MODELS_CONFIG['gemini-3.6'];
    let resolvedModel = await this.resolveModel(profileId, apiKey);

    const systemText = this.buildSystemInstruction(profileId);
    const contents = this.formatContents(messages);

    const payload = {
      system_instruction: {
        parts: [{ text: systemText }]
      },
      contents: contents,
      generationConfig: {
        temperature: config.generationConfig.temperature,
        topP: config.generationConfig.topP,
        maxOutputTokens: config.generationConfig.maxOutputTokens
      }
    };

    const triedModels = new Set();
    let attemptCount = 0;
    const maxAttempts = (config.candidates && config.candidates.length) || 3;

    const tryRequest = async (useStreaming = true) => {
      attemptCount++;
      triedModels.add(resolvedModel);

      const endpoint = useStreaming ? 'streamGenerateContent' : 'generateContent';
      const queryParams = new URLSearchParams();
      if (useStreaming) queryParams.set('alt', 'sse');
      queryParams.set('key', apiKey);
      const url = `${API_BASE_URL}/models/${resolvedModel}:${endpoint}?${queryParams.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const rawMsg = errorData.error?.message || `HTTP ${response.status}`;
        const errObj = new Error(redactSensitiveData(rawMsg));
        errObj.status = response.status;
        errObj.details = errorData;

        // Model not found (404) or demand spike (503) fallback strictly within untried 3.x models
        if ((response.status === 404 || response.status === 503) && attemptCount < maxAttempts) {
          const candidates = config.candidates || [];
          const nextCandidate = candidates.find(c => !triedModels.has(c));
          if (nextCandidate) {
            console.warn(`Model ${resolvedModel} returned ${response.status}, attempting fallback to ${nextCandidate}`);
            resolvedModel = nextCandidate;
            return tryRequest(useStreaming);
          }
        }

        // Automatic retry for 500/503 (single 1.5s retry if model not exhausted)
        if ((response.status === 500 || response.status === 503) && retryCount === 0 && attemptCount === 1) {
          console.warn(`Server ${response.status} error, retrying in 1.5s...`);
          await new Promise(res => setTimeout(res, 1500));
          return this.generateResponse({ apiKey, profileId, messages, onChunk, retryCount: 1 });
        }

        throw errObj;
      }

      if (useStreaming && onChunk && response.body) {
        return this.readStreamResponse(response, onChunk);
      } else {
        const data = await response.json();
        return this.extractTextFromResponse(data);
      }
    };

    try {
      return await tryRequest(Boolean(onChunk));
    } catch (err) {
      // If streaming encountered a network break and no fatal status, try non-streaming once
      if (onChunk && err.status !== 400 && err.status !== 403 && err.status !== 429 && err.status !== 503 && err.name !== 'AbortError') {
        console.warn('Streaming failed, trying non-streaming fallback...');
        return tryRequest(false);
      }
      throw err;
    }
  }

  /**
   * Reads Server-Sent Events stream from Gemini API
   * @param {Response} response
   * @param {Function} onChunk
   * @returns {Promise<string>}
   */
  async readStreamResponse(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const jsonStr = trimmed.replace(/^data:\s*/, '');
        if (jsonStr === '[DONE]') continue;

        try {
          const chunkData = JSON.parse(jsonStr);
          const chunkText = this.extractTextFromResponse(chunkData);
          if (chunkText) {
            fullText += chunkText;
            onChunk(fullText, chunkText);
          }
        } catch {
          // Ignore partial JSON parse warnings during stream
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      try {
        const chunkData = JSON.parse(buffer.trim().replace(/^data:\s*/, ''));
        const chunkText = this.extractTextFromResponse(chunkData);
        if (chunkText) {
          fullText += chunkText;
          onChunk(fullText, chunkText);
        }
      } catch {
        // ignore
      }
    }

    return fullText;
  }

  /**
   * Safely extracts text from Gemini generateContent JSON response
   * @param {Object} data
   * @returns {string}
   */
  extractTextFromResponse(data) {
    if (!data) return '';
    try {
      const candidate = data.candidates?.[0];
      if (!candidate) {
        if (data.promptFeedback?.blockReason) {
          return `[Запрос отклонен политикой безопасности Google: ${data.promptFeedback.blockReason}. Для решения вопроса свяжитесь со службой поддержки NovaBank по телефону ${BANK_CONTACTS.phoneTollFree}]`;
        }
        return '';
      }
      const parts = candidate.content?.parts;
      if (Array.isArray(parts)) {
        return parts.map(p => p.text || '').join('');
      }
    } catch (e) {
      console.error('Error extracting text from response:', e);
    }
    return '';
  }
}

export const geminiApi = new GeminiApiClient();
