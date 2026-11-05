/**
 * NovaBank AI Support Agent - Chat Manager & Safe Markdown Renderer
 * Handles conversation state, streaming updates, XSS sanitization, and UI rendering
 * Enhanced with Customer Care Escalation & Phone Link Autodetection
 */

import { MODELS_CONFIG, BANK_CONTACTS } from './config.js';
import { Storage } from './storage.js';

export class ChatManager {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.containerElement
   * @param {HTMLElement} options.typingIndicatorElement
   * @param {Function} options.onRetry
   * @param {Function} [options.onRequestCallback]
   */
  constructor({ containerElement, typingIndicatorElement, onRetry, onRequestCallback }) {
    this.container = containerElement;
    this.typingIndicator = typingIndicatorElement;
    this.onRetry = onRetry;
    this.onRequestCallback = onRequestCallback;
    this.messages = [];
    this.isGenerating = false;
    this.selectedModel = Storage.getSelectedModel();

    // Attach delegated click listener once to avoid memory leaks
    if (this.container) {
      this.attachDelegatedListeners();
    }
  }

  /**
   * Delegated event listener for all actions inside chat
   */
  attachDelegatedListeners() {
    this.container.addEventListener('click', (e) => {
      // 1. Copy message
      const copyMsgBtn = e.target.closest('.copy-msg-btn');
      if (copyMsgBtn) {
        const text = decodeURIComponent(copyMsgBtn.getAttribute('data-content') || '');
        navigator.clipboard.writeText(text).then(() => {
          const original = copyMsgBtn.innerHTML;
          copyMsgBtn.innerHTML = `<span class="text-emerald-400 font-sans text-xs">Скопировано!</span>`;
          setTimeout(() => { copyMsgBtn.innerHTML = original; }, 2000);
        }).catch(() => {});
        return;
      }

      // 2. Copy code
      const copyCodeBtn = e.target.closest('.copy-code-btn');
      if (copyCodeBtn) {
        const code = decodeURIComponent(copyCodeBtn.getAttribute('data-code') || '');
        navigator.clipboard.writeText(code).then(() => {
          copyCodeBtn.innerText = 'Скопировано!';
          setTimeout(() => { copyCodeBtn.innerText = 'Копировать'; }, 2000);
        }).catch(() => {});
        return;
      }

      // 3. Retry prompt
      const retryBtn = e.target.closest('.retry-prompt-btn');
      if (retryBtn) {
        const prompt = decodeURIComponent(retryBtn.getAttribute('data-prompt') || '');
        if (this.onRetry && prompt) {
          this.onRetry(prompt);
        }
        return;
      }

      // 4. Request callback / live manager
      const callbackBtn = e.target.closest('.request-manager-callback-btn');
      if (callbackBtn) {
        if (this.onRequestCallback) {
          this.onRequestCallback();
        } else {
          window.location.href = `tel:${BANK_CONTACTS.phoneTollFreeRaw}`;
        }
        return;
      }
    });
  }

  /**
   * Initializes chat with saved history or default welcome message
   */
  init(defaultModel = 'gemini-3.6') {
    this.selectedModel = defaultModel;
    const cached = Storage.getChatMessages();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      this.messages = cached;
    } else {
      this.addWelcomeMessage();
    }
    this.render();
  }

  /**
   * Adds the initial greeting from the active model
   */
  addWelcomeMessage() {
    const config = MODELS_CONFIG[this.selectedModel] || MODELS_CONFIG['gemini-3.6'];
    const welcomeText = `Здравствуйте! Я официальный ИИ-консьерж **NovaBank**, работающий на базе интеллектуального ядра **${config.name}**.\n\nЯ помогу вам по всем финансовым вопросам:\n* **Как оформить кредит** «Nova Спринт» (ставка от 16%, одобрение за 2 мин)\n* **Как взять ипотеку** «Nova Ипотека» (семейная от 6.0%, новостройки от 12.5%)\n* **Как открыть накопительный счет** «Nova Сейф» (14% годовых с ежедневной выплатой) или срочный вклад\n* **Тарифы карт** Nova Zero (0 у.е.) и Nova Black (10% Travel)\n* **Экстренная помощь:** блокировка карт, лимиты, переводы по СБП\n\nЕсли ваш вопрос потребует участия специалиста, я моментально соединю вас с живым менеджером службы заботы (**${BANK_CONTACTS.phoneTollFree}**).\n\nКакой вопрос вас интересует?`;

    this.messages.push({
      id: 'msg-' + Date.now() + '-welcome',
      role: 'model',
      content: welcomeText,
      modelBadge: config.name,
      timestamp: this.getCurrentTimeString(),
      isError: false
    });
    this.persist();
  }

  /**
   * Appends a user message to the chat
   * @param {string} text
   * @returns {Object} Message object
   */
  addUserMessage(text) {
    const msg = {
      id: 'msg-' + Date.now() + '-u',
      role: 'user',
      content: text.trim(),
      timestamp: this.getCurrentTimeString()
    };
    this.messages.push(msg);
    this.persist();
    this.render();
    this.scrollToBottom();
    return msg;
  }

  /**
   * Appends an empty or partial AI message for streaming
   * @returns {string} Message ID
   */
  createModelPlaceholder() {
    const config = MODELS_CONFIG[this.selectedModel] || MODELS_CONFIG['gemini-3.6'];
    const msgId = 'msg-' + Date.now() + '-m';
    const msg = {
      id: msgId,
      role: 'model',
      content: '',
      modelBadge: config.name,
      timestamp: this.getCurrentTimeString(),
      isStreaming: true
    };
    this.messages.push(msg);
    this.render();
    this.scrollToBottom();
    return msgId;
  }

  /**
   * Updates streaming content in real-time
   * @param {string} msgId
   * @param {string} text
   */
  updateStreamingContent(msgId, text) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) {
      msg.content = text;
      const contentEl = this.container.querySelector(`[data-message-id="${msgId}"] .message-body`);
      if (contentEl) {
        contentEl.innerHTML = this.renderMarkdown(text);
      } else {
        this.render();
      }
      this.scrollToBottom(false);
    }
  }

  /**
   * Finalizes the streaming message
   * @param {string} msgId
   * @param {string} finalText
   */
  finalizeModelMessage(msgId, finalText) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) {
      msg.content = finalText || msg.content;
      msg.isStreaming = false;
      this.persist();
      this.render();
      this.scrollToBottom();
    }
  }

  /**
   * Inserts a system divider when model is changed
   * @param {string} newModelId
   */
  addModelSwitchDivider(newModelId) {
    this.selectedModel = newModelId;
    Storage.setSelectedModel(newModelId);
    const config = MODELS_CONFIG[newModelId] || MODELS_CONFIG['gemini-3.6'];
    
    const divider = {
      id: 'divider-' + Date.now(),
      role: 'system',
      content: `Модель переключена на **${config.name}** (${config.tag}) — ${config.role}`,
      timestamp: this.getCurrentTimeString()
    };
    this.messages.push(divider);
    this.persist();
    this.render();
    this.scrollToBottom();
  }

  /**
   * Adds an error message with contextual action buttons and human escalation
   * @param {Object} options
   */
  addErrorMessage({ text, errorType = 'general', canRetry = false, originalPrompt = '' }) {
    const errorMsg = {
      id: 'err-' + Date.now(),
      role: 'model',
      content: text,
      timestamp: this.getCurrentTimeString(),
      isError: true,
      errorType: errorType,
      canRetry: canRetry,
      originalPrompt: originalPrompt
    };
    this.messages.push(errorMsg);
    this.persist();
    this.render();
    this.scrollToBottom();
  }

  /**
   * Removes placeholder message on early error
   * @param {string} msgId
   */
  removeMessage(msgId) {
    this.messages = this.messages.filter(m => m.id !== msgId);
    this.persist();
    this.render();
  }

  /**
   * Sets typing indicator state
   * @param {boolean} isTyping
   */
  setTyping(isTyping) {
    this.isGenerating = isTyping;
    if (this.typingIndicator) {
      if (isTyping) {
        this.typingIndicator.classList.remove('hidden');
        this.typingIndicator.classList.add('flex');
      } else {
        this.typingIndicator.classList.add('hidden');
        this.typingIndicator.classList.remove('flex');
      }
    }
  }

  /**
   * Clears the entire chat history
   */
  clearChat() {
    this.messages = [];
    Storage.clearChatMessages();
    this.addWelcomeMessage();
    this.render();
  }

  /**
   * Persists message array to session storage
   */
  persist() {
    Storage.saveChatMessages(this.messages);
  }

  /**
   * Formats current time (HH:MM)
   */
  getCurrentTimeString() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Smoothly scrolls messages container to the bottom
   * @param {boolean} smooth
   */
  scrollToBottom(smooth = true) {
    if (!this.container) return;
    requestAnimationFrame(() => {
      this.container.scrollTo({
        top: this.container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    });
  }

  /**
   * Safe Markdown parser with strict HTML entity escaping (XSS Prevention)
   * Enhanced with phone numbers and tel: links support
   * @param {string} rawText
   * @returns {string} Sanitized HTML
   */
  renderMarkdown(rawText) {
    if (!rawText) return '';

    // 1. Strict XSS escape
    let safe = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // 2. Code blocks (```lang ... ```)
    safe = safe.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<div class="code-block my-3 rounded-xl overflow-hidden border border-white/[0.08] bg-[#05070D] text-xs font-mono">
        <div class="code-header flex items-center justify-between px-3.5 py-2 bg-white/[0.03] border-b border-white/[0.08] text-slate-400">
          <span class="font-bold uppercase tracking-wider text-[11px]">${lang || 'code'}</span>
          <button type="button" class="copy-code-btn hover:text-white transition-colors cursor-pointer text-[11px]" data-code="${encodeURIComponent(code.trim())}">
            Копировать
          </button>
        </div>
        <pre class="p-3.5 overflow-x-auto text-emerald-400 font-mono"><code>${code.trim()}</code></pre>
      </div>`;
    });

    // 3. Inline code (`code`)
    safe = safe.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/[0.08] text-emerald-400 font-mono text-xs border border-white/[0.05]">$1</code>');

    // 4. Tables (| col | col |)
    const tableRegex = /((?:\|.+?\|\r?\n)+)/g;
    safe = safe.replace(tableRegex, (match) => {
      const rows = match.trim().split(/\r?\n/);
      if (rows.length < 2) return match;

      let html = '<div class="overflow-x-auto my-3 rounded-xl border border-white/[0.08] bg-[#05070D]/85 shadow-md"><table class="min-w-full text-xs text-left divide-y divide-white/[0.08] font-mono-nums">';
      let isHeader = true;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i].trim();
        if (!row.startsWith('|') || !row.endsWith('|')) continue;

        if (row.replace(/[\s|:-]/g, '') === '') {
          isHeader = false;
          continue;
        }

        const cells = row.slice(1, -1).split('|').map(c => c.trim());
        if (isHeader) {
          html += '<thead class="bg-white/[0.04] text-slate-200 font-bold uppercase tracking-wider text-[11px]"><tr>';
          cells.forEach(cell => {
            html += `<th class="px-3.5 py-2.5 border-r border-white/[0.06] last:border-0">${cell}</th>`;
          });
          html += '</tr></thead><tbody class="divide-y divide-white/[0.06] text-slate-300">';
          isHeader = false;
        } else {
          html += '<tr class="hover:bg-white/[0.02] transition-colors">';
          cells.forEach(cell => {
            html += `<td class="px-3.5 py-2.5 border-r border-white/[0.06] last:border-0">${cell}</td>`;
          });
          html += '</tr>';
        }
      }
      html += '</tbody></table></div>';
      return html;
    });

    // 5. Blockquotes (> quote)
    safe = safe.replace(/^>\s+(.*)$/gm, '<blockquote class="border-l-2 border-indigo-400 pl-3.5 my-2.5 text-slate-300 italic bg-indigo-500/10 py-1.5 rounded-r">$1</blockquote>');

    // 6. Headers (###, ##, #)
    safe = safe.replace(/^### (.*$)/gm, '<h4 class="text-sm font-bold text-white mt-3.5 mb-1.5 tracking-tight">$1</h4>');
    safe = safe.replace(/^## (.*$)/gm, '<h3 class="text-base font-bold text-white mt-4.5 mb-2 tracking-tight">$1</h3>');
    safe = safe.replace(/^# (.*$)/gm, '<h2 class="text-lg font-bold text-white mt-5 mb-2.5 tracking-tight">$1</h2>');

    // 7. Bold & Italic
    safe = safe.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
    safe = safe.replace(/\*(.*?)\*/g, '<em class="text-slate-300">$1</em>');

    // 8. Bullet Lists (- or *)
    safe = safe.replace(/^[\*\-]\s+(.*)$/gm, '<li class="flex items-start gap-2.5 my-1.5 leading-relaxed"><span class="text-emerald-400 select-none font-bold">•</span><span>$1</span></li>');
    safe = safe.replace(/((?:<li class="flex items-start.*<\/li>\n?)+)/g, '<ul class="my-2.5 space-y-1">$1</ul>');

    // 9. Numbered Lists (1. item)
    safe = safe.replace(/^\d+\.\s+(.*)$/gm, '<li class="flex items-start gap-2.5 my-1.5 leading-relaxed"><span class="text-indigo-400 font-mono text-xs select-none font-bold">→</span><span>$1</span></li>');

    // 10. Phone Autolinking (e.g. 8 (800) 555-01-99 or +7 (495) 777-01-99)
    safe = safe.replace(/(8\s*\(\s*800\s*\)\s*555-01-99|\+7\s*\(\s*495\s*\)\s*777-01-99)/g, (match) => {
      const cleanPhone = match.replace(/[\s\(\)\-]/g, '');
      const tel = cleanPhone.startsWith('8') ? '+7' + cleanPhone.slice(1) : cleanPhone;
      return `<a href="tel:${tel}" class="inline-flex items-center gap-1 font-mono font-bold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 px-1 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>${match}</a>`;
    });

    // 11. Links [text](url) - supports https, http, tel, and mailto
    safe = safe.replace(/\[([^\]]+)\]\(((?:https?:\/\/|tel:|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 font-medium">$1</a>');

    // 12. Paragraphs / line breaks
    safe = safe.replace(/\n\n+/g, '</p><p class="mt-2.5">');
    safe = `<p>${safe}</p>`;
    safe = safe.replace(/<p>\s*<\/p>/g, '');

    return safe;
  }

  /**
   * Renders the complete message list to the container
   */
  render() {
    if (!this.container) return;

    if (this.messages.length === 0) {
      this.container.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
          <div class="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3 text-indigo-400">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
          </div>
          <p class="text-sm font-medium text-slate-300">Диалог пуст</p>
          <p class="text-xs text-slate-500 mt-1">Задайте вопрос по тарифам NovaBank или выберите быстрый сценарий выше.</p>
        </div>`;
      return;
    }

    const html = this.messages.map(msg => this.renderMessageHTML(msg)).join('');
    this.container.innerHTML = html;
  }

  /**
   * Generates single message HTML
   * @param {Object} msg
   * @returns {string}
   */
  renderMessageHTML(msg) {
    if (msg.role === 'system') {
      return `
        <div class="my-4 flex items-center justify-center gap-3">
          <div class="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          <div class="px-3.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11px] text-slate-400 flex items-center gap-1.5 backdrop-blur-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
            <span>${this.renderMarkdown(msg.content)}</span>
          </div>
          <div class="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
        </div>
      `;
    }

    if (msg.isError) {
      return this.renderErrorMessageHTML(msg);
    }

    const isUser = msg.role === 'user';
    const badgeColor = msg.modelBadge?.includes('3.5') ? 'emerald'
      : msg.modelBadge?.includes('3.8') ? 'purple' : 'indigo';

    const avatar = isUser ? `
      <div class="w-8 h-8 rounded-xl bg-[#131929] border border-white/[0.1] flex items-center justify-center text-slate-200 shrink-0 text-xs font-mono font-bold shadow-md">
        YOU
      </div>
    ` : `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-[#0E1526] to-[#0A0E18] border border-${badgeColor}-500/40 flex items-center justify-center text-${badgeColor}-400 shrink-0 shadow-md">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
      </div>
    `;

    const alignClass = isUser ? 'justify-end' : 'justify-start';
    const bubbleClass = isUser
      ? 'bg-gradient-to-br from-indigo-600 via-indigo-650 to-indigo-700 text-white rounded-2xl rounded-tr-sm shadow-xl shadow-indigo-950/40 border border-indigo-400/25'
      : 'bg-[#0D121F]/95 backdrop-blur-md text-slate-100 rounded-2xl rounded-tl-sm border border-white/[0.08] shadow-xl shadow-black/40';

    return `
      <div class="flex items-start gap-2.5 my-3.5 ${alignClass} message-item" data-message-id="${msg.id}">
        ${!isUser ? avatar : ''}
        <div class="max-w-[85%] sm:max-w-[80%] group flex flex-col ${isUser ? 'items-end' : 'items-start'}">
          ${!isUser && msg.modelBadge ? `
            <div class="flex items-center gap-2 mb-1 px-1">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold tracking-wide uppercase bg-${badgeColor}-500/10 border border-${badgeColor}-500/25 text-${badgeColor}-400">
                <span class="w-1.5 h-1.5 rounded-full bg-${badgeColor}-400"></span>
                ${msg.modelBadge}
              </span>
              <span class="text-[10px] text-slate-500 font-mono-nums">${msg.timestamp}</span>
            </div>
          ` : ''}

          <div class="p-3.5 sm:p-4 text-xs sm:text-sm leading-relaxed ${bubbleClass}">
            <div class="message-body">
              ${msg.content ? this.renderMarkdown(msg.content) : '<span class="inline-block animate-pulse text-slate-400 font-mono text-xs">Анализ финансовых данных...</span>'}
            </div>
          </div>

          <div class="flex items-center gap-2 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            ${isUser ? `<span class="text-[10px] text-slate-500 font-mono-nums">${msg.timestamp}</span>` : ''}
            <button type="button" class="copy-msg-btn text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 font-mono cursor-pointer" data-content="${encodeURIComponent(msg.content)}">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              <span>Копировать</span>
            </button>
          </div>
        </div>
        ${isUser ? avatar : ''}
      </div>
    `;
  }

  /**
   * Section 6 & Requirement: UI Fallbacks & Live Manager Escalation
   * Renders comprehensive escalation block with direct phone calling & callback trigger
   */
  renderErrorMessageHTML(msg) {
    let title = 'ИИ-ассистент временно недоступен';
    let borderClass = 'border-rose-500/30 bg-rose-950/20';
    let iconColor = 'text-rose-400';

    if (msg.errorType === 'rate_limit') {
      title = 'Лимит запросов Google API временно исчерпан';
      borderClass = 'border-amber-500/40 bg-amber-950/20';
      iconColor = 'text-amber-400';
    } else if (msg.errorType === 'server_overload') {
      title = 'Пиковая нагрузка на серверы Google AI';
      borderClass = 'border-amber-500/40 bg-amber-950/20';
      iconColor = 'text-amber-400';
    } else if (msg.errorType === 'key_revoked') {
      title = 'Требуется валидный API-ключ Google AI Studio';
      borderClass = 'border-rose-500/40 bg-rose-950/30';
      iconColor = 'text-rose-400';
    }

    const retryBtn = (msg.canRetry && msg.originalPrompt) ? `
      <button type="button" class="retry-prompt-btn px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors border border-white/10 flex items-center gap-1.5 cursor-pointer font-mono" data-prompt="${encodeURIComponent(msg.originalPrompt)}">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        <span>Повторить запрос</span>
      </button>
    ` : '';

    return `
      <div class="my-3.5 max-w-[95%] sm:max-w-[88%] mx-auto rounded-2xl border ${borderClass} p-4 sm:p-5 backdrop-blur-xl shadow-2xl relative overflow-hidden" data-message-id="${msg.id}">
        
        <div class="flex items-start gap-3.5">
          <div class="${iconColor} shrink-0 mt-1">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          
          <div class="flex-1">
            <h4 class="text-xs sm:text-sm font-bold ${iconColor} uppercase tracking-wider font-mono">${title}</h4>
            <p class="text-xs text-slate-300 mt-1.5 leading-relaxed">${msg.content}</p>

            <!-- Customer Care Escalation Box -->
            <div class="mt-4 p-3.5 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span class="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block font-mono">
                  Служба заботы NovaBank на связи 24/7
                </span>
                <span class="text-xs text-slate-300">
                  Соединение с реальным менеджером без очередей
                </span>
              </div>
              
              <div class="flex flex-wrap items-center gap-2">
                <a href="tel:${BANK_CONTACTS.phoneTollFreeRaw}" class="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all shadow-md flex items-center gap-1.5 font-mono">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                  <span>${BANK_CONTACTS.phoneTollFree}</span>
                </a>

                <button type="button" class="request-manager-callback-btn px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30 text-xs font-semibold transition-all cursor-pointer font-mono">
                  Заказать звонок
                </button>
              </div>
            </div>

            ${retryBtn ? `<div class="mt-3">${retryBtn}</div>` : ''}

          </div>
        </div>

      </div>
    `;
  }
}
