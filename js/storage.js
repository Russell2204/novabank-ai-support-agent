/**
 * NovaBank AI Support Agent - Storage Module
 * Manages BYOK credentials and session preferences
 */

import { STORAGE_KEYS } from './config.js';

export const Storage = {
  /**
   * Retrieves the stored API key from localStorage or sessionStorage
   * @returns {{ key: string | null, type: 'local' | 'session' | null }}
   */
  getApiKeyData() {
    try {
      const localKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
      if (localKey && localKey.trim()) {
        return { key: localKey.trim(), type: 'local' };
      }
      const sessionKey = sessionStorage.getItem(STORAGE_KEYS.API_KEY);
      if (sessionKey && sessionKey.trim()) {
        return { key: sessionKey.trim(), type: 'session' };
      }
    } catch (e) {
      console.warn('Storage read warning:', e);
    }
    return { key: null, type: null };
  },

  /**
   * Saves API key according to remember preference
   * @param {string} key
   * @param {boolean} remember
   */
  saveApiKey(key, remember) {
    const cleanKey = (key || '').trim();
    if (!cleanKey) return;

    try {
      if (remember) {
        localStorage.setItem(STORAGE_KEYS.API_KEY, cleanKey);
        localStorage.setItem(STORAGE_KEYS.STORAGE_TYPE, 'local');
        sessionStorage.removeItem(STORAGE_KEYS.API_KEY);
        sessionStorage.removeItem(STORAGE_KEYS.STORAGE_TYPE);
      } else {
        sessionStorage.setItem(STORAGE_KEYS.API_KEY, cleanKey);
        sessionStorage.setItem(STORAGE_KEYS.STORAGE_TYPE, 'session');
        localStorage.removeItem(STORAGE_KEYS.API_KEY);
        localStorage.removeItem(STORAGE_KEYS.STORAGE_TYPE);
      }
    } catch (e) {
      console.error('Storage write error:', e);
    }
  },

  /**
   * Completely clears credentials from both storages
   */
  clearApiKey() {
    try {
      localStorage.removeItem(STORAGE_KEYS.API_KEY);
      localStorage.removeItem(STORAGE_KEYS.STORAGE_TYPE);
      sessionStorage.removeItem(STORAGE_KEYS.API_KEY);
      sessionStorage.removeItem(STORAGE_KEYS.STORAGE_TYPE);
    } catch (e) {
      console.error('Storage clear error:', e);
    }
  },

  /**
   * Gets selected model or defaults to gemini-3.6
   */
  getSelectedModel() {
    try {
      return localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || 'gemini-3.6';
    } catch {
      return 'gemini-3.6';
    }
  },

  /**
   * Sets selected model
   */
  setSelectedModel(modelId) {
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, modelId);
    } catch (e) {
      console.warn('Could not save selected model', e);
    }
  },

  /**
   * Loads cached chat messages
   */
  getChatMessages() {
    try {
      const data = sessionStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  /**
   * Caches chat messages
   */
  saveChatMessages(messages) {
    try {
      sessionStorage.setItem(STORAGE_KEYS.CHAT_MESSAGES, JSON.stringify(messages));
    } catch (e) {
      console.warn('Could not cache messages', e);
    }
  },

  /**
   * Clears cached chat messages
   */
  clearChatMessages() {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.CHAT_MESSAGES);
    } catch (e) {
      console.warn('Could not clear messages', e);
    }
  }
};
