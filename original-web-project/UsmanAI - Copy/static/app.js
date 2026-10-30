(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const GUEST_CHATS_KEY = 'usmanai_guest_chats_v1';
  const GUEST_PROFILE_KEY = 'usmanai_guest_profile_v1';
  const THEME_KEY = 'usmanai_theme_v1';

  let currentUser = null;
  let chats = [];
  let activeChatId = null;
  let activeMessages = [];
  let activeChatTitle = 'New chat';
  let isGenerating = false;
  let currentMode = 'demo';
  let authTab = 'login';
  let toastTimeout = null;
  let installPrompt = null;

  const icon = (name) => {
    const icons = {
      chat: '<svg class="chat-item-icon" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg>',
      more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
      copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
      download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>',
    };
    return icons[name] || '';
  };

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : {};
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function guestProfile() {
    try {
      return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) || '{}');
    } catch (_) { return {}; }
  }

  function saveGuestProfile(profile) {
    localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(profile));
  }

  function readGuestChats() {
    try {
      const value = JSON.parse(localStorage.getItem(GUEST_CHATS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(c => c && typeof c === 'object') : [];
    } catch (_) { return []; }
  }

  function saveGuestChats() {
    if (currentUser) return;
    localStorage.setItem(GUEST_CHATS_KEY, JSON.stringify(chats.slice(0, 100)));
  }

  function localTimestamp() { return new Date().toISOString(); }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inlineMarkdown(value) {
    let out = value;
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out;
  }

  // Render a safe, intentionally small Markdown subset. Raw HTML is escaped first.
  function renderMarkdown(markdown) {
    const lines = escapeHtml(markdown).replace(/\r/g, '').split('\n');
    const out = [];
    let paragraph = [];
    let listType = null;
    let codeLines = [];
    let inCode = false;
    const flushParagraph = () => {
      if (paragraph.length) { out.push(`<p>${inlineMarkdown(paragraph.join('<br>'))}</p>`); paragraph = []; }
    };
    const flushList = () => {
      if (listType) { out.push(`</${listType}>`); listType = null; }
    };
    for (const line of lines) {
      if (/^```/.test(line)) {
        flushParagraph(); flushList();
        if (inCode) { out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`); codeLines = []; inCode = false; }
        else inCode = true;
        continue;
      }
      if (inCode) { codeLines.push(line); continue; }
      if (!line.trim()) { flushParagraph(); flushList(); continue; }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) { flushParagraph(); flushList(); const level = heading[1].length; out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
      if (/^&gt;\s?/.test(line)) { flushParagraph(); flushList(); out.push(`<blockquote>${inlineMarkdown(line.replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
      const ul = line.match(/^\s*[-*]\s+(.+)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ul || ol) {
        flushParagraph();
        const desired = ul ? 'ul' : 'ol';
        if (listType !== desired) { flushList(); listType = desired; out.push(`<${listType}>`); }
        out.push(`<li>${inlineMarkdown((ul || ol)[1])}</li>`);
        continue;
      }
      flushList(); paragraph.push(line);
    }
    flushParagraph(); flushList();
    if (inCode) out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
    return out.join('') || '<p></p>';
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function initials(name) {
    const words = String(name || 'Guest student').trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'G').slice(0, 1)).toUpperCase();
  }

  function getProfile() {
    return currentUser || { name: guestProfile().name || 'Guest student', email: '', grade: guestProfile().grade || '', campus: guestProfile().campus || '', preferences: guestProfile().preferences || {} };
  }

  function syncProfileUi() {
    const profile = getProfile();
    $('#sidebarName').textContent = profile.name || 'Guest student';
    $('#sidebarEmail').textContent = currentUser ? currentUser.email : 'Local profile · this device';
    $('#sidebarAvatar').textContent = initials(profile.name);
    $('#topAvatar').textContent = initials(profile.name);
    $('#topAccountLabel').textContent = currentUser ? (profile.name || 'Account') : 'Sign in';
  }

  function setTheme(theme, persist = true) {
    const safe = theme === 'dark' ? 'dark' : 'light';
    document.body.dataset.theme = safe;
    $('#themeToggle').innerHTML = safe === 'dark'
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z"/></svg>';
    if (persist) {
      localStorage.setItem(THEME_KEY, safe);
      const profile = getProfile();
      profile.preferences = { ...(profile.preferences || {}), theme: safe };
      if (currentUser) {
        api('/api/profile', { method: 'PATCH', body: JSON.stringify({ preferences: { theme: safe } }) })
          .then(data => { currentUser = data.user; }).catch(() => { });
      } else {
        saveGuestProfile({ ...guestProfile(), preferences: { ...(guestProfile().preferences || {}), theme: safe } });
      }
    }
    $$('.theme-option').forEach(button => button.classList.toggle('active', button.dataset.theme === safe));
  }

  function updateMode(mode) {
    currentMode = mode || 'demo';
    const pill = $('#modePill');
    pill.classList.toggle('live', currentMode === 'ai');
    $('#modeText').textContent = currentMode === 'ai' ? 'AI connected' : 'Demo mode';
  }

  function sortChats() {
    chats.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  function renderHistory() {
    const container = $('#chatHistory');
    const term = $('#searchChats').value.trim().toLowerCase();
    const visible = chats.filter(chat => String(chat.title || 'New chat').toLowerCase().includes(term));
    container.innerHTML = '';
    if (!visible.length) {
      const blank = document.createElement('div');
      blank.className = 'history-empty';
      blank.textContent = term ? 'No conversations match that search.' : 'Your conversations will appear here.';
      container.appendChild(blank);
      return;
    }
    for (const chat of visible) {
      const item = document.createElement('div');
      item.className = 'chat-item' +
        (String(chat.id) === String(activeChatId) ? ' active' : '');
      item.title = chat.title || 'New chat';

      item.appendChild(
        document.createRange().createContextualFragment(icon('chat'))
      );

      const title = document.createElement('span');
      title.className = 'chat-item-title';
      title.textContent = chat.title || 'New chat';
      item.appendChild(title);

      // Rename button
      const menu = document.createElement('button');
      menu.className = 'chat-menu-button';
      menu.type = 'button';
      menu.title = 'Chat options';
      menu.setAttribute('aria-label', 'Chat options');
      menu.innerHTML = icon('more');

      menu.addEventListener('click', (event) => {
        event.stopPropagation();
        openChatOptions(chat);
      });

      item.appendChild(menu);

      // Delete button
      const del = document.createElement('button');
      del.className = 'chat-menu-button chat-delete-button';
      del.type = 'button';
      del.title = 'Delete chat';
      del.setAttribute('aria-label', 'Delete chat');
      del.textContent = '🗑';

      del.addEventListener('click', async (event) => {
        event.stopPropagation();

        if (!window.confirm(`Delete "${chat.title || 'New chat'}"? This cannot be undone.`)) {
          return;
        }

        try {
          if (currentUser) {
            await api(`/api/chats/${encodeURIComponent(chat.id)}`, {
              method: 'DELETE'
            });
          } else {
            chats = chats.filter(
              c => String(c.id) !== String(chat.id)
            );

            if (typeof saveGuestChats === 'function') {
              saveGuestChats();
            } else {
              localStorage.setItem('usmanai_chats', JSON.stringify(chats));
            }
          }

          if (String(activeChatId) === String(chat.id)) {
            activeChatId = null;
            activeMessages = [];
            activeChatTitle = 'New chat';
            renderMessages();
          }

          await refreshChats();

          if (typeof showToast === 'function') {
            showToast('Chat deleted successfully.');
          }
        } catch (error) {
          alert(error.message || 'Could not delete chat.');
        }
      });

      item.appendChild(del);

      item.addEventListener('click', () => openChat(chat.id));
      container.appendChild(item);
    }
  }

  function setWelcomeVisible(visible) {
    $('#welcomeScreen').hidden = !visible;
    $('#messages').hidden = visible;
  }

  

function animateAssistantText(element, text, speed = 12) {
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  if (reducedMotion || text.length < 2) {
    element.innerHTML = renderMarkdown(text);
    return;
  }

  let position = 0;
  const chunkSize = 2;
  let timerId;

  element.classList.add('message-streaming');
  element.innerHTML = '<p></p>';

  const paragraph = element.querySelector('p');
  const interval = Math.max(8, speed);

  function revealNextChunk() {
    position = Math.min(position + chunkSize, text.length);

    // Reveal text progressively without rebuilding Markdown each time.
    paragraph.textContent = text.slice(0, position);

    if (position < text.length) {
      timerId = window.setTimeout(revealNextChunk, interval);
    } else {
      element.classList.remove('message-streaming');

      // Restore proper headings, lists, links and code formatting.
      element.innerHTML = renderMarkdown(text);
    }
  }

  revealNextChunk();
  }



  function renderMessages(showTyping = false) {
    const root = $('#messages');
    root.innerHTML = '';
    for (let i = 0; i < activeMessages.length; i++) {
      const message = activeMessages[i];
      const row = document.createElement('article');
      row.className = `message-row ${message.role === 'user' ? 'user' : 'assistant'}`;
      const avatar = document.createElement('div'); avatar.className = 'message-avatar';
      if (message.role === 'user') avatar.textContent = initials(getProfile().name);
      else { const img = document.createElement('img'); img.src = '/static/assets/upss-logo.svg'; img.alt = 'UsmanAI'; avatar.appendChild(img); }
      const content = document.createElement('div'); content.className = 'message-content';
      const author = document.createElement('div'); author.className = 'message-author'; author.textContent = message.role === 'user' ? (getProfile().name || 'You') : 'UsmanAI';
      
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';

      const messageText = message.content || '';

      if (message.role === 'assistant' && message.animate === true) {
        animateAssistantText(bubble, messageText);
      } else {
        bubble.innerHTML = renderMarkdown(messageText);
      }

      content.appendChild(author); content.appendChild(bubble);
      if (message.role === 'assistant') {
        const actions = document.createElement('div'); actions.className = 'message-actions';
        const copy = document.createElement('button'); copy.className = 'message-action'; copy.type = 'button'; copy.innerHTML = icon('copy') + '<span>Copy</span>';
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(message.content); showToast('Answer copied to clipboard.'); } catch (_) { showToast('Clipboard access is not available in this browser.'); } });
        actions.appendChild(copy); content.appendChild(actions);
      }
      row.appendChild(avatar); row.appendChild(content); root.appendChild(row);
    }
    if (showTyping) {
      const row = document.createElement('article'); row.className = 'message-row assistant';
      const avatar = document.createElement('div'); avatar.className = 'message-avatar';
      const img = document.createElement('img'); img.src = '/static/assets/upss-logo.svg'; img.alt = 'UsmanAI'; avatar.appendChild(img);
      const content = document.createElement('div'); content.className = 'message-content';
      const author = document.createElement('div'); author.className = 'message-author'; author.textContent = 'UsmanAI is thinking';
      const bubble = document.createElement('div'); bubble.className = 'typing-dots'; bubble.innerHTML = '<span></span><span></span><span></span>';
      content.appendChild(author); content.appendChild(bubble); row.appendChild(avatar); row.appendChild(content); root.appendChild(row);
    }
    setWelcomeVisible(activeMessages.length === 0 && !showTyping);
    root.scrollTop = root.scrollHeight;
    const stage = $('#chatStage'); stage.scrollTop = stage.scrollHeight;
  }

  async function refreshChats() {
    if (currentUser) {
      const data = await api('/api/chats');
      chats = data.chats || [];
    } else {
      chats = readGuestChats();
    }
    sortChats(); renderHistory();
  }

  async function createRemoteChat(title = 'New chat') {
    const data = await api('/api/chats', { method: 'POST', body: JSON.stringify({ title }) });
    return data.chat;
  }

  function persistCurrentGuestChat() {
    if (currentUser || !activeChatId) return;
    const index = chats.findIndex(chat => String(chat.id) === String(activeChatId));
    const value = { id: activeChatId, title: activeChatTitle, messages: activeMessages, updated_at: localTimestamp(), created_at: index >= 0 ? chats[index].created_at : localTimestamp() };
    if (index >= 0) chats[index] = value; else chats.unshift(value);
    sortChats(); saveGuestChats(); renderHistory();
  }

  async function openChat(id) {
    try {
      if (currentUser) {
        const data = await api(`/api/chats/${encodeURIComponent(id)}`);
        activeChatId = data.chat.id;
        activeChatTitle = data.chat.title;
        activeMessages = data.messages || [];
      } else {
        const chat = chats.find(item => String(item.id) === String(id));
        if (!chat) return;
        activeChatId = chat.id; activeChatTitle = chat.title || 'New chat';
        activeMessages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
      }
      renderHistory(); renderMessages(); closeSidebar();
    } catch (error) { showToast(error.message || 'Could not open that conversation.'); }
  }

  function startNewChat() {
    if (isGenerating) { showToast('Wait for the current answer to finish first.'); return; }
    activeChatId = null; activeChatTitle = 'New chat'; activeMessages = [];
    renderHistory(); renderMessages(); closeSidebar(); $('#messageInput').focus();
  }

  function makeGuestChat() {
    const id = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return { id, title: 'New chat', messages: [], created_at: localTimestamp(), updated_at: localTimestamp() };
  }

  async function sendMessage(rawText) {
    const message = rawText.trim();
    if (!message || isGenerating) return;
    isGenerating = true;
    $('#sendButton').disabled = true;
    $('#messageInput').disabled = true;
    const userMessage = { role: 'user', content: message, created_at: localTimestamp() };
    activeMessages.push(userMessage);
    if (!activeChatId && !currentUser) {
      const chat = makeGuestChat(); activeChatId = chat.id; activeChatTitle = message.length > 42 ? `${message.slice(0, 42)}…` : message;
      chats.unshift({ ...chat, title: activeChatTitle, messages: [] });
    }
    if (activeMessages.filter(m => m.role === 'user').length === 1 && activeChatTitle === 'New chat') {
      activeChatTitle = message.length > 42 ? `${message.slice(0, 42)}…` : message;
    }
    // Optimistically show the question. The server also stores it for signed-in users.
    renderMessages(true); renderHistory();
    $('#messageInput').value = ''; fitTextarea(); updateCharCount();
    try {
      let data;
      if (currentUser) {
        if (!activeChatId) {
          const chat = await createRemoteChat(activeChatTitle); activeChatId = chat.id;
        }
        data = await api(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
        activeChatTitle = data.chat?.title || activeChatTitle;
      } else {
        data = await api('/api/ask', { method: 'POST', body: JSON.stringify({ message, messages: activeMessages, profile: getProfile() }) });
      }
      
      activeMessages.push({
        role: 'assistant',
        content: data.reply || 'I could not generate a response.',
        created_at: localTimestamp(),
        animate: true
      });

      updateMode(data.mode || 'demo');
      if (!currentUser) persistCurrentGuestChat();
      else await refreshChats();
      renderMessages(); renderHistory();
    } catch (error) {
      activeMessages.push({ role: 'assistant', content: `I couldn't send that message. ${error.message || 'Please try again.'}\n\nYour question is still in this chat; you can retry it by sending it again.`, created_at: localTimestamp() });
      if (!currentUser) persistCurrentGuestChat();
      renderMessages(); showToast('Message failed to send.');
    } finally {
      isGenerating = false; $('#messageInput').disabled = false; $('#messageInput').focus();
      $('#sendButton').disabled = !$('#messageInput').value.trim();
    }
  }

  function fitTextarea() {
    const input = $('#messageInput');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function updateCharCount() { $('#charCount').textContent = `${$('#messageInput').value.length} / 6000`; }

  async function openChatOptions(chat) {
    const choice = window.prompt(`Chat options for:\n${chat.title}\n\nType R to rename, or D to delete.`, 'R');
    if (!choice) return;
    if (choice.trim().toLowerCase() === 'r') {
      const title = window.prompt('Enter a new chat title:', chat.title || 'New chat');
      if (!title || !title.trim()) return;
      try {
        if (currentUser) await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim() }) });
        else {
          const found = chats.find(item => String(item.id) === String(chat.id));
          if (found) found.title = title.trim().slice(0, 100);
          if (String(activeChatId) === String(chat.id)) activeChatTitle = title.trim().slice(0, 100);
          saveGuestChats();
        }
        await refreshChats();
        if (String(activeChatId) === String(chat.id)) { activeChatTitle = title.trim().slice(0, 100); renderHistory(); }
        showToast('Chat renamed.');
      } catch (error) { showToast(error.message); }
    } else if (choice.trim().toLowerCase() === 'd') {
      if (!window.confirm(`Delete “${chat.title}”? This cannot be undone.`)) return;
      try {
        if (currentUser) await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
        chats = chats.filter(item => String(item.id) !== String(chat.id));
        if (!currentUser) saveGuestChats();
        if (String(activeChatId) === String(chat.id)) { activeChatId = null; activeChatTitle = 'New chat'; activeMessages = []; renderMessages(); }
        await refreshChats(); showToast('Chat deleted.');
      } catch (error) { showToast(error.message); }
    }
  }

  function openModal(content) {
    $('#modalContent').innerHTML = content;
    $('#modalBackdrop').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modalBackdrop').hidden = true;
    $('#modalContent').innerHTML = '';
    document.body.style.overflow = '';
  }

  function openAuthModal(tab = 'login', error = '') {
    authTab = tab;
    const isRegister = tab === 'register';
    const profile = guestProfile();
    openModal(`
      <div class="modal-kicker">USMANAI ACCOUNT</div>
      <h2 id="modalTitle">${isRegister ? 'Create your account' : 'Welcome back'}</h2>
      <p class="modal-lead">${isRegister ? 'Save your study chats and keep your preferences across sessions.' : 'Sign in to access your saved conversations and account settings.'}</p>
      <div class="auth-tabs"><button class="auth-tab ${!isRegister ? 'active' : ''}" type="button" data-auth-tab="login">Sign in</button><button class="auth-tab ${isRegister ? 'active' : ''}" type="button" data-auth-tab="register">Create account</button></div>
      <form id="authForm">
        ${isRegister ? `<div class="field"><label for="authName">Your name</label><input id="authName" name="name" autocomplete="name" required maxlength="80" placeholder="e.g. Samad" value="${escapeHtml(profile.name || '')}" /></div>` : ''}
        <div class="field"><label for="authEmail">Email address</label><input id="authEmail" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" /></div>
        <div class="field"><label for="authPassword">Password</label><input id="authPassword" name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required minlength="${isRegister ? '8' : '1'}" maxlength="200" placeholder="${isRegister ? 'At least 8 characters' : 'Your password'}" /></div>
        ${isRegister ? `<div class="field-grid"><div class="field"><label for="authGrade">Class (optional)</label><select id="authGrade" name="grade"><option value="">Select class</option>${['Nursery', 'KG', 'Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Class VI', 'Class VII', 'Class VIII', 'Class IX', 'Class X', 'Class XI', 'Class XII'].map(g => `<option ${profile.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div><div class="field"><label for="authCampus">Campus (optional)</label><input id="authCampus" name="campus" maxlength="80" placeholder="Campus number" value="${escapeHtml(profile.campus || '')}" /></div></div>` : ''}
        <p class="form-error" id="authError" ${error ? '' : 'hidden'}>${escapeHtml(error)}</p>
        <button class="primary-button" type="submit" id="authSubmit">${isRegister ? 'Create account' : 'Sign in'}</button>
      </form>
      <div class="modal-footer-note">Use an email you control. This independent starter app is not connected to UPSS sign-in systems.</div>
    `);
    $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => openAuthModal(button.dataset.authTab)));
    $('#authForm').addEventListener('submit', handleAuthSubmit);
  }

  async function importGuestChats() {
    const guestChats = readGuestChats();
    if (!guestChats.length) return 0;
    const valid = guestChats.slice(0, 50).map(chat => ({
      title: String(chat.title || 'Imported chat').slice(0, 100),
      messages: Array.isArray(chat.messages) ? chat.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-100) : [],
    }));
    const result = await api('/api/import-chats', { method: 'POST', body: JSON.stringify({ chats: valid }) });
    localStorage.removeItem(GUEST_CHATS_KEY);
    return result.imported || 0;
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const errorNode = $('#authError'); const submit = $('#authSubmit');
    errorNode.hidden = true; submit.disabled = true; submit.textContent = authTab === 'register' ? 'Creating…' : 'Signing in…';
    try {
      const isRegister = authTab === 'register';
      const result = await api(isRegister ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(data) });
      currentUser = result.user;
      let imported = 0;
      try { imported = await importGuestChats(); } catch (_) { /* keep guest chats in local storage if import fails */ }
      await refreshChats(); syncProfileUi();
      const chosenTheme = currentUser.preferences?.theme || localStorage.getItem(THEME_KEY) || 'light';
      setTheme(chosenTheme, false); closeModal(); startNewChat();
      showToast(isRegister ? 'Account created.' : 'Signed in successfully.');
      if (imported) showToast(`${imported} local chat${imported === 1 ? '' : 's'} saved to your account.`);
    } catch (error) {
      errorNode.textContent = error.message || 'Could not sign in.'; errorNode.hidden = false;
      submit.disabled = false; submit.textContent = authTab === 'register' ? 'Create account' : 'Sign in';
    }
  }

  function openAccountModal() {
    if (!currentUser) { openAuthModal('login'); return; }
    const profile = currentUser;
    const pref = profile.preferences || {};
    const theme = pref.theme || document.body.dataset.theme || 'light';
    const gradeOptions = ['Nursery', 'KG', 'Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Class VI', 'Class VII', 'Class VIII', 'Class IX', 'Class X', 'Class XI', 'Class XII'];
    openModal(`
      <div class="modal-kicker">PERSONAL SPACE</div>
      <div class="account-heading"><span class="avatar">${escapeHtml(initials(profile.name))}</span><div><h2 id="modalTitle">Account & settings</h2><p>${escapeHtml(profile.email)}</p></div></div>
      <form id="profileForm">
        <div class="field"><label for="profileName">Display name</label><input id="profileName" name="name" required maxlength="80" value="${escapeHtml(profile.name)}" /></div>
        <div class="field-grid"><div class="field"><label for="profileGrade">Class</label><select id="profileGrade" name="grade"><option value="">Not set</option>${gradeOptions.map(g => `<option ${profile.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div><div class="field"><label for="profileCampus">Campus</label><input id="profileCampus" name="campus" maxlength="80" value="${escapeHtml(profile.campus || '')}" placeholder="Campus number / name" /></div></div>
        <div class="settings-section"><div class="settings-section-title">PREFERENCES</div>
          <div class="field-grid"><div class="field"><label for="profileLanguage">Response language</label><select id="profileLanguage" name="language"><option ${pref.language === 'English' || !pref.language ? 'selected' : ''}>English</option><option ${pref.language === 'Roman Urdu' ? 'selected' : ''}>Roman Urdu</option><option ${pref.language === 'Urdu' ? 'selected' : ''}>Urdu</option></select></div><div class="field"><label for="profileStyle">Answer style</label><select id="profileStyle" name="responseStyle"><option ${pref.responseStyle === 'Concise' ? 'selected' : ''}>Concise</option><option ${pref.responseStyle === 'Step-by-step' || !pref.responseStyle ? 'selected' : ''}>Step-by-step</option><option ${pref.responseStyle === 'Detailed' ? 'selected' : ''}>Detailed</option></select></div></div>
          <div class="inline-label">Appearance</div><div class="theme-options"><button class="theme-option ${theme === 'light' ? 'active' : ''}" type="button" data-theme="light"><span class="theme-preview"></span>Light</button><button class="theme-option ${theme === 'dark' ? 'active' : ''}" type="button" data-theme="dark"><span class="theme-preview dark"></span>Dark</button></div>
        </div>
        <p class="form-error" id="profileError" hidden></p>
        <div style="margin-top:18px"><button class="primary-button" type="submit" id="saveProfile">Save changes</button></div>
      </form>
      <div class="settings-section"><div class="settings-section-title">DATA & SESSION</div><div class="settings-actions"><button class="secondary-button" type="button" id="exportChatBtn">Export current chat</button><button class="danger-button" type="button" id="clearChatsBtn">Clear chat history</button></div><p class="settings-message">Chats are saved to this device in guest mode. After sign-in, chats are stored in this app's local database. Do not put passwords or private student records into AI prompts.</p><div style="margin-top:13px"><button class="secondary-button" type="button" id="signOutBtn" style="width:100%">Sign out</button></div></div>
    `);
    $$('[data-theme]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.theme, true)));
    $('#profileForm').addEventListener('submit', handleProfileSubmit);
    $('#exportChatBtn').addEventListener('click', () => { exportCurrentChat(); closeModal(); });
    $('#clearChatsBtn').addEventListener('click', clearChatHistory);
    $('#signOutBtn').addEventListener('click', signOut);
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    const error = $('#profileError'); const save = $('#saveProfile'); error.hidden = true; save.disabled = true; save.textContent = 'Saving…';
    try {
      const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ name: values.name, grade: values.grade, campus: values.campus, preferences: { theme: document.body.dataset.theme, language: values.language, responseStyle: values.responseStyle } }) });
      currentUser = result.user; syncProfileUi(); renderMessages(); closeModal(); showToast('Your settings have been saved.');
    } catch (err) {
      error.textContent = err.message || 'Could not save settings.'; error.hidden = false; save.disabled = false; save.textContent = 'Save changes';
    }
  }

  async function signOut() {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); }
    catch (_) { /* the local UI can still return to guest mode */ }
    currentUser = null; activeChatId = null; activeMessages = []; activeChatTitle = 'New chat';
    chats = readGuestChats(); sortChats(); syncProfileUi(); await refreshChats().catch(() => { });
    setTheme(localStorage.getItem(THEME_KEY) || 'light', false); closeModal(); renderMessages(); showToast('You are now using guest mode.');
  }

  async function clearChatHistory() {
    if (!window.confirm('Delete all saved conversations? This cannot be undone.')) return;
    try {
      if (currentUser) await api('/api/chats', { method: 'DELETE' });
      else localStorage.removeItem(GUEST_CHATS_KEY);
      chats = []; activeChatId = null; activeMessages = []; activeChatTitle = 'New chat';
      saveGuestChats(); renderHistory(); renderMessages(); closeModal(); showToast('Chat history cleared.');
    } catch (error) { showToast(error.message || 'Could not clear history.'); }
  }

  function exportCurrentChat() {
    if (!activeMessages.length) { showToast('There is no conversation to export yet.'); return; }
    const body = [`UsmanAI conversation — ${activeChatTitle}`, `Exported ${new Date().toLocaleString()}`, '', ...activeMessages.map(m => `${m.role === 'user' ? (getProfile().name || 'You') : 'UsmanAI'}:\n${m.content}\n`)].join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `${(activeChatTitle || 'usmanai-chat').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'usmanai-chat'}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); showToast('Conversation exported.');
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open'); $('#mobileBackdrop').classList.remove('show');
  }

  async function boot() {
    const theme = localStorage.getItem(THEME_KEY) || guestProfile().preferences?.theme || 'light';
    setTheme(theme, false);
    try {
      const [me, status] = await Promise.all([api('/api/me'), api('/api/status')]);
      currentUser = me.user;
      updateMode(status.ai_configured ? 'ai' : 'demo');
      if (currentUser?.preferences?.theme) setTheme(currentUser.preferences.theme, false);
      syncProfileUi(); await refreshChats();
    } catch (_) {
      currentUser = null; updateMode('demo'); syncProfileUi(); chats = readGuestChats(); sortChats(); renderHistory();
      showToast('Could not reach the local server. Refresh after starting app.py.');
    }
    setWelcomeVisible(true); renderHistory();
  }

  $('#composerForm').addEventListener('submit', event => {
    event.preventDefault(); sendMessage($('#messageInput').value);
  });
  $('#messageInput').addEventListener('input', () => {
    fitTextarea(); updateCharCount(); $('#sendButton').disabled = !$('#messageInput').value.trim() || isGenerating;
  });
  $('#messageInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('#sendButton').disabled) $('#composerForm').requestSubmit(); }
  });
  $('#newChatBtn').addEventListener('click', startNewChat);
  $('#searchChats').addEventListener('input', renderHistory);
  $('#profileButton').addEventListener('click', openAccountModal);
  $('#topAccount').addEventListener('click', openAccountModal);
  $('#themeToggle').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark', true));
  $('#openSidebar').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#mobileBackdrop').classList.add('show'); });
  $('#closeSidebar').addEventListener('click', closeSidebar);
  $('#mobileBackdrop').addEventListener('click', closeSidebar);
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
  $$('.suggestion-card').forEach(card => card.addEventListener('click', () => { $('#messageInput').value = card.dataset.prompt || ''; fitTextarea(); updateCharCount(); $('#sendButton').disabled = false; $('#messageInput').focus(); if (window.matchMedia('(max-width: 760px)').matches) $('#composerForm').requestSubmit(); }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeModal(); closeSidebar(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); startNewChat(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') { event.preventDefault(); exportCurrentChat(); }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
  }
  boot();
})();
