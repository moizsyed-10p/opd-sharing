import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export { pdfjsLib };

export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Finds the bounding box of the document/receipt in a photo by comparing
 * pixel luminance against the background sampled from the four corners.
 * Falls back to the full canvas if no clear content region is found.
 */
export function detectDocumentBounds(canvas: HTMLCanvasElement): Bounds {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, width, height);

  const lumAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  const corners = [
    lumAt(0, 0), lumAt(width - 1, 0),
    lumAt(0, height - 1), lumAt(width - 1, height - 1),
  ];
  const bg = corners.reduce((s, v) => s + v, 0) / corners.length;
  const threshold = 28;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 300));

  let minX = width, maxX = 0, minY = height, maxY = 0;

  for (let y = 0; y < height; y += step) {
    let count = 0;
    for (let x = 0; x < width; x += step) {
      if (Math.abs(lumAt(x, y) - bg) > threshold) count++;
    }
    if (count > (width / step) * 0.05) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  for (let x = 0; x < width; x += step) {
    let count = 0;
    for (let y = 0; y < height; y += step) {
      if (Math.abs(lumAt(x, y) - bg) > threshold) count++;
    }
    if (count > (height / step) * 0.05) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  if (minX >= maxX || minY >= maxY) {
    return { x: 0, y: 0, width, height };
  }

  const pad = Math.round(Math.min(width, height) * 0.015);
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x, y,
    width: Math.min(width - x, maxX - minX + pad * 2),
    height: Math.min(height - y, maxY - minY + pad * 2),
  };
}

/** Resizes+re-encodes an already-drawn canvas to a compressed JPEG blob. */
export function canvasToCompressedJpeg(
  canvas: HTMLCanvasElement,
  maxDimension = 1800,
  quality = 0.8
): Promise<Blob> {
  let { width, height } = canvas;
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")!.drawImage(canvas, 0, 0, width, height);
  return new Promise((resolve) => out.toBlob((b) => resolve(b!), "image/jpeg", quality));
}

/**
 * Renders each page of a PDF, auto-crops to the detected document bounds,
 * compresses to JPEG, and rebuilds a new PDF from the resulting images.
 */
export async function cropAndCompressPdf(pdfBytes: ArrayBuffer): Promise<Blob> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const outDoc = await PDFDocument.create();

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const bounds = detectDocumentBounds(canvas);
    const cropped = document.createElement("canvas");
    cropped.width = bounds.width;
    cropped.height = bounds.height;
    cropped.getContext("2d")!.drawImage(
      canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height
    );

    const jpegBlob = await canvasToCompressedJpeg(cropped);
    const jpegBytes = await jpegBlob.arrayBuffer();
    const image = await outDoc.embedJpg(jpegBytes);
    const outPage = outDoc.addPage([image.width, image.height]);
    outPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const bytes = await outDoc.save();
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/**
 * Rasterizes every page of a PDF at the given scale/quality and rebuilds it —
 * a compression-only pass (no cropping), used for the final merged download.
 */
async function rasterizePdf(pdfBytes: Uint8Array, scale: number, quality: number): Promise<Uint8Array> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const outDoc = await PDFDocument.create();

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", quality)
    );
    const bytes = await blob.arrayBuffer();
    const image = await outDoc.embedJpg(bytes);
    const outPage = outDoc.addPage([image.width, image.height]);
    outPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  return outDoc.save();
}

/**
 * Iteratively re-rasterizes a merged PDF at falling quality/scale until it
 * fits under maxBytes, returning the smallest attempt achieved if it never does.
 */
export async function compressPdfToMaxSize(
  pdfBytes: Uint8Array,
  maxBytes: number
): Promise<Uint8Array> {
  if (pdfBytes.byteLength <= maxBytes) return pdfBytes;

  const scaleLevels = [1.5, 1.2, 1.0, 0.8];
  const qualityLevels = [0.7, 0.55, 0.4, 0.28, 0.18];

  let smallest = pdfBytes;
  for (const scale of scaleLevels) {
    for (const quality of qualityLevels) {
      const attempt = await rasterizePdf(pdfBytes, scale, quality);
      if (attempt.byteLength < smallest.byteLength) smallest = attempt;
      if (attempt.byteLength <= maxBytes) return attempt;
    }
  }
  return smallest;
}
