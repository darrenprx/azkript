/* Shared page engine off the renderer thread. Metrics are measured here when available. */
'use strict';
importScripts('model.js', 'fdx.js', 'pagination.js');
self.onmessage = ({ data }) => {
  try {
    const options = { ...(data.options || {}) };
    if (options.measuredTypography && typeof OffscreenCanvas !== 'undefined') {
      const context = new OffscreenCanvas(1, 1).getContext('2d');
      const cache = new Map(); let activeFont = '';
      options.measureText = (text, spec) => {
        const font = `${spec.style || ''} ${spec.size || 12}pt ${JSON.stringify(spec.font || 'Courier New')}, "Courier New", monospace`.trim();
        const key = font + '\n' + text;
        if (cache.has(key)) return cache.get(key);
        if (activeFont !== font) { context.font = font; activeFont = font; }
        const width = context.measureText(text).width * 72 / 96;
        if (cache.size >= 12000) cache.delete(cache.keys().next().value);
        cache.set(key, width); return width;
      };
    }
    const result = FDPagination.layout(data.document, options);
    // The source XML and normalized model are already in the renderer. Avoid
    // copying the possibly large source tree back with every pagination result.
    delete result.normalized;
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error.message || String(error) }); }
};
