"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const EXERCISE_IMAGE_ACCEPT = ALLOWED_IMAGE_MIMES.join(",");
export const MAX_EXERCISE_IMAGE_BYTES = 10 * 1024 * 1024;

export type ExerciseImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export type SelectedExerciseImage = {
  file: File;
  previewUrl: string;
  declaredMime: ExerciseImageMime;
  byteLength: number;
};

export type ExerciseUploaderState =
  | "empty"
  | "selected"
  | "client_rejected"
  | "submitting";

type ValidationResult =
  | { ok: true; file: File; declaredMime: ExerciseImageMime }
  | { ok: false; message: string };

type ExerciseUploaderProps = {
  onAnalyze: (selection: SelectedExerciseImage) => void | Promise<void>;
  onSelectionChange?: (selection?: SelectedExerciseImage) => void;
  cleanupToken?: number;
  analyzeEnabled?: boolean;
  locked?: boolean;
};

function isAllowedImageMime(value: string): value is ExerciseImageMime {
  return ALLOWED_IMAGE_MIMES.some((mime) => mime === value);
}

export function validateExerciseImageFiles(files: File[]): ValidationResult {
  if (files.length !== 1) {
    return {
      ok: false,
      message: "Choose exactly one JPEG, PNG, or WebP image.",
    };
  }

  const [file] = files;
  if (!isAllowedImageMime(file.type)) {
    return {
      ok: false,
      message: "This format is not supported. Choose a JPEG, PNG, or WebP image.",
    };
  }
  if (file.size < 1) {
    return {
      ok: false,
      message: "This image is empty. Choose a non-empty JPEG, PNG, or WebP image.",
    };
  }
  if (file.size > MAX_EXERCISE_IMAGE_BYTES) {
    return {
      ok: false,
      message: "This image is larger than 10 MiB. Choose a smaller image.",
    };
  }

  return { ok: true, file, declaredMime: file.type };
}

function formatByteLength(byteLength: number) {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KiB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
}

export function ExerciseUploader({
  onAnalyze,
  onSelectionChange,
  cleanupToken = 0,
  analyzeEnabled = true,
  locked = false,
}: ExerciseUploaderProps) {
  const [state, setState] = useState<ExerciseUploaderState>("empty");
  const [selection, setSelection] = useState<SelectedExerciseImage>();
  const [error, setError] = useState<string>();
  const currentPreviewUrl = useRef<string | undefined>(undefined);
  const currentSelection = useRef<SelectedExerciseImage | undefined>(undefined);
  const selectionVersion = useRef(0);
  const previousCleanupToken = useRef(cleanupToken);
  const mounted = useRef(true);

  const revokeCurrentPreview = useCallback(() => {
    if (!currentPreviewUrl.current) return;
    URL.revokeObjectURL(currentPreviewUrl.current);
    currentPreviewUrl.current = undefined;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revokeCurrentPreview();
    };
  }, [revokeCurrentPreview]);

  const clearSelection = useCallback(() => {
    selectionVersion.current += 1;
    currentSelection.current = undefined;
    revokeCurrentPreview();
    setSelection(undefined);
    onSelectionChange?.(undefined);
  }, [onSelectionChange, revokeCurrentPreview]);

  useEffect(() => {
    if (previousCleanupToken.current === cleanupToken) return;
    previousCleanupToken.current = cleanupToken;
    selectionVersion.current += 1;
    currentSelection.current = undefined;
    revokeCurrentPreview();
    setSelection(undefined);
    setError(undefined);
    setState("empty");
  }, [cleanupToken, revokeCurrentPreview]);

  const rejectSelection = useCallback(
    (message: string) => {
      clearSelection();
      setError(message);
      setState("client_rejected");
    },
    [clearSelection],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const result = validateExerciseImageFiles(files);
      if (!result.ok) {
        rejectSelection(result.message);
        return;
      }

      revokeCurrentPreview();
      const previewUrl = URL.createObjectURL(result.file);
      currentPreviewUrl.current = previewUrl;
      const nextSelection = {
        file: result.file,
        previewUrl,
        declaredMime: result.declaredMime,
        byteLength: result.file.size,
      };
      selectionVersion.current += 1;
      currentSelection.current = nextSelection;
      setSelection(nextSelection);
      onSelectionChange?.(nextSelection);
      setError(undefined);
      setState("selected");
    },
    [onSelectionChange, rejectSelection, revokeCurrentPreview],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  };

  const handleCancel = () => {
    clearSelection();
    setError(undefined);
    setState("empty");
  };

  const handleAnalyze = async () => {
    if (!analyzeEnabled || !selection || state !== "selected") return;

    const analyzedVersion = selectionVersion.current;
    setError(undefined);
    setState("submitting");
    try {
      await onAnalyze(selection);
    } catch {
      if (!mounted.current || analyzedVersion !== selectionVersion.current) return;
      setError("Analysis could not be started. Your validated image is still selected.");
    } finally {
      if (
        mounted.current &&
        analyzedVersion === selectionVersion.current &&
        currentSelection.current
      ) {
        setState("selected");
      }
    }
  };

  return (
    <section
      className="spike photo-uploader workspace-card workspace-card-start"
      aria-labelledby="exercise-photo-title"
    >
      <div className="spike-heading">
        <div>
          <p className="section-index">Step 1 · Start here</p>
          <h2 id="exercise-photo-title">Show me your exercise</h2>
        </div>
        <p>
          A clear photo is enough. I&apos;ll read the question, then let you check
          what I understood.
        </p>
      </div>

      <div className="photo-uploader-grid">
        <div className="photo-picker">
          <div className="photo-dropzone" data-has-image={selection ? "true" : "false"}>
            <span className="photo-dropzone-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" role="presentation">
                <path d="M8 15.5h8l3-4h10l3 4h8v23H8z" />
                <circle cx="24" cy="27" r="7" />
              </svg>
            </span>
            <label htmlFor="exercise-photo-input">
              {selection ? "Choose a different photo" : "Take or choose a photo"}
            </label>
            <p>Use a bright, straight photo of the question.</p>
            <input
              id="exercise-photo-input"
              type="file"
              accept={EXERCISE_IMAGE_ACCEPT}
              capture="environment"
              aria-describedby="exercise-photo-help exercise-photo-state"
              aria-invalid={state === "client_rejected"}
              disabled={locked}
              onChange={handleChange}
            />
          </div>
          <p id="exercise-photo-help" className="photo-help">
            JPEG, PNG or WebP · 10 MB maximum
          </p>
          <p className="photo-privacy-notice">
            <span aria-hidden="true">●</span> Your photo is used only to read this
            exercise and is not saved by GeoTutor.
          </p>

          <p
            id="exercise-photo-state"
            className={`photo-state photo-state-${state}`}
            role="status"
            aria-live="polite"
            data-state={state}
          >
            {state === "empty" && "Waiting for your photo"}
            {state === "selected" && "Photo ready to read"}
            {state === "client_rejected" && "This photo cannot be used"}
            {state === "submitting" && "Reading your exercise…"}
          </p>
          {error ? (
            <p role="alert" className="photo-error">
              {error}
            </p>
          ) : null}

          <div className="photo-actions">
            <button
              type="button"
              disabled={
                locked || !analyzeEnabled || !selection || state !== "selected"
              }
              onClick={() => void handleAnalyze()}
            >
              Read my exercise
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={locked || !selection}
              onClick={handleCancel}
            >
              Remove photo
            </button>
          </div>
        </div>

        <div className="photo-preview" aria-label="Selected exercise image preview">
          {selection ? (
            <figure>
              {/* A local Object URL is the intended preview source for this client boundary. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selection.previewUrl} alt={`Preview of ${selection.file.name}`} />
              <figcaption>
                <strong>{selection.file.name}</strong>
                <span>{formatByteLength(selection.byteLength)}</span>
              </figcaption>
            </figure>
          ) : (
            <div className="photo-preview-empty">
              <span aria-hidden="true">AB</span>
              <p>Your exercise will appear here.</p>
              <small>Tip: keep the full question inside the frame.</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
