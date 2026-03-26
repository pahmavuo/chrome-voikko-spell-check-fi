// popup/popup.js

(async () => {
  const toggle = document.getElementById('site-toggle');
  const statusDot = document.getElementById('status-dot');
  const siteNameEl = document.getElementById('site-name');
  const wordListEl = document.getElementById('word-list');

  // Hae nykyinen sivu
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = '';
  try {
    hostname = new URL(tab.url).hostname;
  } catch (e) {
    hostname = '';
  }
  siteNameEl.textContent = hostname || '—';

  // Lataa tila
  const disabledKey = `disabled_${hostname}`;
  const result = await chrome.storage.local.get([disabledKey, 'userWords']);

  const isDisabled = result[disabledKey] === true;
  toggle.checked = !isDisabled;
  statusDot.classList.toggle('off', isDisabled);

  // Päivitä tila togglea muutettaessa
  toggle.addEventListener('change', async () => {
    const disabled = !toggle.checked;
    statusDot.classList.toggle('off', disabled);
    await chrome.storage.local.set({ [disabledKey]: disabled });

    // Reload sivu jotta muutos astuu voimaan
    if (tab.id) {
      chrome.tabs.reload(tab.id);
    }
  });

  // Näytä oma sanalistta
  function renderWordList(words) {
    wordListEl.innerHTML = '';
    if (!words || words.length === 0) {
      wordListEl.innerHTML = '<div class="empty-words">Ei omia sanoja</div>';
      return;
    }

    for (const word of words.sort()) {
      const item = document.createElement('div');
      item.className = 'word-item';

      const wordSpan = document.createElement('span');
      wordSpan.textContent = word;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-word';
      removeBtn.textContent = '×';
      removeBtn.title = `Poista "${word}" sanalistasta`;
      removeBtn.addEventListener('click', async () => {
        const r = await chrome.storage.local.get('userWords');
        const newWords = (r.userWords || []).filter(w => w !== word);
        await chrome.storage.local.set({ userWords: newWords });
        renderWordList(newWords);
      });

      item.appendChild(wordSpan);
      item.appendChild(removeBtn);
      wordListEl.appendChild(item);
    }
  }

  renderWordList(result.userWords || []);
})();
