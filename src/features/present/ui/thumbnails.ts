// Slide thumbnails that render only when they scroll into view, so a library
// of long decks does not render hundreds of pages at once.

import { h } from '@sapphirelabs/ui/dom';
import { loadStoredPdf, renderPage } from '../pdf';

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const canvas = e.target as HTMLCanvasElement;
    observer.unobserve(canvas);
    const { file, page, w, hgt } = canvas.dataset;
    loadStoredPdf(file!).then((pdf) => renderPage(pdf, Number(page), canvas, Number(w), Number(hgt))).catch(() => {});
  }
}, { rootMargin: '200px' });

/** A canvas that will show `page` of the stored file, fitted in w × hgt CSS pixels. */
export function thumbnail(fileId: string, page: number, w: number, hgt: number): HTMLCanvasElement {
  const c = h('canvas', { 'data-file': fileId, 'data-page': page, 'data-w': w, 'data-hgt': hgt });
  observer.observe(c);
  return c;
}
