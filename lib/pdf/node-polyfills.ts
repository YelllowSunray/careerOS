import { DOMMatrix, Image, ImageData, Path2D } from "@napi-rs/canvas";

let applied = false;

/** Browser globals required by pdfjs-dist / pdf-parse in Node.js. */
export function applyPdfJsNodePolyfills(): void {
  if (applied) return;
  applied = true;

  const g = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    Path2D?: typeof Path2D;
    ImageData?: typeof ImageData;
    Image?: typeof Image;
  };

  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix as typeof g.DOMMatrix;
  if (!g.Path2D) g.Path2D = Path2D as typeof g.Path2D;
  if (!g.ImageData) g.ImageData = ImageData as typeof g.ImageData;
  if (!g.Image) g.Image = Image as typeof g.Image;
}
