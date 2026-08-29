/**
 * Display formatting.
 *
 * Frames and samples are the truth; these turn them into something readable
 * and are never sent back to the server as timing.
 */

export function framesToClock(frames: number, fpsNum: number, fpsDen: number): string {
  const totalSeconds = (frames * fpsDen) / fpsNum;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function framesToSecondsLabel(frames: number, fpsNum: number, fpsDen: number): string {
  return `${((frames * fpsDen) / fpsNum).toFixed(1)}s`;
}

export function relativeTime(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const MODE_LABELS: Record<string, string> = {
  PREVIEW: "Preview",
  STANDARD: "Standard",
  REALISTIC: "Realistic",
  UGC: "UGC",
  CINEMATIC: "Cinematic",
  PRODUCT: "Product",
  AVATAR: "Talking / Avatar",
  ULTRA: "Ultra",
};

/** Modes offered on the Create screen, in the order the spec presents them. */
export const CREATE_MODES = ["REALISTIC", "UGC", "CINEMATIC", "PRODUCT", "AVATAR"] as const;

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  planning: "Planning",
  generating: "Generating",
  review: "Needs review",
  completed: "Ready",
  archived: "Archived",
  failed: "Failed",
};
