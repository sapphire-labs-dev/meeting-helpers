import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getFile } from './files';

GlobalWorkerOptions.workerSrc = workerUrl;

export type Pdf = PDFDocumentProxy;

/** Largest PDF we import. Bigger files make pdf.js and the tab struggle. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** True when the first bytes are the PDF signature ("%PDF-"). */
export function isPdfHeader(head: ArrayBuffer): boolean {
  return String.fromCharCode(...new Uint8Array(head, 0, Math.min(5, head.byteLength))) === '%PDF-';
}

export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<Pdf> {
  // pdf.js takes ownership of the buffer, so give it a copy.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  // PDFs are untrusted input. pdf.js 6 never compiles code from them (no eval)
  // and runs no PDF JavaScript unless asked, so the page works under a CSP
  // without 'unsafe-eval'.
  return getDocument({ data: bytes }).promise;
}

const cache = new Map<string, Promise<Pdf>>();

/** Open a stored deck by file id (cached per page load). */
export function loadStoredPdf(fileId: string): Promise<Pdf> {
  let p = cache.get(fileId);
  if (!p) {
    p = getFile(fileId).then(async (blob) => {
      if (!blob) throw new Error('missing-file');
      return openPdf(await blob.arrayBuffer());
    });
    p.catch(() => cache.delete(fileId));
    cache.set(fileId, p);
  }
  return p;
}

/** Reuse a PDF that was just imported instead of parsing it again. */
export function rememberPdf(fileId: string, pdf: Pdf): void {
  cache.set(fileId, Promise.resolve(pdf));
}

const tasks = new WeakMap<HTMLCanvasElement, RenderTask>();

/**
 * Render a page into a canvas so it fits inside maxW × maxH CSS pixels,
 * sharp on high-DPI screens. Cancels any render still running on that canvas.
 */
export async function renderPage(pdf: Pdf, pageNum: number, canvas: HTMLCanvasElement, maxW: number, maxH: number): Promise<void> {
  tasks.get(canvas)?.cancel();
  const page = await pdf.getPage(Math.min(Math.max(1, pageNum), pdf.numPages));
  const base = page.getViewport({ scale: 1 });
  const cssScale = Math.max(0.05, Math.min(maxW / base.width, maxH / base.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: cssScale * dpr });
  const off = document.createElement('canvas');
  off.width = Math.floor(viewport.width);
  off.height = Math.floor(viewport.height);
  const task = page.render({ canvas: off, viewport });
  tasks.set(canvas, task);
  try {
    await task.promise;
  } catch (e) {
    if ((e as Error)?.name === 'RenderingCancelledException') return;
    throw e;
  }
  // Swap in the finished frame at once so the slide never flashes blank.
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  canvas.getContext('2d')!.drawImage(off, 0, 0);
}

/** First line of text on each page, used as a slide title hint. */
export async function extractTitles(pdf: Pdf): Promise<string[]> {
  const titles: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const first = content.items
        .map((it) => ('str' in it ? it.str.trim() : ''))
        .find((s) => s.length > 1);
      titles.push((first ?? '').slice(0, 80));
    } catch {
      titles.push('');
    }
  }
  return titles;
}
