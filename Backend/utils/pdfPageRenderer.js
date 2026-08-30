/**
 * Renders every page of a PDF buffer into a raster image buffer.
 *
 * DEPENDENCY CHOICE (documented per Phase 2 instructions before adding
 * anything new):
 *
 *   package.json before this change had NO PDF rendering capability at
 *   all — only "@google/generative-ai" for vision calls, and "multer"
 *   for uploads. Something has to turn PDF pages into raster images
 *   because:
 *     (a) each page must be sent to Gemini Vision independently, and
 *     (b) bounding boxes need known pixel dimensions, and
 *     (c) Phase 5 will eventually need to display these page images.
 *
 *   Options considered:
 *     - pdf-poppler / pdf2pic (wrap Poppler/GraphicsMagick+Ghostscript):
 *       require SYSTEM binaries outside of npm — not guaranteed present
 *       on Render, rejected per "avoid native system binaries".
 *     - node-canvas ("canvas" npm package): needs system Cairo/Pango
 *       dev libraries at install time — same problem, rejected.
 *     - pdfjs-dist (Mozilla's PDF.js, pure JS, no native code) +
 *       @napi-rs/canvas (a <canvas>-compatible implementation shipped
 *       as PREBUILT native npm binaries, no system packages/compiler
 *       required at install time — this is the standard modern
 *       replacement for node-canvas in serverless/PaaS environments
 *       like Render). CHOSEN: simplest option that still avoids
 *       requiring the deployment host to have system libraries
 *       pre-installed.
 *
 *   These two packages are declared in package.json but — because this
 *   sandbox has no network access — could NOT be `npm install`-ed or
 *   live-tested here. The orchestration logic (page loop, sequential
 *   processing, buffer handling) was verified with a mocked pdfjs/
 *   canvas implementation; see the Phase 2 final report for details.
 *   Run `npm install` before deploying/using this file for real.
 */

// Loaded lazily (only when a PDF is actually uploaded) so that plain
// image uploads never pay the cost of loading the PDF engine.
function loadPdfJs() {
  try {
    // The "legacy" build is the CommonJS/Node-compatible entry point
    // (the default build assumes a browser DOM, which Node lacks).
    return require("pdfjs-dist/legacy/build/pdf.js");
  } catch (err) {
    throw new Error(
      "pdfjs-dist is not installed. Run `npm install` in Backend/ to enable PDF processing."
    );
  }
}

function loadCanvas() {
  try {
    return require("@napi-rs/canvas");
  } catch (err) {
    throw new Error(
      "@napi-rs/canvas is not installed. Run `npm install` in Backend/ to enable PDF processing."
    );
  }
}

// Render scale: pdf.js page units are 72 DPI ("1.0" scale). A scale of
// 2.0 (~144 DPI) gives Gemini enough resolution to read handwriting
// without producing unnecessarily huge buffers. This value directly
// determines widthPx/heightPx, which downstream bounding-box
// normalization treats as the coordinate system's pixel dimensions.
const RENDER_SCALE = 2.0;

/**
 * Renders every page of a PDF into a PNG buffer.
 *
 * @param {Buffer} buffer - raw PDF file bytes
 * @returns {Promise<Array<{pageNumber:number, buffer:Buffer, widthPx:number, heightPx:number}>>}
 *   pageNumber is 1-indexed, in document order.
 */
async function renderPdfToImages(buffer) {
  const pdfjsLib = loadPdfJs();
  const { createCanvas } = loadCanvas();

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDocument = await loadingTask.promise;

  const pageCount = pdfDocument.numPages;
  console.log(`📄 [pdfPageRenderer] ${pageCount} page(s) detected in PDF`);

  const renderedPages = [];

  // Sequential (not Promise.all) — never holds more than one page's
  // raster buffer in memory at a time (see Phase 2 memory requirement).
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    console.log(`📄 [pdfPageRenderer] Rendering page ${pageNumber}/${pageCount}`);

    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const widthPx = Math.round(viewport.width);
    const heightPx = Math.round(viewport.height);

    const canvas = createCanvas(widthPx, heightPx);
    const context = canvas.getContext("2d");

    await page.render({ canvasContext: context, viewport }).promise;

    const pngBuffer = await canvas.encode("png");

    renderedPages.push({ pageNumber, buffer: pngBuffer, widthPx, heightPx });

    // Release this page's resources before rendering the next one.
    page.cleanup();
  }

  await pdfDocument.destroy();

  return renderedPages;
}

module.exports = { renderPdfToImages, RENDER_SCALE };
