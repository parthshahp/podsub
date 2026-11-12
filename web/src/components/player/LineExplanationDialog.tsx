import { memo, useEffect, useRef, useState } from "react";
import {
  EXPLANATION_MODEL_OPTIONS,
  type ExplanationModel,
  type LineExplanation,
} from "@podsub/schemas";

import { api } from "../../api";
import { formatClock } from "../../lib/format";

type Props = {
  episodeId: string;
  lineIndex: number;
  text: string;
  start: number;
  model: ExplanationModel;
  invoker: HTMLButtonElement;
  onClose: () => void;
};

type Result =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: LineExplanation };

export const LineExplanationDialog = memo(function LineExplanationDialog({
  episodeId,
  lineIndex,
  text,
  start,
  model,
  invoker,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<Result>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const modelLabel =
    EXPLANATION_MODEL_OPTIONS.find((option) => option.value === model)?.label.replace(
      " (default)",
      "",
    ) ?? model;

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (invoker.isConnected) invoker.focus({ preventScroll: true });
    };
  }, [invoker]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await api.api.episodes[":id"].explanation.$post(
          {
            param: { id: episodeId },
            json: { lineIndex, text, model },
          },
          { init: { signal: controller.signal } },
        );
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || "error" in data) {
          throw new Error("error" in data ? data.error : "Could not explain this line.");
        }
        setResult({ status: "ready", data });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({
            status: "error",
            message: error instanceof Error ? error.message : "Could not explain this line.",
          });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [episodeId, lineIndex, text, model, attempt]);

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-bottom sm:modal-middle"
      aria-labelledby="line-explanation-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-box max-h-[85dvh] w-full max-w-2xl border border-base-300">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="line-explanation-title" className="text-lg font-semibold">
              Translate & explain
            </h2>
            <p className="mt-1 text-xs text-base-content/60">
              {formatClock(start)} · {modelLabel}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-circle min-h-11 min-w-11"
            aria-label="Close explanation"
            onClick={onClose}
            autoFocus
          >
            ✕
          </button>
        </div>

        <blockquote className="my-5 border-l-2 border-primary pl-4 text-lg leading-relaxed break-words">
          {text}
        </blockquote>

        {result.status === "loading" ? (
          <p role="status" className="flex items-center gap-3 py-6 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            Translating and explaining…
          </p>
        ) : result.status === "error" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-error">
              {result.message}
            </p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setResult({ status: "loading" });
                setAttempt((previous) => previous + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-5 text-sm leading-relaxed break-words" aria-live="polite">
            <section aria-labelledby="line-translation-heading">
              <h3 id="line-translation-heading" className="mb-1 font-semibold">
                English translation
              </h3>
              <p className="whitespace-pre-wrap">{result.data.translation}</p>
            </section>
            {result.data.explanation ? (
              <section aria-labelledby="line-meaning-heading">
                <h3 id="line-meaning-heading" className="mb-1 font-semibold">
                  Meaning & usage
                </h3>
                <p className="whitespace-pre-wrap">{result.data.explanation}</p>
              </section>
            ) : null}
            {result.data.phrases.length > 0 && (
              <section aria-labelledby="line-phrases-heading">
                <h3 id="line-phrases-heading" className="mb-2 font-semibold">
                  Useful expressions
                </h3>
                <dl className="space-y-3">
                  {result.data.phrases.map((phrase, index) => (
                    <div key={index}>
                      <dt className="font-medium">{phrase.phrase}</dt>
                      <dd className="whitespace-pre-wrap text-base-content/70">{phrase.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        )}
        <p className="mt-6 text-xs text-base-content/50">AI explanations can make mistakes.</p>
      </div>
    </dialog>
  );
});
