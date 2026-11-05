/**
 * NovaBank AI Support Agent - Application Controller
 * Connects UI events, BYOK authentication, model routing, and tariff triggers
 */

import { MODELS_CONFIG, QUICK_PROMPTS, TARIFFS } from './config.js';
import { Storage } from './storage.js';
import { geminiApi } from './api.js';
import { ChatManager } from './chat.js';

// Application Global State (Technical Specification 4.1)
const appState = {
  apiKey: null,
  storageType: null,
  isKeyValidated: false,
  isValidating: false,
  selectedModel: 'gemini-3.6',
  isGenerating: false
};

let chatManager = null;

// DOM Element References
const elements = {
  // Nav
  navStatusBadge: document.getElementById('nav-status-badge'),
  navStatusDot: document.getElementById('nav-status-dot'),
  navStatusText: document.getElementById('nav-status-text'),
  resetKeyBtn: document.getElementById('reset-key-btn'),

  // BYOK Modal
  byokGateModal: document.getElementById('byok-gate-modal'),
  byokForm: document.getElementById('byok-form'),
  byokInputKey: document.getElementById('byok-input-key'),
  byokRememberCheckbox: document.getElementById('byok-remember-checkbox'),
  byokErrorMsg: document.getElementById('byok-error-msg'),
  byokSubmitBtn: document.getElementById('byok-submit-btn'),
  byokBtnText: document.getElementById('byok-btn-text'),
  byokBtnSpinner: document.getElementById('byok-btn-spinner'),
  toggleKeyVisibility: document.getElementById('toggle-key-visibility'),

  // Chat
  chatMessages: document.getElementById('chat-messages'),
  typingIndicator: document.getElementById('typing-indicator'),
  clearChatBtn: document.getElementById('clear-chat-btn'),
  segmentTabs: document.querySelectorAll('.segment-tab'),
  quickPromptsContainer: document.getElementById('quick-prompts-container'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  sendBtnIcon: document.getElementById('send-btn-icon'),
  sendBtnSpinner: document.getElementById('send-btn-spinner'),

  // Sections
  heroScenarioBtns: document.querySelectorAll('.hero-scenario-btn'),
  selectModelBtns: document.querySelectorAll('.select-model-btn'),
  tariffsCardsContainer: document.getElementById('tariffs-cards-container'),
  toastContainer: document.getElementById('toast-container'),

  // Human Escalation Callback Modal
  callbackModal: document.getElementById('callback-modal'),
  callbackForm: document.getElementById('callback-form'),
  callbackCloseBtn: document.getElementById('callback-close-btn'),
  callbackCancelBtn: document.getElementById('callback-cancel-btn'),
  openCallbackModalBtn: document.getElementById('open-callback-modal-btn'),
  callbackTopicSelect: document.getElementById('callback-topic'),
  callbackNameInput: document.getElementById('callback-name'),
  callbackPhoneInput: document.getElementById('callback-phone'),
  callbackCommentInput: document.getElementById('callback-comment')
};

/**
 * Toast Notification System
 */
function showToast(message, type = 'info', duration = 3500) {
  if (!elements.toastContainer) return;

  const toast = document.createElement('div');
  const colors = {
    info: 'border-indigo-500/40 bg-slate-900/90 text-indigo-200',
    success: 'border-emerald-500/40 bg-slate-900/90 text-emerald-200',
    warning: 'border-amber-500/40 bg-slate-900/90 text-amber-200',
    error: 'border-rose-500/40 bg-slate-900/90 text-rose-200'
  };

  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌'
  };

  toast.className = `p-3.5 rounded-xl border backdrop-blur-md shadow-2xl text-xs sm:text-sm flex items-start gap-2.5 transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span class="text-sm shrink-0">${icons[type] || 'ℹ️'}</span>
    <span class="flex-1 leading-snug">${message}</span>
  `;

  elements.toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  // Auto remove
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

/**
 * Updates Header Status UI
 */
function updateHeaderStatus(isValid) {
  if (isValid) {
    elements.navStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    elements.navStatusText.textContent = '🟢 Агент активен';
    elements.navStatusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium backdrop-blur-md text-emerald-300';
    elements.resetKeyBtn.classList.remove('hidden');
  } else {
    elements.navStatusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    elements.navStatusText.textContent = 'Ключ не подключен';
    elements.navStatusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-white/10 text-xs font-medium backdrop-blur-md text-slate-300';
    elements.resetKeyBtn.classList.add('hidden');
  }
}

/**
 * Updates Segmented Control UI for active model
 */
function updateSegmentTabsUI(modelId) {
  elements.segmentTabs.forEach(tab => {
    const tabModel = tab.getAttribute('data-model');
    tab.classList.remove('active-emerald', 'active-indigo', 'active-purple', 'bg-white/10', 'text-white');

    if (tabModel === modelId) {
      if (modelId === 'gemini-3.5') tab.classList.add('active-emerald');
      else if (modelId === 'gemini-3.8') tab.classList.add('active-purple');
      else tab.classList.add('active-indigo');
    }
  });
}

/**
 * Handles switching models with divider in chat
 */
function handleSwitchModel(newModelId, showNotice = true) {
  if (!MODELS_CONFIG[newModelId]) return;

  const previousModel = appState.selectedModel;
  appState.selectedModel = newModelId;
  updateSegmentTabsUI(newModelId);

  if (chatManager) {
    if (showNotice && previousModel !== newModelId) {
      chatManager.addModelSwitchDivider(newModelId);
    }
  }

  showToast(`Активна модель: ${MODELS_CONFIG[newModelId].name} (${MODELS_CONFIG[newModelId].tag})`, 'info', 2500);
}

/**
 * Renders Quick Prompts chips with financial micro-icons
 */
function renderQuickPrompts() {
  if (!elements.quickPromptsContainer) return;
  elements.quickPromptsContainer.innerHTML = QUICK_PROMPTS.map(qp => `
    <button type="button" class="prompt-chip px-3 py-1 rounded-lg text-xs text-slate-300 font-medium shrink-0 flex items-center gap-1.5 cursor-pointer font-mono" data-prompt="${encodeURIComponent(qp.prompt)}">
      <span class="text-indigo-400 text-[10px]">↳</span>
      <span>${qp.title}</span>
    </button>
  `).join('');

  elements.quickPromptsContainer.querySelectorAll('.prompt-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = decodeURIComponent(btn.getAttribute('data-prompt') || '');
      submitUserPrompt(prompt);
    });
  });
}

/**
 * Renders Tariff cards with physical debit card mockup visuals
 */
function renderTariffs() {
  if (!elements.tariffsCardsContainer) return;

  const bgClasses = {
    'nova-zero': 'card-zero-bg',
    'nova-black': 'card-black-bg',
    'nova-safe': 'card-safe-bg',
    'nova-sprint': 'card-sprint-bg',
    'nova-mortgage': 'card-mortgage-bg'
  };

  elements.tariffsCardsContainer.innerHTML = TARIFFS.map(t => {
    const color = t.badgeColor || 'indigo';
    const cardBg = bgClasses[t.id] || 'card-zero-bg';

    return `
      <div class="vault-card rounded-2xl p-5 border border-white/[0.08] flex flex-col justify-between group">
        <div>
          <!-- Miniature Physical Card Simulation -->
          <div class="debit-card-visual ${cardBg} mb-5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-mono font-bold tracking-wider uppercase text-white/90">NovaBank</span>
              <div class="flex items-center gap-1">
                <span class="w-4 h-4 rounded-full bg-white/20 inline-block -mr-2"></span>
                <span class="w-4 h-4 rounded-full bg-white/30 inline-block"></span>
              </div>
            </div>

            <div class="card-chip my-2"></div>

            <div class="flex items-end justify-between">
              <div>
                <span class="text-[9px] uppercase font-mono tracking-widest text-slate-400 block">${t.type}</span>
                <span class="text-sm font-extrabold text-white font-mono tracking-wide">${t.name}</span>
              </div>
              <span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white/10 text-white backdrop-blur-sm">
                ${t.price.split('/')[0]}
              </span>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-[11px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-${color}-500/15 border border-${color}-500/30 text-${color}-400">
              ${t.badge}
            </span>
            <span class="text-[11px] text-slate-400 font-medium">${t.type}</span>
          </div>

          <h3 class="text-lg font-bold text-white tracking-tight">${t.name}</h3>
          
          <div class="mt-1 mb-4">
            <span class="text-xl font-extrabold text-white font-mono-nums">${t.price}</span>
            ${t.priceSubtitle ? `<span class="block text-[11px] text-slate-400 mt-0.5 font-normal">${t.priceSubtitle}</span>` : ''}
          </div>

          <ul class="space-y-2 text-xs text-slate-300 mb-6">
            ${t.features.map(f => `
              <li class="flex items-start gap-2">
                <span class="text-emerald-400 select-none font-bold">✓</span>
                <span class="leading-snug">${f}</span>
              </li>
            `).join('')}
          </ul>
        </div>

        <button 
          type="button" 
          class="tariff-inquiry-btn w-full py-2.5 px-3 rounded-xl bg-white/[0.04] hover:bg-indigo-600/20 text-slate-200 hover:text-white border border-white/[0.08] hover:border-indigo-500/40 text-xs font-semibold font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
          data-prompt="${encodeURIComponent(t.recommendedPrompt)}"
        >
          <span>Спросить об этом в чате</span>
          <span class="group-hover:translate-x-1 transition-transform">→</span>
        </button>
      </div>
    `;
  }).join('');

  // Attach button triggers
  elements.tariffsCardsContainer.querySelectorAll('.tariff-inquiry-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = decodeURIComponent(btn.getAttribute('data-prompt') || '');
      scrollToChat();
      submitUserPrompt(prompt);
    });
  });
}

/**
 * Smooth scroll to chat container
 */
function scrollToChat() {
  const chatEl = document.getElementById('chat');
  if (chatEl) {
    chatEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Main prompt submission routine
 */
async function submitUserPrompt(text) {
  const prompt = (text || elements.chatInput.value || '').trim();
  if (!prompt) return;

  // Gate check: BYOK required
  if (!appState.isKeyValidated || !appState.apiKey) {
    showToast('Пожалуйста, подключите API-ключ Google AI Studio для начала работы', 'warning');
    elements.byokGateModal.classList.remove('hidden');
    elements.byokInputKey.focus();
    scrollToChat();
    return;
  }

  if (appState.isGenerating) return;

  // Clear input & reset textarea height
  elements.chatInput.value = '';
  elements.chatInput.style.height = 'auto';

  // Add user message to UI
  chatManager.addUserMessage(prompt);

  // Set loading state
  appState.isGenerating = true;
  elements.sendBtn.disabled = true;
  elements.sendBtnIcon.classList.add('hidden');
  elements.sendBtnSpinner.classList.remove('hidden');
  chatManager.setTyping(true);

  // Create model placeholder for streaming
  const modelMsgId = chatManager.createModelPlaceholder();
  let receivedText = '';

  try {
    const finalResponse = await geminiApi.generateResponse({
      apiKey: appState.apiKey,
      profileId: appState.selectedModel,
      messages: chatManager.messages.filter(m => !m.isStreaming && !m.isError),
      onChunk: (accumulated) => {
        receivedText = accumulated;
        chatManager.updateStreamingContent(modelMsgId, accumulated);
      }
    });

    chatManager.finalizeModelMessage(modelMsgId, finalResponse || receivedText);

  } catch (error) {
    console.error('Chat generation error:', error);
    chatManager.removeMessage(modelMsgId);

    // Section 6: UI Fallbacks for Edge Cases
    if (error.status === 400 || error.status === 403) {
      // Key rejected by Google server
      appState.isKeyValidated = false;
      Storage.clearApiKey();
      updateHeaderStatus(false);
      elements.byokGateModal.classList.remove('hidden');
      elements.byokErrorMsg.textContent = 'Ключ отклонен сервером Google. Проверьте ключ или создайте новый в Google AI Studio.';
      elements.byokErrorMsg.classList.remove('hidden');
      showToast('Ключ отклонен сервером Google. Проверьте ключ или создайте новый.', 'error', 5000);

    } else if (error.status === 429) {
      // Free tier rate limit
      chatManager.addErrorMessage({
        text: 'Лимит запросов Google AI Studio временно исчерпан (код 429). Подождите 30–60 секунд или свяжитесь с дежурным менеджером NovaBank.',
        errorType: 'rate_limit',
        canRetry: true,
        originalPrompt: prompt
      });
      showToast('Превышен лимит запросов Google API. Соединяем со службой заботы.', 'warning', 4000);

    } else if (error.status === 503) {
      // High demand spike on Google servers
      chatManager.addErrorMessage({
        text: 'Серверы искусственного интеллекта Google временно испытывают пиковую нагрузку (код 503). Наш дежурный менеджер готов ответить на ваш вопрос прямо сейчас:',
        errorType: 'server_overload',
        canRetry: true,
        originalPrompt: prompt
      });
      showToast('Серверы Google временно перегружены. Соединяем со службой заботы NovaBank.', 'warning', 5000);

    } else {
      // General server / network error / timeout
      const isTimeout = error.name === 'AbortError' || (error.message && error.message.includes('aborted'));
      chatManager.addErrorMessage({
        text: isTimeout 
          ? 'Превышено время ожидания ответа от Google API (таймаут). Пожалуйста, свяжитесь с дежурным специалистом NovaBank:'
          : (error.message || 'Ошибка соединения с сервером Google Gemini API. Служба заботы NovaBank на связи 24/7:'),
        errorType: 'server_error',
        canRetry: true,
        originalPrompt: prompt
      });
      showToast('Сбой соединения с Google API. Нажмите для связи со специалистом.', 'error', 4500);
    }

  } finally {
    appState.isGenerating = false;
    elements.sendBtn.disabled = false;
    elements.sendBtnIcon.classList.remove('hidden');
    elements.sendBtnSpinner.classList.add('hidden');
    chatManager.setTyping(false);
  }
}

/**
 * BYOK Gate Form Submission Handler
 */
async function handleByokSubmit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (!elements.byokInputKey) return;
  const rawValue = elements.byokInputKey.value || '';
  const inputKey = rawValue.replace(/[\r\n\t\s]/g, '').trim();

  // Reset errors
  if (elements.byokErrorMsg) {
    elements.byokErrorMsg.classList.add('hidden');
    elements.byokErrorMsg.textContent = '';
  }

  // 1. Client-side format validation
  if (!geminiApi.isValidKeyFormat(inputKey)) {
    if (elements.byokErrorMsg) {
      elements.byokErrorMsg.textContent = 'Ключ недействителен. Убедитесь, что ключ скопирован полностью (не менее 20 символов без пробелов).';
      elements.byokErrorMsg.classList.remove('hidden');
    }
    return;
  }

  // 2. Network ping validation
  if (elements.byokSubmitBtn) elements.byokSubmitBtn.disabled = true;
  if (elements.byokBtnText) elements.byokBtnText.textContent = 'Проверка ключа в Google API...';
  if (elements.byokBtnSpinner) elements.byokBtnSpinner.classList.remove('hidden');

  try {
    const pingResult = await geminiApi.pingKey(inputKey);

    if (pingResult.success) {
      // Save key based on remember checkbox
      const remember = elements.byokRememberCheckbox ? elements.byokRememberCheckbox.checked : true;
      Storage.saveApiKey(inputKey, remember);

      appState.apiKey = inputKey;
      appState.isKeyValidated = true;

      // Update UI
      updateHeaderStatus(true);
      if (elements.byokGateModal) elements.byokGateModal.classList.add('hidden');

      showToast('API-ключ успешно подключен! ИИ-консьерж готов к работе.', 'success');

      // Focus input
      setTimeout(() => {
        if (elements.chatInput) elements.chatInput.focus();
      }, 300);

    } else {
      if (elements.byokErrorMsg) {
        elements.byokErrorMsg.textContent = pingResult.message || 'Ключ недействителен. Проверьте правильность копирования из Google AI Studio.';
        elements.byokErrorMsg.classList.remove('hidden');
      }
    }

  } catch (err) {
    if (elements.byokErrorMsg) {
      elements.byokErrorMsg.textContent = 'Ошибка валидации ключа. Проверьте соединение с интернетом.';
      elements.byokErrorMsg.classList.remove('hidden');
    }

  } finally {
    if (elements.byokSubmitBtn) elements.byokSubmitBtn.disabled = false;
    if (elements.byokBtnText) elements.byokBtnText.textContent = 'Активировать ИИ-агента';
    if (elements.byokBtnSpinner) elements.byokBtnSpinner.classList.add('hidden');
  }
}

/**
 * Reset API Key Action
 */
function handleResetKey() {
  const confirmed = window.confirm('Вы действительно хотите удалить сохраненный API-ключ Google AI Studio из памяти этого браузера?');
  if (!confirmed) return;

  Storage.clearApiKey();
  appState.apiKey = null;
  appState.isKeyValidated = false;

  updateHeaderStatus(false);
  if (elements.byokInputKey) elements.byokInputKey.value = '';
  if (elements.byokErrorMsg) elements.byokErrorMsg.classList.add('hidden');
  if (elements.byokGateModal) elements.byokGateModal.classList.remove('hidden');

  showToast('API-ключ удален из памяти браузера.', 'info');
}

/**
 * Human Specialist Callback Modal Controller
 */
function openCallbackModal(topic = '') {
  if (!elements.callbackModal) elements.callbackModal = document.getElementById('callback-modal');
  if (!elements.callbackTopicSelect) elements.callbackTopicSelect = document.getElementById('callback-topic');
  if (!elements.callbackNameInput) elements.callbackNameInput = document.getElementById('callback-name');
  if (!elements.callbackModal) return;

  if (topic && elements.callbackTopicSelect) {
    const options = Array.from(elements.callbackTopicSelect.options);
    const matched = options.find(opt => opt.value === topic || opt.text.toLowerCase().includes(topic.toLowerCase()));
    if (matched) {
      elements.callbackTopicSelect.value = matched.value;
    }
  }

  elements.callbackModal.classList.remove('hidden');
  setTimeout(() => {
    if (elements.callbackNameInput) elements.callbackNameInput.focus();
  }, 100);
}

function closeCallbackModal() {
  if (!elements.callbackModal) elements.callbackModal = document.getElementById('callback-modal');
  if (elements.callbackModal) {
    elements.callbackModal.classList.add('hidden');
  }
}

function handleCallbackSubmit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (!elements.callbackPhoneInput) elements.callbackPhoneInput = document.getElementById('callback-phone');
  if (!elements.callbackNameInput) elements.callbackNameInput = document.getElementById('callback-name');
  if (!elements.callbackForm) elements.callbackForm = document.getElementById('callback-form');

  const phone = elements.callbackPhoneInput ? elements.callbackPhoneInput.value.trim() : '';
  const digitsOnly = phone.replace(/\D/g, '');

  if (digitsOnly.length < 7) {
    showToast('Пожалуйста, укажите контактный телефон для связи со специалистом.', 'warning');
    if (elements.callbackPhoneInput) elements.callbackPhoneInput.focus();
    return;
  }

  if (elements.callbackForm) elements.callbackForm.reset();
  closeCallbackModal();

  showToast(`Заявка принята! Дежурный менеджер NovaBank свяжется с вами по номеру ${phone} в течение 5 минут. Горячая линия: 8 (800) 555-01-99`, 'success', 6000);
}

/**
 * Application Entry Point Initialization
 */
function initApp() {
  // Re-verify DOM elements
  elements.byokForm = document.getElementById('byok-form');
  elements.byokInputKey = document.getElementById('byok-input-key');
  elements.byokSubmitBtn = document.getElementById('byok-submit-btn');
  elements.byokGateModal = document.getElementById('byok-gate-modal');
  elements.byokErrorMsg = document.getElementById('byok-error-msg');
  elements.byokRememberCheckbox = document.getElementById('byok-remember-checkbox');

  // Human Escalation Modal Elements
  elements.callbackModal = document.getElementById('callback-modal');
  elements.callbackForm = document.getElementById('callback-form');
  elements.callbackCloseBtn = document.getElementById('callback-close-btn');
  elements.callbackCancelBtn = document.getElementById('callback-cancel-btn');
  elements.openCallbackModalBtn = document.getElementById('open-callback-modal-btn');
  elements.callbackTopicSelect = document.getElementById('callback-topic');
  elements.callbackNameInput = document.getElementById('callback-name');
  elements.callbackPhoneInput = document.getElementById('callback-phone');
  elements.callbackCommentInput = document.getElementById('callback-comment');

  // 1. Initialize Chat Manager
  chatManager = new ChatManager({
    containerElement: elements.chatMessages,
    typingIndicatorElement: elements.typingIndicator,
    onRetry: (prompt) => submitUserPrompt(prompt),
    onRequestCallback: (topic) => openCallbackModal(topic)
  });

  // 2. Load stored model & update tabs
  appState.selectedModel = Storage.getSelectedModel();
  updateSegmentTabsUI(appState.selectedModel);
  chatManager.init(appState.selectedModel);

  // 3. Check for existing API Key (Section 4.2)
  const keyData = Storage.getApiKeyData();
  if (keyData.key) {
    appState.apiKey = keyData.key;
    appState.storageType = keyData.type;
    appState.isKeyValidated = true;

    if (elements.byokGateModal) elements.byokGateModal.classList.add('hidden');
    updateHeaderStatus(true);
  } else {
    if (elements.byokGateModal) elements.byokGateModal.classList.remove('hidden');
    updateHeaderStatus(false);
  }

  // 4. Render components
  renderQuickPrompts();
  renderTariffs();

  // 5. Setup Event Listeners

  // BYOK Form, Keydown & Paste handlers
  if (elements.byokForm) {
    elements.byokForm.addEventListener('submit', handleByokSubmit);
  }
  if (elements.byokSubmitBtn) {
    elements.byokSubmitBtn.addEventListener('click', handleByokSubmit);
  }
  if (elements.byokInputKey) {
    elements.byokInputKey.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleByokSubmit(e);
      }
    });
    // Sanitize pasted text immediately and prevent accidental newline submission
    elements.byokInputKey.addEventListener('paste', (e) => {
      setTimeout(() => {
        if (elements.byokInputKey) {
          elements.byokInputKey.value = (elements.byokInputKey.value || '').replace(/[\r\n\t\s]/g, '').trim();
        }
      }, 0);
    });
  }

  if (elements.toggleKeyVisibility && elements.byokInputKey) {
    elements.toggleKeyVisibility.addEventListener('click', () => {
      const isPassword = elements.byokInputKey.type === 'password';
      elements.byokInputKey.type = isPassword ? 'text' : 'password';
      elements.toggleKeyVisibility.textContent = isPassword ? '🔒' : '👁️';
    });
  }

  // Reset Key Button
  if (elements.resetKeyBtn) {
    elements.resetKeyBtn.addEventListener('click', handleResetKey);
  }

  // Chat Form Submit
  if (elements.chatForm) {
    elements.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitUserPrompt();
    });
  }

  // Textarea Enter key & Auto-resize
  if (elements.chatInput) {
    elements.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitUserPrompt();
      }
    });

    elements.chatInput.addEventListener('input', () => {
      elements.chatInput.style.height = 'auto';
      elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 128) + 'px';
    });
  }

  // Clear Chat Button
  if (elements.clearChatBtn) {
    elements.clearChatBtn.addEventListener('click', () => {
      if (window.confirm('Очистить историю диалога?')) {
        chatManager.clearChat();
        showToast('История диалога очищена.', 'info');
      }
    });
  }

  // Model Segment Tabs
  elements.segmentTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const modelId = tab.getAttribute('data-model');
      handleSwitchModel(modelId, true);
    });
  });

  // Model Comparison Section Buttons
  elements.selectModelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const modelId = btn.getAttribute('data-model');
      handleSwitchModel(modelId, true);
      scrollToChat();
    });
  });

  // Hero Quick Scenarios
  elements.heroScenarioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      scrollToChat();
      submitUserPrompt(prompt);
    });
  });

  // Human Specialist Callback Modal Listeners
  if (elements.openCallbackModalBtn) {
    elements.openCallbackModalBtn.addEventListener('click', () => openCallbackModal());
  }
  if (elements.callbackCloseBtn) {
    elements.callbackCloseBtn.addEventListener('click', closeCallbackModal);
  }
  if (elements.callbackCancelBtn) {
    elements.callbackCancelBtn.addEventListener('click', closeCallbackModal);
  }
  if (elements.callbackForm) {
    elements.callbackForm.addEventListener('submit', handleCallbackSubmit);
  }
  if (elements.callbackModal) {
    elements.callbackModal.addEventListener('click', (e) => {
      if (e.target === elements.callbackModal) {
        closeCallbackModal();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.callbackModal && !elements.callbackModal.classList.contains('hidden')) {
      closeCallbackModal();
    }
  });
}

// Start application safely
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
