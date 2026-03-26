// lib/text-utils.js
// Puhtaat apufunktiot — testattavissa ilman selainta tai Chrome-API:a

'use strict';

const MIN_WORD_LENGTH = 2;

/**
 * Pilkoo tekstin sanoiksi ja palauttaa sanojen sijainnit.
 * @param {string} text
 * @returns {{ word: string, start: number, end: number }[]}
 */
function extractWordPositions(text) {
  const results = [];
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

/**
 * Korvaa HTML-erikoismerkit entiteeteillä ja muuntaa rivinvaihdot <br>-tageiksi.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Escapoi HTML-attribuuttien arvot.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Rakentaa overlay-HTML:n tekstistä ja virhelistasta.
 * @param {string} text - Koko tekstialueen sisältö
 * @param {Map<string, string[]>} errorMap - sana → korjausehdotukset
 * @param {string} errorClass - CSS-luokka virheellisille sanoille
 * @returns {string} HTML-merkkijono
 */
function buildOverlayHtml(text, errorMap, errorClass) {
  const wordPositions = extractWordPositions(text);
  let html = '';
  let lastIndex = 0;

  for (const { word, start, end } of wordPositions) {
    html += escapeHtml(text.slice(lastIndex, start));

    if (errorMap.has(word)) {
      const suggestions = errorMap.get(word);
      const sugStr = suggestions.slice(0, 6).join('|');
      html += `<mark class="${errorClass}" data-word="${escapeAttr(word)}" data-suggestions="${escapeAttr(sugStr)}">${escapeHtml(word)}</mark>`;
    } else {
      html += escapeHtml(word);
    }
    lastIndex = end;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

module.exports = { extractWordPositions, escapeHtml, escapeAttr, buildOverlayHtml };
