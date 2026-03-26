#!/usr/bin/env bash
# build-voikko.sh — Kääntää libvoikko WebAssembly:ksi Chrome-laajennusta varten
#
# Vaatimukset:
#   - Emscripten SDK aktivoituna (source ~/emsdk/emsdk_env.sh)
#   - git, make, autoconf, automake, libtool, pkg-config
#   - voikko-fi ja libvoikko-dev asennettu (sudo apt install voikko-fi libvoikko-dev)
#
# Käyttö:
#   source ~/emsdk/emsdk_env.sh
#   ./build/build-voikko.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/tmp"
OUTPUT_DIR="$PROJECT_DIR/voikko"

COREVOIKKO_REPO="https://github.com/voikko/corevoikko.git"

# Järjestelmän voikko-fi sanakirja (asennettu apt:lla)
SYSTEM_DICT_DIR="/usr/lib/voikko"

# Tarkista Emscripten
if ! command -v emcc &>/dev/null; then
  echo "VIRHE: emcc ei löydy. Aktivoi Emscripten SDK:"
  echo "  source ~/emsdk/emsdk_env.sh"
  exit 1
fi

# Tarkista sanakirja
if [ ! -d "$SYSTEM_DICT_DIR" ]; then
  echo "VIRHE: Voikko-sanakirjaa ei löydy ($SYSTEM_DICT_DIR)"
  echo "  Asenna: sudo apt install voikko-fi"
  exit 1
fi

echo "=== Emscripten versio ==="
emcc --version | head -1

echo "=== Sanakirja ==="
ls -la "$SYSTEM_DICT_DIR/5/mor-standard/"

mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

# --- 1. Kloonaa corevoikko (libvoikko-lähde) ---
if [ ! -d "$BUILD_DIR/corevoikko" ]; then
  echo "=== Kloonataan corevoikko ==="
  git clone --depth=1 "$COREVOIKKO_REPO" "$BUILD_DIR/corevoikko"
else
  echo "=== corevoikko jo olemassa, ohitetaan kloonaus ==="
fi

# --- 2. Käännä libvoikko Emscriptenillä ---
LIBVOIKKO_SRC="$BUILD_DIR/corevoikko/libvoikko"

echo "=== Konfiguroidaan libvoikko Emscriptenille ==="
cd "$LIBVOIKKO_SRC"

# Puhdista edellinen käännös jos olemassa
if [ -f "Makefile" ]; then
  make distclean 2>/dev/null || true
fi

autoreconf -fi

# Emscripten-käännös — poistetaan tarpeettomat riippuvuudet
emconfigure ./configure \
  --disable-shared \
  --enable-static \
  --disable-hfst \
  --disable-java \
  --host=wasm32-unknown-emscripten

# Rakennetaan vain kirjasto (src/), ei command-line työkaluja (src/tools/)
emmake make -j"$(nproc)" -C src

echo "=== Linkitetään WASM-binääri ==="

EXPORTED_FUNCTIONS='["_voikkoInit","_voikkoTerminate","_voikkoSpellCstr","_voikkoSuggestCstr","_voikkoFreeCstrArray","_voikkoFreeCstr","_malloc","_free"]'

emcc \
  "$LIBVOIKKO_SRC/.libs/libvoikko.a" \
  -o "$OUTPUT_DIR/libvoikko.js" \
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","setValue","getValue"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s ENVIRONMENT=worker \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=LibVoikko \
  --preload-file "$SYSTEM_DICT_DIR@/usr/lib/voikko" \
  -O2

echo ""
echo "=== Build valmis! ==="
echo "Tulostiedostot:"
ls -lh "$OUTPUT_DIR"/libvoikko.*
echo ""
echo "Seuraavaksi:"
echo "  1. Avaa chrome://extensions/"
echo "  2. Ota kehittäjätila päälle"
echo "  3. Klikkaa 'Lataa pakkaamaton laajennus' → $PROJECT_DIR"
