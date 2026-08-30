import { useDropzone } from "react-dropzone";
import "./FileUploadCard.css";

const ACCEPT = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

const MAX_SIZE_BYTES = 20 * 1024 * 1024;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileType(file) {
  if (file.type === "application/pdf") return "PDF";
  if (file.type === "image/jpeg") return "JPEG";
  if (file.type === "image/png") return "PNG";
  return file.type || "Unknown";
}

/**
 * A single labeled upload slot — used twice on the assessment upload
 * screen (question paper, answer sheet). Controlled: the selected File
 * lives in the parent's state (Assessment.jsx), not here, so the
 * "Process Assessment" button can know about both files at once.
 *
 * Files are only staged here — nothing is uploaded until the parent
 * explicitly starts the assessment, consistent with the existing app's
 * Upload.jsx/Form.jsx pattern.
 */
function FileUploadCard({ label, file, onSelect, onRemove, disabled }) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    accept: ACCEPT,
    maxSize: MAX_SIZE_BYTES,
    maxFiles: 1,
    disabled: disabled || !!file,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles[0]) onSelect(acceptedFiles[0]);
    },
  });

  const rejectionError = fileRejections?.[0]?.errors?.[0]?.message;

  return (
    <div className="fu-card">
      <div className="fu-card-label">{label}</div>

      {file ? (
        <div className="fu-file-row">
          <div className="fu-file-info">
            <span className="fu-file-icon" aria-hidden="true">
              📄
            </span>
            <div className="fu-file-meta">
              <span className="fu-file-name" title={file.name}>
                {file.name}
              </span>
              <span className="fu-file-sub">
                {formatFileType(file)} · {formatFileSize(file.size)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="fu-remove-btn"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            disabled={disabled}
          >
            Remove
          </button>
        </div>
      ) : (
        <div
          {...getRootProps({
            className: `fu-dropzone${isDragActive ? " fu-dropzone-active" : ""}`,
          })}
        >
          <input {...getInputProps()} />
          <span className="fu-upload-icon" aria-hidden="true">
            📤
          </span>
          <p className="fu-dropzone-text">Drag & drop or click to upload</p>
          <small className="fu-dropzone-hint">PDF, JPG, JPEG, or PNG · Max 20MB</small>
        </div>
      )}

      {rejectionError && <p className="fu-error">{rejectionError}</p>}
    </div>
  );
}

export default FileUploadCard;
