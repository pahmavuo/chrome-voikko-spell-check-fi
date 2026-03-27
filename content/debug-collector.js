// content/debug-collector.js
// Ajetaan chrome.scripting.executeScript:llä debuggausta varten.
// Kerää diagnostiikkatietoa sivun editoitavista elementeistä.

(function collectDebugInfo() {
  function frameInfo(doc, label) {
    const editables = [...doc.querySelectorAll('[contenteditable]')].map(el => ({
      tag: el.tagName,
      id: el.id || null,
      class: el.className?.slice(0, 60) || null,
      contenteditable: el.getAttribute('contenteditable'),
      isContentEditable: el.isContentEditable,
      hasShadowRoot: !!el.shadowRoot,
      rect: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(el.getBoundingClientRect()),
      outerHtmlPreview: el.outerHTML.slice(0, 200),
    }));

    const inputs = [...doc.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea')].map(el => ({
      tag: el.tagName,
      type: el.type || null,
      id: el.id || null,
      name: el.name || null,
      rect: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(el.getBoundingClientRect()),
    }));

    const iframes = [...doc.querySelectorAll('iframe')].map(iframe => {
      let accessible = false;
      let innerEditables = 0;
      try {
        innerEditables = iframe.contentDocument?.querySelectorAll('[contenteditable]').length ?? 0;
        accessible = true;
      } catch (e) {}
      return {
        src: iframe.src?.slice(0, 100) || null,
        id: iframe.id || null,
        sameOrigin: accessible,
        contentEditableCount: innerEditables,
      };
    });

    // Shadow DOM scan (vain 1 taso syvyys)
    const shadowHosts = [...doc.querySelectorAll('*')]
      .filter(el => el.shadowRoot)
      .map(el => ({
        tag: el.tagName,
        id: el.id || null,
        shadowEditables: el.shadowRoot.querySelectorAll('[contenteditable]').length,
      }));

    return { label, editables, inputs, iframes, shadowHosts };
  }

  const result = {
    url: location.href,
    title: document.title,
    voikkoLoaded: !!window.__voikkoSpellcheck,
    activeElement: {
      tag: document.activeElement?.tagName,
      isContentEditable: document.activeElement?.isContentEditable,
      id: document.activeElement?.id || null,
    },
    mainFrame: frameInfo(document, 'main'),
  };

  // Skannaa same-origin iframejen sisältö
  result.iframeFrames = [...document.querySelectorAll('iframe')].flatMap(iframe => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return [];
      return [frameInfo(doc, iframe.src?.slice(0, 80) || 'iframe')];
    } catch (e) {
      return [];
    }
  });

  return JSON.stringify(result, null, 2);
})();
