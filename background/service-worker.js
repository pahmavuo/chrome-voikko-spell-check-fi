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

    // Lataa Emscripten-generoitu libvoikko.js service workeriin
    const wasmUrl = chrome.runtime.getURL('voikko/libvoikko.js');
    await import(wasmUrl);

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
    // voikkoInit(language, path) — path null koska sanakirja on preloaded
    const errPtr = libVoikko._malloc(4);
    libVoikko.setValue(errPtr, 0, 'i32');
    const handle = libVoikko.ccall(
      'voikkoInit',
      'number',
      ['string', 'string'],
      ['fi', null]
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
});

// Kontekstivalikko: korjausehdotukset
// Content script lähettää sanan ennen oikean klikkauksen kontekstivalikkoa
let pendingSuggestions = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_CONTEXT_WORD') {
    // Päivitä kontekstivalikko ehdotuksilla
    updateContextMenu(msg.word, msg.suggestions);
    return false;
  }
});

function updateContextMenu(word, suggestions) {
  // Poista vanhat
  chrome.contextMenus.removeAll(() => {
    if (!suggestions || suggestions.length === 0) return;

    chrome.contextMenus.create({
      id: 'voikko-header',
      title: `Ehdotukset sanalle "${word}":`,
      contexts: ['editable'],
      enabled: false
    });

    suggestions.slice(0, 6).forEach((sug, i) => {
      chrome.contextMenus.create({
        id: `voikko-sug-${i}`,
        title: sug,
        contexts: ['editable']
      });
    });

    chrome.contextMenus.create({
      id: 'voikko-separator',
      type: 'separator',
      contexts: ['editable']
    });

    chrome.contextMenus.create({
      id: 'voikko-add-word',
      title: `Lisää "${word}" sanalistaan`,
      contexts: ['editable']
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId.startsWith('voikko-sug-')) {
    // Lähetä korjaus content scriptille
    chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_SUGGESTION',
      suggestion: info.menuItemTitle
    });
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
