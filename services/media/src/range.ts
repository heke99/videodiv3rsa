/**
 * HTTP range parsing.
 *
 * A browser scrubbing a video sends range requests constantly, and answering
 * them with the whole file makes the editor unusable on anything long. This is
 * the small amount of parsing that turns a byte store into something a video
 * element can seek in.
 */

export interface ByteRange {
  start: number;
  end: number;
  length: number;
}

export function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;

  if (rawStart === "") {
    // A suffix range asks for the last N bytes, which is how some players
    // read a container's trailing index.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;

  end = Math.min(end, size - 1);
  return { start, end, length: end - start + 1 };
}

export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}
