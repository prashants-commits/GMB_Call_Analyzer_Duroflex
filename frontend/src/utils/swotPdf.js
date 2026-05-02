// Shared "Download PDF" helper for SWOT report pages.
//
// Uses the browser's native print-to-PDF (window.print()) — zero deps, no
// rasterization, citations stay as live links in the saved PDF, and the
// browser handles all the page-break details. The page's own
// `@media print` CSS hides the buttons / nav / chrome so the PDF is clean.
//
// We temporarily set document.title before the print dialog so the
// browser-suggested filename matches the entity (Chrome / Edge use the
// title as the default). Title is restored after the dialog closes.

export function downloadSwotPdf({ scope, name, generatedAt }) {
  const safeName = sanitiseForFilename(name || 'SWOT');
  const dateStr = pdfDateString(generatedAt);
  const scopeLabel = scope === 'city' ? 'City' : 'Store';

  // Suggested filename: "SWOT - City - Bengaluru - 2026-05-02.pdf"
  const suggested = `SWOT - ${scopeLabel} - ${safeName}${dateStr ? ` - ${dateStr}` : ''}`;

  const previousTitle = document.title;
  document.title = suggested;

  // Restore the original page title after the print dialog closes.
  // Different browsers fire different events; both onafterprint and the
  // matchMedia('print') listener cover Chrome/Edge/Firefox/Safari reliably.
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
    window.removeEventListener('afterprint', restore);
    if (mql && mql.removeEventListener) {
      mql.removeEventListener('change', onMqlChange);
    }
  };
  const onMqlChange = (e) => { if (!e.matches) restore(); };
  const mql = window.matchMedia ? window.matchMedia('print') : null;
  window.addEventListener('afterprint', restore);
  if (mql && mql.addEventListener) mql.addEventListener('change', onMqlChange);

  // Defensive backstop in case neither event fires (rare on legacy browsers).
  setTimeout(restore, 60_000);

  window.print();
}

function sanitiseForFilename(s) {
  return String(s)
    .replace(/[\\/:*?"<>|]/g, ' ') // strip filesystem-illegal chars
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfDateString(iso) {
  if (!iso) {
    return new Date().toISOString().slice(0, 10);
  }
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}
