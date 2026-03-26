# chrome-spell-check-fi

Chrome-laajennus suomenkieliselle paikalliselle oikoluvulle.
Käyttää Voikko-kirjastoa (WASM) — ei lähetä tekstiä verkkoon.

## Arkkitehtuuri

- **background/service-worker.js** — Lataa Voikko WASM kerran muistiin, vastaa content scriptin tarkistuspyyntöihin
- **content/spellcheck.js** — DOM-integraatio: tunnistaa editoitavat elementit, luo overlayit textarea/input-elementeille, injektoi span-tageja contenteditable-elementteihin
- **styles/spellcheck.css** — Virhemerkintöjen tyyli (punainen aaltoviiva)
- **voikko/** — Käännetty libvoikko (ei gitissä, generoidaan build-skriptillä)
- **build/build-voikko.sh** — Emscripten build-skripti Voikko WASM:n kääntämiseen

## Build

### 1. Voikko WASM (tarvitaan kerran)

```bash
./build/build-voikko.sh
```

Vaatimukset:
- Emscripten SDK (`emsdk`): https://emscripten.org/docs/getting_started/downloads.html
- `git`, `make`, `autoconf`, `automake`, `pkg-config`

Tulostaa: `voikko/libvoikko.js`, `voikko/libvoikko.wasm`, `voikko/libvoikko.data`

### 2. Laajennus

Ei erillistä build-vaihetta — suora JavaScript.

## Testaus kehitysvaiheessa

1. Avaa `chrome://extensions/`
2. Ota "Kehittäjätila" päälle
3. Klikkaa "Lataa pakkaamaton laajennus" → valitse tämä hakemisto
4. Mene jollekin sivulle jossa on textarea (esim. kirjoita jotain)
5. Kirjoita suomea virheillä → väärin kirjoitetut sanat alleviivautuvat punaisella
6. Klikkaa hiiren oikealla alleviivatun sanan päällä → ehdotukset kontekstivalikossa

## Viestintä background ↔ content script

```
content script → background:
  { type: 'CHECK_WORDS', words: ['koirra', 'talo'] }

background → content script:
  { results: [
    { word: 'koirra', correct: false, suggestions: ['koira', 'koiraa'] },
    { word: 'talo', correct: true, suggestions: [] }
  ]}
```

## Tunnetut rajoitukset

- Google Docs, Notion, ja muut rich text -editorit joilla on oma DOM-rakenne: ei tueta MVP:ssä
- Shadow DOM: ei tueta
- Chromen oma oikoluku jätetään päälle — molemmat voivat olla aktiivisia samaan aikaan
