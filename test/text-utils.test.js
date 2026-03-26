'use strict';

const { extractWordPositions, escapeHtml, escapeAttr, buildOverlayHtml } = require('../lib/text-utils');

// --- extractWordPositions ---

describe('extractWordPositions', () => {
  test('palauttaa tyhjän taulukon tyhjälle merkkijonolle', () => {
    expect(extractWordPositions('')).toEqual([]);
  });

  test('löytää yksittäisen sanan', () => {
    const result = extractWordPositions('koira');
    expect(result).toEqual([{ word: 'koira', start: 0, end: 5 }]);
  });

  test('löytää useita sanoja oikeilla sijainneilla', () => {
    const result = extractWordPositions('kissa ja koira');
    expect(result.map(r => r.word)).toEqual(['kissa', 'ja', 'koira']);
    expect(result[0]).toMatchObject({ start: 0, end: 5 });
    expect(result[1]).toMatchObject({ start: 6, end: 8 });
    expect(result[2]).toMatchObject({ start: 9, end: 14 });
  });

  test('ohittaa alle 2-merkkiset sanat', () => {
    const result = extractWordPositions('a iso x talo');
    expect(result.map(r => r.word)).toEqual(['iso', 'talo']);
  });

  test('käsittelee skandit oikein', () => {
    const result = extractWordPositions('äiti ötökkä');
    expect(result.map(r => r.word)).toEqual(['äiti', 'ötökkä']);
  });

  test('käsittelee tavuviivan sanoissa', () => {
    const result = extractWordPositions('hyvin-vointi');
    expect(result[0].word).toBe('hyvin-vointi');
  });

  test('ei ota mukaan pelkkiä välimerkkejä tai numeroita', () => {
    const result = extractWordPositions('123 !! --');
    expect(result).toEqual([]);
  });

  test('löytää sanat tekstistä jossa on välimerkkejä', () => {
    const result = extractWordPositions('Hei, maailma!');
    expect(result.map(r => r.word)).toEqual(['Hei', 'maailma']);
  });

  test('sijainnit ovat oikein unicode-tekstissä', () => {
    const text = 'äiti on kotona';
    const result = extractWordPositions(text);
    for (const { word, start, end } of result) {
      expect(text.slice(start, end)).toBe(word);
    }
  });
});

// --- escapeHtml ---

describe('escapeHtml', () => {
  test('escapoi &-merkin', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('escapoi <-merkin', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  test('muuntaa rivinvaihdon <br>-tagiksi', () => {
    expect(escapeHtml('rivi1\nrivi2')).toBe('rivi1<br>rivi2');
  });

  test('ei muuta normaalia tekstiä', () => {
    expect(escapeHtml('koira juoksee')).toBe('koira juoksee');
  });

  test('käsittelee tyhjän merkkijonon', () => {
    expect(escapeHtml('')).toBe('');
  });
});

// --- escapeAttr ---

describe('escapeAttr', () => {
  test('escapoi lainausmerkit', () => {
    expect(escapeAttr('say "hello"')).toBe('say &quot;hello&quot;');
  });

  test('escapoi heittomerkit', () => {
    expect(escapeAttr("it's")).toBe('it&#39;s');
  });
});

// --- buildOverlayHtml ---

describe('buildOverlayHtml', () => {
  const ERROR_CLASS = 'voikko-err';

  test('palauttaa pelkän tekstin kun virheitä ei ole', () => {
    const html = buildOverlayHtml('koira juoksee', new Map(), ERROR_CLASS);
    expect(html).toBe('koira juoksee');
  });

  test('merkitsee virheellisen sanan mark-tagilla', () => {
    const errors = new Map([['koirra', ['koira', 'koiraa']]]);
    const html = buildOverlayHtml('koirra juoksee', errors, ERROR_CLASS);
    expect(html).toContain('<mark class="voikko-err"');
    expect(html).toContain('data-word="koirra"');
    expect(html).toContain('>koirra</mark>');
  });

  test('lisää korjausehdotukset data-suggestions-attribuuttiin', () => {
    const errors = new Map([['virhe', ['korjaus1', 'korjaus2']]]);
    const html = buildOverlayHtml('tässä on virhe', errors, ERROR_CLASS);
    expect(html).toContain('data-suggestions="korjaus1|korjaus2"');
  });

  test('rajoittaa ehdotukset kuuteen', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const errors = new Map([['virhe', suggestions]]);
    const html = buildOverlayHtml('virhe', errors, ERROR_CLASS);
    const attr = html.match(/data-suggestions="([^"]*)"/)?.[1] ?? '';
    expect(attr.split('|').length).toBe(6);
  });

  test('säilyttää tekstin sanojen ympärillä', () => {
    const errors = new Map([['koirra', ['koira']]]);
    const html = buildOverlayHtml('iso koirra juoksee', errors, ERROR_CLASS);
    expect(html.startsWith('iso ')).toBe(true);
    expect(html.endsWith(' juoksee')).toBe(true);
  });

  test('escapoi HTML-merkit tekstissä', () => {
    const html = buildOverlayHtml('tulos: <100', new Map(), ERROR_CLASS);
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<100');
  });

  test('käsittelee useita virheitä samassa tekstissä', () => {
    const errors = new Map([
      ['koirra', ['koira']],
      ['talko', ['talo']],
    ]);
    const html = buildOverlayHtml('koirra ja talko', errors, ERROR_CLASS);
    const marks = html.match(/<mark/g) ?? [];
    expect(marks.length).toBe(2);
  });

  test('sama sana useaan kertaan — molemmat merkitään', () => {
    const errors = new Map([['virhe', ['korjaus']]]);
    const html = buildOverlayHtml('virhe ja virhe', errors, ERROR_CLASS);
    const marks = html.match(/<mark/g) ?? [];
    expect(marks.length).toBe(2);
  });
});
