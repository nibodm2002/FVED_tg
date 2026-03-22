/* ===================================================================
   VED Telegram Mirror — Application Logic
   Vanilla JS SPA — loads posts from static JSON files
   =================================================================== */

(function () {
  'use strict';

  /* ---------- Configuration ---------- */
  const CONFIG = {
    channelKey:     'firmaved',
    dataBasePath:   'data/channels',
    postsPerPage:   20,
    channelUrl:     'https://t.me/firmaved',
    fallbackLogo:   'assets/favicon.svg'
  };

  /* ---------- State ---------- */
  const state = {
    channel: null,
    posts: [],
    currentPage: 0,
    totalPages: 1,
    isLoading: false,
  };

  /* ---------- DOM refs ---------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    shell:        $('#siteShell'),
    title:        $('#siteTitle'),
    description:  $('#siteDescription'),
    avatarWrap:   $('#channelAvatarWrap'),
    avatar:       $('#channelAvatar'),
    channelLink:  $('#channelLink'),
    postFeed:     $('#postFeed'),
    loadingState: $('#loadingState'),
    emptyState:   $('#emptyState'),
    errorState:   $('#errorState'),
    loadMoreBtn:  $('#loadMoreBtn'),
    refreshBtn:   $('#refreshBtn'),
    installAppBtn:$('#installAppBtn'),
    themeBtn:     $('#themeBtn'),
    updatedText:  $('#updatedText'),
    lightbox:     $('#lightbox'),
    lightboxImg:  $('#lightboxImg'),
    lightboxClose:$('#lightboxClose'),
  };

  /* ---------- Helpers ---------- */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }


  function formatViews(n) {
    if (!n) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / 1048576).toFixed(1) + ' МБ';
  }

  /* ---------- Theme ---------- */
  function initTheme() {
    const saved = localStorage.getItem('ved-theme');
    if (saved) {
      document.documentElement.dataset.theme = saved;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ved-theme', next);
  }

  /* ---------- Toast ---------- */
  let toastEl = null;
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    // Force reflow
    void toastEl.offsetHeight;
    toastEl.classList.add('is-visible');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
    }, 2200);
  }

  /* ---------- Lightbox ---------- */
  function openLightbox(src) {
    dom.lightboxImg.src = src;
    dom.lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    dom.lightbox.classList.add('hidden');
    dom.lightboxImg.src = '';
    document.body.style.overflow = '';
  }

  dom.lightboxClose.addEventListener('click', closeLightbox);
  dom.lightbox.addEventListener('click', (e) => {
    if (e.target === dom.lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.lightbox.classList.contains('hidden')) {
      closeLightbox();
    }
  });

  /* ---------- Build Media ---------- */
  function buildMedia(post) {
    if (!post.media || post.media.length === 0) return '';

    const mediaItems = post.media;

    // Single media
    if (mediaItems.length === 1) {
      const m = mediaItems[0];
      if (m.type === 'photo') {
        return `<div class="post-card__media">
          <img src="${escapeHtml(m.url)}" alt="Фото" loading="lazy" onclick="window.__vedLightbox('${escapeHtml(m.url)}')">
        </div>`;
      }
      if (m.type === 'video') {
        const poster = m.thumbnail ? `poster="${escapeHtml(m.thumbnail)}"` : '';
        return `<div class="post-card__media">
          <video controls preload="metadata" ${poster}>
            <source src="${escapeHtml(m.url)}" type="video/mp4">
          </video>
        </div>`;
      }
      if (m.type === 'document') {
        return buildDocument(m);
      }
      return '';
    }

    // Multiple photos — gallery
    const photos = mediaItems.filter(m => m.type === 'photo');
    const others = mediaItems.filter(m => m.type !== 'photo');

    let html = '';

    if (photos.length > 0) {
      const count = Math.min(photos.length, 4);
      html += `<div class="post-card__media"><div class="post-card__gallery post-card__gallery--${count}">`;
      photos.slice(0, 4).forEach(p => {
        html += `<img src="${escapeHtml(p.url)}" alt="Фото" loading="lazy" onclick="window.__vedLightbox('${escapeHtml(p.url)}')">`;
      });
      html += `</div></div>`;
    }

    others.forEach(m => {
      if (m.type === 'video') {
        const poster = m.thumbnail ? `poster="${escapeHtml(m.thumbnail)}"` : '';
        html += `<div class="post-card__media">
          <video controls preload="metadata" ${poster}>
            <source src="${escapeHtml(m.url)}" type="video/mp4">
          </video>
        </div>`;
      }
      if (m.type === 'document') {
        html += buildDocument(m);
      }
    });

    return html;
  }

  function buildDocument(doc) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const name = doc.file_name || 'Документ';
    const size = doc.file_size ? formatFileSize(doc.file_size) : '';
    const href = doc.url ? `href="${escapeHtml(doc.url)}" target="_blank"` : '';

    return `<a class="post-card__document" ${href}>
      ${icon}
      <div class="post-card__doc-info">
        <div class="post-card__doc-name">${escapeHtml(name)}</div>
        ${size ? `<div class="post-card__doc-size">${size}</div>` : ''}
      </div>
    </a>`;
  }

  /* ---------- Render Post Card ---------- */
  function renderPostCard(post) {
    const article = document.createElement('article');
    article.className = 'post-card';
    article.id = `post-${post.id}`;

    const media = buildMedia(post);
    const textHtml = post.text_html || (post.text ? post.text.replace(/\n/g, '<br>') : '');

    // Forwarded
    let forwardedHtml = '';
    if (post.forwarded) {
      const fwdIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>`;
      const label = post.forwarded.label || post.forwarded.from || 'Переслано';
      const href = post.forwarded.href ? `href="${escapeHtml(post.forwarded.href)}" target="_blank"` : '';
      forwardedHtml = `<a class="post-card__forwarded" ${href}>${fwdIcon} ${escapeHtml(label)}</a>`;
    }

    // Views
    const viewsHtml = post.views ? `
      <span class="post-card__views">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        ${formatViews(post.views)}
      </span>` : '';

    // TG link
    const tgUrl = post.tg_url || `${CONFIG.channelUrl}/${post.id}`;

    article.innerHTML = `
      ${media}
      <div class="post-card__body">
        <button class="post-card__copy" title="Копировать ссылку" data-url="${escapeHtml(tgUrl)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        ${forwardedHtml}
        <div class="post-card__text">${textHtml}</div>
      </div>
      <div class="post-card__footer">
        ${viewsHtml}
        <a class="post-card__tg-link" href="${escapeHtml(tgUrl)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>
          В Telegram
        </a>
      </div>
    `;

    return article;
  }

  /* ---------- Render Feed ---------- */
  function renderFeed(append = false) {
    if (!append) {
      dom.postFeed.innerHTML = '';
    }

    const start = append ? (state.currentPage - 1) * CONFIG.postsPerPage : 0;
    const end = state.currentPage * CONFIG.postsPerPage;
    const postsToRender = state.posts.slice(
      append ? start : 0,
      end
    );

    if (!append && postsToRender.length === 0) {
      dom.emptyState.classList.remove('hidden');
      dom.loadMoreBtn.classList.add('hidden');
      return;
    }

    const fragment = document.createDocumentFragment();
    postsToRender.forEach((post, i) => {
      const card = renderPostCard(post);
      if (append) {
        card.style.animationDelay = `${i * 0.06}s`;
      }
      fragment.appendChild(card);
    });

    if (append) {
      dom.postFeed.appendChild(fragment);
    } else {
      dom.postFeed.appendChild(fragment);
    }

    // Show/hide load more
    if (end < state.posts.length || state.currentPage < state.totalPages) {
      dom.loadMoreBtn.classList.remove('hidden');
    } else {
      dom.loadMoreBtn.classList.add('hidden');
    }
  }

  /* ---------- Copy Link ---------- */
  dom.postFeed.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.post-card__copy');
    if (!copyBtn) return;

    const url = copyBtn.dataset.url;
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.classList.add('is-copied');
      showToast('Ссылка скопирована');
      setTimeout(() => copyBtn.classList.remove('is-copied'), 2000);
    } catch {
      showToast('Не удалось скопировать');
    }
  });

  /* ---------- Lightbox global handler ---------- */
  window.__vedLightbox = openLightbox;

  /* ---------- Data Loading ---------- */
  async function loadFeed() {
    if (state.isLoading) return;
    state.isLoading = true;

    showState('loading');

    try {
      const url = `${CONFIG.dataBasePath}/${CONFIG.channelKey}/posts.json?t=${Date.now()}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();

      // Update channel info
      if (data.channel) {
        state.channel = data.channel;
        updateChannelInfo(data.channel);
      }

      // Merge posts
      state.posts = data.posts || [];
      state.totalPages = data.total_pages || 1;
      state.currentPage = 1;

      // Update timestamp
      if (data.generated_at) {
        const d = new Date(data.generated_at);
        dom.updatedText.textContent = `Обновлено: ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      }

      showState('feed');
      renderFeed();
    } catch (err) {
      console.error('Feed load error:', err);
      showState('error');
    } finally {
      state.isLoading = false;
    }
  }

  async function loadMore() {
    if (state.isLoading) return;

    const nextPage = state.currentPage + 1;

    // Check if we already have enough posts in memory
    if (nextPage * CONFIG.postsPerPage <= state.posts.length) {
      state.currentPage = nextPage;
      renderFeed(true);
      return;
    }

    // Otherwise try to load next page file
    state.isLoading = true;
    dom.loadMoreBtn.textContent = 'Загрузка…';
    dom.loadMoreBtn.disabled = true;

    try {
      const url = `${CONFIG.dataBasePath}/${CONFIG.channelKey}/pages/${nextPage}.json?t=${Date.now()}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (data.posts && data.posts.length > 0) {
        state.posts = state.posts.concat(data.posts);
        state.currentPage = nextPage;
        if (data.total_pages) state.totalPages = data.total_pages;
        renderFeed(true);
      } else {
        dom.loadMoreBtn.classList.add('hidden');
      }
    } catch {
      // No more pages
      dom.loadMoreBtn.classList.add('hidden');
    } finally {
      state.isLoading = false;
      dom.loadMoreBtn.textContent = 'Загрузить ещё';
      dom.loadMoreBtn.disabled = false;
    }
  }

  function updateChannelInfo(ch) {
    dom.title.textContent = ch.title || 'ВЕД';
    dom.description.textContent = ch.description || '';

    if (ch.avatar) {
      dom.avatar.src = ch.avatar;
      dom.avatar.classList.remove('is-logo');
      dom.avatarWrap.style.display = '';
    } else {
      dom.avatar.src = CONFIG.fallbackLogo;
      dom.avatar.classList.add('is-logo');
      dom.avatarWrap.style.display = '';
    }

    if (ch.channel_url) {
      dom.channelLink.href = ch.channel_url;
    }

    // Update page title
    document.title = `${ch.title || 'ВЕД'} — Telegram`;
  }

  function showState(which) {
    dom.loadingState.classList.toggle('hidden', which !== 'loading');
    dom.emptyState.classList.toggle('hidden', which !== 'empty');
    dom.errorState.classList.toggle('hidden', which !== 'error');
    dom.postFeed.classList.toggle('hidden', which === 'loading' || which === 'error');
  }

  /* ---------- PWA Install ---------- */
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('✨ PWA installable!');
    e.preventDefault();
    deferredPrompt = e;
    dom.installAppBtn.classList.remove('hidden');
  });

  dom.installAppBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('Приложение установлено!');
    }
    deferredPrompt = null;
    dom.installAppBtn.classList.add('hidden');
  });

  /* ---------- Service Worker ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ---------- Event Listeners ---------- */
  dom.themeBtn.addEventListener('click', toggleTheme);
  dom.refreshBtn.addEventListener('click', () => {
    loadFeed();
    showToast('Обновление…');
  });
  dom.loadMoreBtn.addEventListener('click', loadMore);

  /* ---------- Scroll to post from hash ---------- */
  function scrollToHashPost() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#post-')) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 3px var(--signal)';
        setTimeout(() => el.style.boxShadow = '', 2000);
      }
    }
  }

  /* ---------- Init ---------- */
  initTheme();
  loadFeed().then(() => {
    scrollToHashPost();
  });
})();
