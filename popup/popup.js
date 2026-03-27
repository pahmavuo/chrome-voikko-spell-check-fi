// popup/popup.js

(async () => {
  const globalToggle = document.getElementById('global-toggle');
  const siteToggle = document.getElementById('site-toggle');
  const globalStatus = document.getElementById('global-status');
  const siteNameEl = document.getElementById('site-name');
  const wordListEl = document.getElementById('word-list');
  const header = document.getElementById('header');
  const content = document.getElementById('content');

  // Hae nykyinen sivu
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch (e) {}
  siteNameEl.textContent = hostname || '—';

  const siteKey = `disabled_site_${hostname}`;
  const result = await chrome.storage.local.get(['globalEnabled', siteKey, 'userWords']);

  // Globaali tila (oletus: päällä)
  const globalEnabled = result.globalEnabled !== false;
  globalToggle.checked = globalEnabled;
  updateGlobalUi(globalEnabled);

  // Sivukohtainen tila (oletus: päällä)
  const siteEnabled = result[siteKey] !== false;
  siteToggle.checked = siteEnabled;

  // Globaali toggle
  globalToggle.addEventListener('change', async () => {
    const enabled = globalToggle.checked;
    await chrome.storage.local.set({ globalEnabled: enabled });
    updateGlobalUi(enabled);
    await chrome.runtime.sendMessage({ type: 'SET_GLOBAL_ENABLED', enabled });
    // Reload sivu jotta muutos astuu voimaan
    if (tab.id) chrome.tabs.reload(tab.id);
  });

  // Sivukohtainen toggle
  siteToggle.addEventListener('change', async () => {
    const enabled = siteToggle.checked;
    await chrome.storage.local.set({ [siteKey]: enabled });
    if (tab.id) chrome.tabs.reload(tab.id);
  });

  function updateGlobalUi(enabled) {
    if (enabled) {
      header.style.background = '#1a73e8';
      globalStatus.textContent = 'Käytössä';
      content.classList.remove('disabled');
    } else {
      header.style.background = '#9aa0a6';
      globalStatus.textContent = 'Pois käytöstä';
      content.classList.add('disabled');
    }
  }

  // Sanalistta
  function renderWordList(words) {
    wordListEl.innerHTML = '';
    if (!words || words.length === 0) {
      wordListEl.innerHTML = '<div class="empty-words">Ei omia sanoja</div>';
      return;
    }
    for (const word of [...words].sort()) {
      const item = document.createElement('div');
      item.className = 'word-item';
      const span = document.createElement('span');
      span.textContent = word;
      const btn = document.createElement('button');
      btn.className = 'remove-word';
      btn.textContent = '×';
      btn.title = `Poista "${word}"`;
      btn.addEventListener('click', async () => {
        const r = await chrome.storage.local.get('userWords');
        const newWords = (r.userWords || []).filter(w => w !== word);
        await chrome.storage.local.set({ userWords: newWords });
        renderWordList(newWords);
      });
      item.appendChild(span);
      item.appendChild(btn);
      wordListEl.appendChild(item);
    }
  }

  renderWordList(result.userWords || []);

  // Debug-nappi
  const debugBtn = document.getElementById('debug-btn');
  const debugStatus = document.getElementById('debug-status');

  debugBtn.addEventListener('click', async () => {
    debugBtn.disabled = true;
    debugBtn.textContent = '⏳ Kerätään...';
    debugStatus.style.display = 'none';

    try {
      const [{ result: json }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ['content/debug-collector.js'],
      });

      await navigator.clipboard.writeText(json);
      debugStatus.textContent = '✓ Debug-tiedot kopioitu leikepöydälle';
      debugStatus.style.display = 'block';
    } catch (err) {
      debugStatus.textContent = '✗ Virhe: ' + err.message;
      debugStatus.style.color = '#d93025';
      debugStatus.style.display = 'block';
    } finally {
      debugBtn.disabled = false;
      debugBtn.textContent = '🔍 Debug';
    }
  });
})();
