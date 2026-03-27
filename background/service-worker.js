// background/service-worker.js
// Lataa Voikko WASM kerran, vastaa content scriptin tarkistuspyyntöihin

let voikko = null;        // Voikko-instanssi (käyttäjädata: osoitin C-muistiin)
let libVoikko = null;     // Emscripten-moduuli
let initPromise = null;   // Varmistaa että init ajetaan vain kerran

// Exportatut C-funktiot Emscriptenin cwrap-wrappereina
let fnSpellCheck = null;
let fnSuggest = null;
let fnFreeCstrArray = null;

async function initVoikko() {
  if (voikko !== null) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[Voikko] Ladataan WASM-moduuli...');

    // importScripts on ainoa tapa ladata skripti service workerissa
    importScripts(chrome.runtime.getURL('voikko/libvoikko.js'));

    // LibVoikko on nyt globaalissa scopessa (EXPORT_NAME=LibVoikko)
    // Alustetaan moduuli — sanakirjat on pakattu libvoikko.data:aan
    libVoikko = await LibVoikko({
      locateFile: (filename) => chrome.runtime.getURL(`voikko/${filename}`)
    });

    // Luo cwrap-wrapperit C-funktioille
    fnSpellCheck = libVoikko.cwrap('voikkoSpellCstr', 'number', ['number', 'string']);
    fnSuggest = libVoikko.cwrap('voikkoSuggestCstr', 'number', ['number', 'string']);
    fnFreeCstrArray = libVoikko.cwrap('voikkoFreeCstrArray', null, ['number']);

    // Alusta Voikko suomelle
    // C-signatuuri: voikkoInit(const char **error, const char *langcode, const char *path)
    // Sanakirja on preloaded WASM-tiedostojärjestelmään polkuun /usr/lib/voikko
    const handle = libVoikko.ccall(
      'voikkoInit',
      'number',
      ['number', 'string', 'string'],
      [0, 'fi', '/usr/lib/voikko']
    );

    if (!handle) {
      throw new Error('[Voikko] voikkoInit epäonnistui — sanakirjaa ei löydy?');
    }

    voikko = handle;
    console.log('[Voikko] Alustettu onnistuneesti, handle:', handle);
  })();

  return initPromise;
}

function checkWords(words) {
  return words.map(word => {
    const correct = fnSpellCheck(voikko, word) === 1;
    let suggestions = [];

    if (!correct) {
      const sugPtr = fnSuggest(voikko, word);
      if (sugPtr) {
        // Lue C-taulukko null-terminoitujen merkkijonojen osoittimia
        let i = 0;
        while (true) {
          const strPtr = libVoikko.getValue(sugPtr + i * 4, 'i32');
          if (strPtr === 0) break;
          suggestions.push(libVoikko.UTF8ToString(strPtr));
          i++;
          if (i >= 10) break; // Rajoita max 10 ehdotukseen
        }
        fnFreeCstrArray(sugPtr);
      }
    }

    return { word, correct, suggestions };
  });
}

// Käynnistä Voikko heti service workerin käynnistyessä
initVoikko().catch(err => console.error('[Voikko] Init-virhe:', err));

// Lataa PNG-tiedosto ImageDataksi OffscreenCanvasin kautta.
// Tarvitaan koska chrome.action.setIcon({ path }) epäonnistuu
// service workerin käynnistysvaiheessa ("Failed to fetch").
async function loadImageData(filename, size) {
  const url = chrome.runtime.getURL(filename);
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, size, size);
  return canvas.getContext('2d').getImageData(0, 0, size, size);
}

// Päivitä ikoni vastaamaan globaalia tilaa
async function updateIcon() {
  const result = await chrome.storage.local.get('globalEnabled');
  const enabled = result.globalEnabled !== false;
  const prefix = enabled ? 'icons/icon' : 'icons/icon-off';

  try {
    const [img16, img32, img48] = await Promise.all([
      loadImageData(`${prefix}-16.png`, 16),
      loadImageData(`${prefix}-32.png`, 32),
      loadImageData(`${prefix}-48.png`, 48),
    ]);
    await chrome.action.setIcon({ imageData: { 16: img16, 32: img32, 48: img48 } });
  } catch (err) {
    console.warn('[Voikko] Ikonin päivitys epäonnistui:', err.message);
  }

  chrome.action.setTitle({
    title: enabled ? 'Suomen oikoluku — käytössä' : 'Suomen oikoluku — pois käytöstä'
  });
}

// Päivitä ikoni kun Chrome käynnistyy tai laajennus asennetaan
chrome.runtime.onStartup.addListener(updateIcon);
chrome.runtime.onInstalled.addListener(updateIcon);

// Kuuntele viestejä content scriptiltä
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_WORDS') {
    if (!voikko) {
      // Voikko ei vielä valmis — odota
      initVoikko()
        .then(() => sendResponse({ results: checkWords(msg.words) }))
        .catch(err => sendResponse({ error: err.message, results: [] }));
      return true; // Pidä kanava auki async-vastauksia varten
    }

    try {
      sendResponse({ results: checkWords(msg.words) });
    } catch (err) {
      console.error('[Voikko] Tarkistusvirhe:', err);
      sendResponse({ error: err.message, results: [] });
    }
    return false;
  }

  if (msg.type === 'PING') {
    sendResponse({ ready: voikko !== null });
    return false;
  }

  if (msg.type === 'SET_GLOBAL_ENABLED') {
    updateIcon();
    return false;
  }
});

// Kontekstivalikko: korjausehdotukset
// Valikkorakenne luodaan kerran käynnistyksessä. Contextmenu-hetkellä
// päivitetään vain otsikot update()-kutsulla (nopeampi kuin removeAll+create).
chrome.contextMenus.removeAll(() => {
  chrome.contextMenus.create({
    id: 'voikko-header',
    title: 'Voikko',
    contexts: ['editable'],
    enabled: false,
    visible: false
  });
  for (let i = 0; i < 6; i++) {
    chrome.contextMenus.create({
      id: `voikko-sug-${i}`,
      title: '-',
      contexts: ['editable'],
      visible: false
    });
  }
  chrome.contextMenus.create({
    id: 'voikko-separator',
    type: 'separator',
    contexts: ['editable'],
    visible: false
  });
  chrome.contextMenus.create({
    id: 'voikko-add-word',
    title: 'Lisää sanastoon',
    contexts: ['editable'],
    visible: false
  });
});

let currentSuggestions = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_CONTEXT_WORD') {
    currentSuggestions = msg.suggestions || [];
    updateContextMenu(msg.word, msg.suggestions);
    return false;
  }
});

function updateContextMenu(word, suggestions) {
  if (!word) {
    chrome.contextMenus.update('voikko-header', { visible: false });
    for (let i = 0; i < 6; i++) {
      chrome.contextMenus.update(`voikko-sug-${i}`, { visible: false });
    }
    chrome.contextMenus.update('voikko-separator', { visible: false });
    chrome.contextMenus.update('voikko-add-word', { visible: false });
    return;
  }

  const hasSuggestions = suggestions && suggestions.length > 0;

  chrome.contextMenus.update('voikko-header', {
    title: `Ehdotukset sanalle "${word}":`,
    visible: hasSuggestions
  });

  for (let i = 0; i < 6; i++) {
    if (hasSuggestions && i < suggestions.length) {
      chrome.contextMenus.update(`voikko-sug-${i}`, { title: suggestions[i], visible: true });
    } else {
      chrome.contextMenus.update(`voikko-sug-${i}`, { visible: false });
    }
  }

  chrome.contextMenus.update('voikko-separator', { visible: hasSuggestions });
  chrome.contextMenus.update('voikko-add-word', {
    title: `Lisää "${word}" sanalistaan`,
    visible: true
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId.startsWith('voikko-sug-')) {
    const idx = parseInt(info.menuItemId.replace('voikko-sug-', ''), 10);
    const suggestion = currentSuggestions[idx];
    console.log('[Voikko] Ehdotus valittu:', suggestion, '| idx:', idx, '| tabId:', tab.id);
    if (!suggestion) return;
    chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_SUGGESTION',
      suggestion
    }).then(() => console.log('[Voikko] APPLY_SUGGESTION lähetetty'))
      .catch(err => console.error('[Voikko] APPLY_SUGGESTION virhe:', err));
  } else if (info.menuItemId === 'voikko-add-word') {
    // Tallenna sana omaan sanalistaan
    chrome.tabs.sendMessage(tab.id, {
      type: 'GET_CONTEXT_WORD'
    }, (response) => {
      if (response && response.word) {
        addUserWord(response.word);
      }
    });
  }
});

async function addUserWord(word) {
  const result = await chrome.storage.local.get('userWords');
  const words = result.userWords || [];
  if (!words.includes(word)) {
    words.push(word);
    await chrome.storage.local.set({ userWords: words });
    console.log('[Voikko] Lisätty sanalistaan:', word);
  }
}
