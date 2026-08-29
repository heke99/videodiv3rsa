/**
 * Rendering a value that came back as `unknown`.
 *
 * Both apps display rows the API returns as loose records, and putting one
 * straight into JSX renders "[object Object]" for anything that is not already
 * a string. That is a worse outcome than showing nothing, because it looks
 * like data. This is the one conversion, and it declines rather than guesses.
 */
export function text(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}
