import { useState, useEffect, useCallback } from "react";
import "./AnswerSheetViewer.css";

/**
 * Renders one answer-sheet page image with bounding-box highlight
 * overlays, plus page navigation and zoom.
 *
 * ACCURACY NOTE (see Phase 5 spec section 8/31): highlight boxes are
 * positioned using CSS PERCENTAGES derived directly from each
 * boundingBox's normalized [0,1] x/y/width/height — never pixel math.
 * Because both the <img> and the overlay boxes live inside the same
 * relatively-positioned container, percentage-based positioning stays
 * correct automatically on resize AND under the zoom transform below
 * (a CSS `transform: scale()` on the shared container), with no resize
 * listeners or recalculation needed. This is deliberately simpler than
 * pixel-based positioning and cannot drift out of alignment.
 *
 * Props:
 *  - pages: [{ pageNumber, widthPx, heightPx, imageUrl }]
 *  - currentPage: number
 *  - onPageChange: (pageNumber) => void
 *  - highlights: [{ id, boundingBox: {x,y,width,height}|null, label, active }]
 *      only highlights whose boundingBox is non-null are drawn; the
 *      caller is responsible for filtering to the current page.
 */
function AnswerSheetViewer({ pages, currentPage, onPageChange, highlights }) {
  const [zoom, setZoom] = useState(1);
  const [imageError, setImageError] = useState(false);

  const page = pages.find((p) => p.pageNumber === currentPage) || null;
  const totalPages = pages.length;

  // Reset transient per-image state whenever the page actually changes.
  useEffect(() => {
    setImageError(false);
  }, [currentPage]);

  const goToPage = useCallback(
    (nextPage) => {
      if (nextPage < 1 || nextPage > totalPages) return;
      onPageChange(nextPage);
    },
    [onPageChange, totalPages]
  );

  const zoomIn = () => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))));
  const zoomOut = () => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))));
  const resetZoom = () => setZoom(1);

  const visibleHighlights = (highlights || []).filter((h) => h.boundingBox);
  const missingBboxCount = (highlights || []).length - visibleHighlights.length;

  return (
    <div className="viewer-root">
      <div className="viewer-toolbar">
        <div className="viewer-page-nav">
          <button
            type="button"
            className="viewer-btn"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            ← Previous
          </button>
          <span className="viewer-page-indicator">
            Page {totalPages === 0 ? 0 : currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="viewer-btn"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>

        <div className="viewer-zoom-controls">
          <button type="button" className="viewer-btn viewer-btn-icon" onClick={zoomOut} aria-label="Zoom out">
            −
          </button>
          <span className="viewer-zoom-indicator">{Math.round(zoom * 100)}%</span>
          <button type="button" className="viewer-btn viewer-btn-icon" onClick={zoomIn} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="viewer-btn" onClick={resetZoom} aria-label="Reset zoom">
            Reset
          </button>
        </div>
      </div>

      {missingBboxCount > 0 && (
        <div className="viewer-notice" role="status">
          Answer region could not be located precisely for {missingBboxCount === 1 ? "one part" : `${missingBboxCount} parts`} of this answer. The extracted text is still shown in the panel on the right.
        </div>
      )}

      <div className="viewer-scroll-area">
        {!page ? (
          <div className="viewer-empty">No page to display.</div>
        ) : (
          <div className="viewer-zoom-wrapper" style={{ transform: `scale(${zoom})` }}>
            <div className="viewer-page-container">
              {imageError ? (
                <div className="viewer-image-error">Page image unavailable.</div>
              ) : (
                <img
                  key={page.imageUrl}
                  src={page.imageUrl}
                  alt={`Answer sheet page ${page.pageNumber}`}
                  className="viewer-page-image"
                  onError={() => setImageError(true)}
                  draggable={false}
                />
              )}

              {!imageError &&
                visibleHighlights.map((h) => (
                  <div
                    key={h.id}
                    className={`viewer-highlight-box${h.active ? " viewer-highlight-active" : ""}`}
                    style={{
                      left: `${h.boundingBox.x * 100}%`,
                      top: `${h.boundingBox.y * 100}%`,
                      width: `${h.boundingBox.width * 100}%`,
                      height: `${h.boundingBox.height * 100}%`,
                    }}
                  >
                    {h.label && <span className="viewer-highlight-label">{h.label}</span>}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AnswerSheetViewer;
