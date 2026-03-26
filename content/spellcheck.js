// content/spellcheck.js
// Suomenkielinen oikoluku — DOM-integraatio

(function () {
  'use strict';

  // Vältä duplikaatti-injektio
  if (window.__voikkoSpellcheck) return;
  window.__voikkoSpellcheck = true;

  // --- Konfiguraatio ---
  const DEBOUNCE_MS = 400;
  const MIN_WORD_LENGTH = 2;
  const ERROR_CLASS = 'voikko-err';
  const OVERLAY_CLASS = 'voikko-overlay';

  // Käyttäjän oma sanalistta (ladataan storagesta)
  let userWords = new Set();

  // Tallenna missä sanassa kursori on kontekstivalikkoa varten
  let contextWord = null;
  let contextSuggestions = [];

  // --- Apufunktiot ---

  // Pilko teksti sanoiksi säilyttäen positiot
  function extractWordPositions(text) {
    const results = [];
    // Osuma: Unicode-kirjaimet, tavuviiva, apostrof — vähintään MIN_WORD_LENGTH merkkiä
    const re = /[\p{L}][\p{L}'\-]*/gu;
    let match;
    while ((match = re.exec(text)) !== null) {
      const word = match[0];
      if (word.length >= MIN_WORD_LENGTH) {
        results.push({ word, start: match.index, end: match.index + word.length });
      }
    }
    return results;
  }

  // Kysy background-workerilta mitkä sanat ovat väärin
  async function checkWords(words) {
    if (words.length === 0) return [];
    // Suodata käyttäjän oma sanalistta
    const toCheck = [...new Set(words)].filter(w => !userWords.has(w));
    if (toCheck.length === 0) return [];

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'CHECK_WORDS', words: toCheck },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve([]);
            return;
          }
          resolve(response.results || []);
        }
      );
    });
  }

  // --- Textarea/input overlay ---

  // CSS-ominaisuudet jotka pitää kopioida tekstialueesta overlayhin
  const COPY_STYLES = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'letter-spacing', 'line-height', 'text-transform', 'word-spacing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'box-sizing', 'tab-size', 'white-space', 'word-wrap', 'overflow-wrap'
  ];

  function createOverlay(el) {
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('aria-hidden', 'true');
    syncOverlayStyles(el, overlay);
    el.parentElement.style.position = 'relative';
    el.parentElement.insertBefore(overlay, el.nextSibling);
    return overlay;
  }

  function syncOverlayStyles(el, overlay) {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parentRect = el.parentElement.getBoundingClientRect();

    overlay.style.position = 'absolute';
    overlay.style.top = (el.offsetTop) + 'px';
    overlay.style.left = (el.offsetLeft) + 'px';
    overlay.style.width = el.offsetWidth + 'px';
    overlay.style.height = el.offsetHeight + 'px';
    overlay.style.overflow = 'hidden';
    overlay.style.pointerEvents = 'none';
    overlay.style.whiteSpace = 'pre-wrap';
    overlay.style.wordBreak = 'break-word';
    overlay.style.color = 'transparent';
    overlay.style.zIndex = '9999';

    for (const prop of COPY_STYLES) {
      overlay.style[prop] = cs[prop];
    }
  }

  function updateOverlay(el, overlay, errors) {
    const text = el.value;
    if (!text) {
      overlay.innerHTML = '';
      return;
    }

    // Rakenna HTML: tekstin sanat, virheelliset sanat <mark>-tagien sisään
    const errorSet = new Map(errors.filter(r => !r.correct).map(r => [r.word, r.suggestions]));
    const wordPositions = extractWordPositions(text);

    let html = '';
    let lastIndex = 0;

    for (const { word, start, end } of wordPositions) {
      // Lisää teksti ennen tätä sanaa (XML-escaped)
      html += escapeHtml(text.slice(lastIndex, start));

      if (errorSet.has(word)) {
        const suggestions = errorSet.get(word);
        const sugStr = suggestions.slice(0, 6).join('|');
        html += `<mark class="${ERROR_CLASS}" data-word="${escapeAttr(word)}" data-suggestions="${escapeAttr(sugStr)}">${escapeHtml(word)}</mark>`;
      } else {
        html += escapeHtml(word);
      }
      lastIndex = end;
    }
    html += escapeHtml(text.slice(lastIndex));

    overlay.innerHTML = html;

    // Synkronoi scroll
    overlay.scrollTop = el.scrollTop;
    overlay.scrollLeft = el.scrollLeft;
  }

  // --- ContentEditable ---

  function getTextContent(el) {
    return el.innerText || el.textContent || '';
  }

  function updateContentEditable(el, errors) {
    // Tallenna kursori ennen muutoksia
    const selection = window.getSelection();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const cursorOffset = range ? getAbsoluteOffset(el, range.startContainer, range.startOffset) : -1;

    // Poista vanhat virhemerkit (palauta teksti normaaliksi)
    removeOldMarks(el);

    if (errors.length === 0) return;

    const errorSet = new Map(errors.filter(r => !r.correct).map(r => [r.word, r.suggestions]));
    if (errorSet.size === 0) return;

    // Merkitse virheelliset sanat
    markErrorsInNode(el, errorSet);

    // Palauta kursori
    if (cursorOffset >= 0) {
      restoreCursor(el, cursorOffset);
    }
  }

  function removeOldMarks(el) {
    const marks = el.querySelectorAll(`.${ERROR_CLASS}`);
    for (const mark of marks) {
      const text = document.createTextNode(mark.textContent);
      mark.parentNode.replaceChild(text, mark);
    }
    el.normalize();
  }

  function markErrorsInNode(rootEl, errorSet) {
    const walker = document.createTreeWalker(
      rootEl,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Ohita jo merkityt solmut
          if (node.parentElement.classList.contains(ERROR_CLASS)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const wordPositions = extractWordPositions(text);
      if (wordPositions.length === 0) continue;

      const errorWords = wordPositions.filter(({ word }) => errorSet.has(word));
      if (errorWords.length === 0) continue;

      // Rakenna uudet solmut tekstisolmun tilalle
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const { word, start, end } of errorWords) {
        if (start > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
        }

        const mark = document.createElement('mark');
        mark.className = ERROR_CLASS;
        mark.textContent = word;
        const suggestions = errorSet.get(word);
        mark.dataset.word = word;
        mark.dataset.suggestions = suggestions.slice(0, 6).join('|');
        fragment.appendChild(mark);

        lastIndex = end;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  // Kursoripaikan laskeminen absoluuttisena offsettina koko elementin tekstistä
  function getAbsoluteOffset(root, targetNode, targetOffset) {
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === targetNode) return offset + targetOffset;
      offset += node.textContent.length;
    }
    return -1;
  }

  function restoreCursor(root, absoluteOffset) {
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (offset + len >= absoluteOffset) {
        try {
          const range = document.createRange();
          range.setStart(node, absoluteOffset - offset);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (e) {
          // Kursorin palautus epäonnistui — ei kriittinen
        }
        return;
      }
      offset += len;
    }
  }

  // --- Elementtien hallinta ---

  const trackedElements = new WeakMap(); // el → { overlay?, debounceTimer, type }

  function isEditableElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      return ['text', 'search', 'url', 'email', ''].includes(type);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function isExcludedSite() {
    // Ohita sivustot joilla on oma DOM-rakenne (MVP)
    const host = location.hostname;
    return [
      'docs.google.com',
      'notion.so',
      'www.notion.so',
    ].some(excluded => host === excluded || host.endsWith('.' + excluded));
  }

  async function triggerCheck(el) {
    const info = trackedElements.get(el);
    if (!info) return;

    const text = el.value !== undefined ? el.value : getTextContent(el);
    const wordPositions = extractWordPositions(text);
    const words = wordPositions.map(w => w.word);

    const results = await checkWords(words);

    if (info.type === 'textarea' || info.type === 'input') {
      if (info.overlay) {
        updateOverlay(el, info.overlay, results);
      }
    } else if (info.type === 'contenteditable') {
      updateContentEditable(el, results);
    }
  }

  function scheduleCheck(el) {
    const info = trackedElements.get(el);
    if (!info) return;

    clearTimeout(info.debounceTimer);
    info.debounceTimer = setTimeout(() => triggerCheck(el), DEBOUNCE_MS);
  }

  function attachElement(el) {
    if (trackedElements.has(el)) return;
    if (isExcludedSite()) return;

    let type, overlay;

    if (el.tagName === 'TEXTAREA') {
      type = 'textarea';
      overlay = createOverlay(el);

      el.addEventListener('scroll', () => {
        if (overlay) {
          overlay.scrollTop = el.scrollTop;
          overlay.scrollLeft = el.scrollLeft;
        }
      });

      // Synkronoi koko jos textarea resizataan
      new ResizeObserver(() => syncOverlayStyles(el, overlay)).observe(el);

      // Tee tekstialueesta läpinäkyvä (overlay näyttää tekstin)
      el.style.color = 'transparent';
      el.style.caretColor = window.getComputedStyle(el).color || 'black';
      el.style.webkitTextFillColor = 'transparent';

    } else if (el.tagName === 'INPUT') {
      type = 'input';
      overlay = createOverlay(el);
      el.style.color = 'transparent';
      el.style.caretColor = window.getComputedStyle(el).color || 'black';
      el.style.webkitTextFillColor = 'transparent';

    } else {
      type = 'contenteditable';
      overlay = null;
    }

    trackedElements.set(el, { type, overlay, debounceTimer: null });

    el.addEventListener('input', () => scheduleCheck(el));
    el.addEventListener('focus', () => scheduleCheck(el));

    // Tarkista heti jos elementissä on jo tekstiä
    if ((el.value || getTextContent(el)).length > 0) {
      scheduleCheck(el);
    }
  }

  function detachElement(el) {
    const info = trackedElements.get(el);
    if (!info) return;

    clearTimeout(info.debounceTimer);
    if (info.overlay) info.overlay.remove();
    trackedElements.delete(el);
  }

  // --- Kontekstivalikko ---

  document.addEventListener('contextmenu', (e) => {
    const target = e.target;

    // Tarkista onko kohdistus virheellisen sanan päällä
    if (target.classList && target.classList.contains(ERROR_CLASS)) {
      contextWord = target.dataset.word;
      contextSuggestions = (target.dataset.suggestions || '').split('|').filter(Boolean);
    } else {
      // Tarkista onko kursori textarea/input-elementissä virheellisen sanan kohdalla
      contextWord = null;
      contextSuggestions = [];

      const activeEl = document.activeElement;
      if (activeEl && trackedElements.has(activeEl) && activeEl.value !== undefined) {
        const cursorPos = activeEl.selectionStart;
        const text = activeEl.value;
        const wordPositions = extractWordPositions(text);

        for (const { word, start, end } of wordPositions) {
          if (cursorPos >= start && cursorPos <= end) {
            // Etsi virhe overlaysta
            const info = trackedElements.get(activeEl);
            if (info && info.overlay) {
              const mark = info.overlay.querySelector(`.${ERROR_CLASS}[data-word="${CSS.escape(word)}"]`);
              if (mark) {
                contextWord = word;
                contextSuggestions = (mark.dataset.suggestions || '').split('|').filter(Boolean);
              }
            }
            break;
          }
        }
      }
    }

    if (contextWord) {
      chrome.runtime.sendMessage({
        type: 'SET_CONTEXT_WORD',
        word: contextWord,
        suggestions: contextSuggestions
      });
    }
  });

  // Kuuntele korjausehdotuksen valintaa
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'APPLY_SUGGESTION') {
      applySuggestion(msg.suggestion);
    } else if (msg.type === 'GET_CONTEXT_WORD') {
      return contextWord;
    }
  });

  function applySuggestion(suggestion) {
    if (!contextWord) return;

    const activeEl = document.activeElement;
    if (!activeEl) return;

    if (activeEl.value !== undefined) {
      // textarea tai input
      const text = activeEl.value;
      const cursorPos = activeEl.selectionStart;
      const wordPositions = extractWordPositions(text);

      for (const { word, start, end } of wordPositions) {
        if (word === contextWord && cursorPos >= start && cursorPos <= end) {
          activeEl.value = text.slice(0, start) + suggestion + text.slice(end);
          activeEl.setSelectionRange(start + suggestion.length, start + suggestion.length);
          scheduleCheck(activeEl);
          break;
        }
      }
    } else if (activeEl.isContentEditable) {
      // contenteditable: korvaa virheellinen sana
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return;

      // Etsi lähimpää virheellistä sanaa
      const mark = activeEl.querySelector(`.${ERROR_CLASS}[data-word="${CSS.escape(contextWord)}"]`);
      if (mark) {
        const range = document.createRange();
        range.selectNode(mark);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('insertText', false, suggestion);
        scheduleCheck(activeEl);
      }
    }

    contextWord = null;
    contextSuggestions = [];
  }

  // --- Sivuston pois päältä kytkeminen ---

  async function isDisabledForSite() {
    const key = `disabled_${location.hostname}`;
    const result = await chrome.storage.local.get(key);
    return result[key] === true;
  }

  // --- Alustus ---

  async function init() {
    // Tarkista onko laajennus pois päältä tällä sivulla
    if (await isDisabledForSite()) return;
    if (isExcludedSite()) return;

    // Lataa käyttäjän oma sanalistta
    const result = await chrome.storage.local.get('userWords');
    userWords = new Set(result.userWords || []);

    // Liitä kaikki olemassa olevat editoitavat elementit
    document.querySelectorAll('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], input:not([type]), [contenteditable="true"]')
      .forEach(el => attachElement(el));

    // Seuraa uusia elementtejä (SPA:t, dynaaminen sisältö)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (isEditableElement(node)) {
            attachElement(node);
          }

          // Tarkista lapset
          node.querySelectorAll?.('textarea, input[type="text"], input[type="search"], input[type="url"], input[type="email"], input:not([type]), [contenteditable="true"]')
            .forEach(el => attachElement(el));
        }

        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (trackedElements.has(node)) detachElement(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Kuuntele storage-muutoksia (esim. popup lisää sanan)
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.userWords) {
        userWords = new Set(changes.userWords.newValue || []);
        // Uudelleentarkista fokussoitu elementti
        if (document.activeElement && trackedElements.has(document.activeElement)) {
          scheduleCheck(document.activeElement);
        }
      }
    });
  }

  // --- Apufunktiot HTML-escapointiin ---

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Käynnistä
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
