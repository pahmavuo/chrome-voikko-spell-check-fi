# chrome-spell-check-fi

Chrome-laajennus suomenkieliselle paikalliselle oikoluvulle.
Käyttää Voikko-kirjastoa (WASM) — ei lähetä tekstiä verkkoon.

## Riippuvuudet

### JavaScript-testit

Vaatii Node.js (LTS, esim. 22.x):

```bash
npm install
npm test
```

### Voikko WASM -buildi

Apt-paketit:

```bash
sudo apt install git make autoconf automake libtool pkg-config voikko-fi
```

Emscripten SDK:

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install latest
~/emsdk/emsdk activate latest
source ~/emsdk/emsdk_env.sh   # tarvitaan joka kerta ennen buildia
```

### Laajennus selaimeen

Ei erillisiä riippuvuuksia — pelkkä Chrome riittää.

## Build

### 1. Voikko WASM (tarvitaan kerran)

```bash
source ~/emsdk/emsdk_env.sh
./build/build-voikko.sh
```

Tulostaa: `voikko/libvoikko.js`, `voikko/libvoikko.wasm`, `voikko/libvoikko.data`

### 2. Laajennus

Ei erillistä build-vaihetta — suora JavaScript.

## Kehitys

1. Avaa `chrome://extensions/`
2. Ota "Kehittäjätila" päälle
3. Klikkaa "Lataa pakkaamaton laajennus" → valitse tämä hakemisto
4. Mene sivulle jossa on textarea, kirjoita suomea virheillä
5. Väärin kirjoitetut sanat alleviivautuvat punaisella
6. Klikkaa hiiren oikealla alleviivatun sanan päällä → ehdotukset kontekstivalikossa

## Arkkitehtuuri

- **background/service-worker.js** — Lataa Voikko WASM kerran muistiin, vastaa content scriptin tarkistuspyyntöihin
- **content/spellcheck.js** — DOM-integraatio: tunnistaa editoitavat elementit, luo overlayit textarea/input-elementeille, injektoi span-tageja contenteditable-elementteihin
- **styles/spellcheck.css** — Virhemerkintöjen tyyli (punainen aaltoviiva)
- **voikko/** — Käännetty libvoikko (ei gitissä, generoidaan build-skriptillä)
- **build/build-voikko.sh** — Emscripten build-skripti Voikko WASM:n kääntämiseen

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

- Google Docs, Notion, ja muut rich text -editorit joilla on oma DOM-rakenne: ei tueta
- Shadow DOM: ei tueta
- Chromen oma oikoluku jätetään päälle — molemmat voivat olla aktiivisia samaan aikaan

## Lisenssi

GPL v3 tai uudempi — katso [LICENSE](LICENSE).
