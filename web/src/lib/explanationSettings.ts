import {
  DEFAULT_EXPLANATION_MODEL,
  ExplanationModelSchema,
  type ExplanationModel,
} from "@podsub/schemas";

const STORAGE_KEY = "explanationModel";

export function loadExplanationModel(): ExplanationModel {
  try {
    const saved = ExplanationModelSchema.safeParse(localStorage.getItem(STORAGE_KEY));
    if (saved.success) return saved.data;
  } catch {
    // Storage may be unavailable in private browsing.
  }
  return DEFAULT_EXPLANATION_MODEL;
}

export function saveExplanationModel(model: string): void {
  if (!ExplanationModelSchema.safeParse(model).success) return;
  try {
    localStorage.setItem(STORAGE_KEY, model);
  } catch {
    // Non-fatal; the default will be used on the next visit.
  }
}
