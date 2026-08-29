import { z } from "zod";

/**
 * Upload validation (spec section 76).
 *
 * Content type is decided by the file's own leading bytes, not by what the
 * client claims, because the declared type is attacker controlled and the
 * magic bytes are what every downstream tool will actually act on.
 */

export const MAX_UPLOAD_BYTES: Record<string, number> = {
  image: 32 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  audio: 256 * 1024 * 1024,
  voice_reference: 64 * 1024 * 1024,
};

const SIGNATURES: Array<{ mime: string; kind: string; test: (b: Uint8Array) => boolean }> = [
  { mime: "image/jpeg", kind: "image", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    kind: "image",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { mime: "image/webp", kind: "image", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" },
  // ISO base media: mp4, mov and m4a all carry "ftyp" at offset 4.
  { mime: "video/mp4", kind: "video", test: (b) => ascii(b, 4, 4) === "ftyp" },
  {
    mime: "video/webm",
    kind: "video",
    test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  { mime: "audio/wav", kind: "audio", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE" },
  {
    mime: "audio/mpeg",
    kind: "audio",
    test: (b) => (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) || ascii(b, 0, 3) === "ID3",
  },
  { mime: "audio/flac", kind: "audio", test: (b) => ascii(b, 0, 4) === "fLaC" },
];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

export interface DetectedType {
  mime: string;
  kind: string;
  extension: string;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/flac": "flac",
};

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

export function detectType(bytes: Uint8Array): DetectedType {
  if (bytes.length < 12) throw new UploadRejected("File is too small to be valid media");

  const match = SIGNATURES.find((s) => s.test(bytes));
  if (!match) {
    throw new UploadRejected("Unsupported file type. Accepted: JPEG, PNG, WebP, MP4, WebM, WAV, MP3, FLAC.");
  }
  return { mime: match.mime, kind: match.kind, extension: EXTENSIONS[match.mime]! };
}

/** A declared type that disagrees with the bytes is a signal, not a mistake. */
export function detectAndVerify(bytes: Uint8Array, declaredMime: string): DetectedType {
  const detected = detectType(bytes);
  if (declaredMime && declaredMime !== detected.mime) {
    throw new UploadRejected(`File claims to be ${declaredMime} but its contents are ${detected.mime}.`);
  }
  return detected;
}

export function checkSize(kind: string, bytes: number): void {
  const limit = MAX_UPLOAD_BYTES[kind];
  if (!limit) throw new UploadRejected(`Uploads of kind ${kind} are not accepted`);
  if (bytes > limit) {
    throw new UploadRejected(
      `File is ${(bytes / 1024 ** 2).toFixed(0)} MB; the limit for ${kind} is ` +
        `${(limit / 1024 ** 2).toFixed(0)} MB`,
    );
  }
}

/**
 * A display label derived from the user's filename. It is metadata only:
 * storage keys are content addressed, so nothing here ever reaches a path.
 */
export function sanitizeLabel(filename: string): string {
  const stripped = filename
    // Control characters, which terminals and log viewers interpret. Matching
    // them literally is the whole point, so the rule against it does not apply.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Path separators, so a label can never be read as a directory.
    .replace(/[\\/]/g, "-")
    .trim()
    .slice(0, 128);
  return stripped || "untitled";
}

export const UploadRequest = z.object({
  role: z.enum(["image", "product", "video", "audio", "voice_reference"]),
  filename: z.string().max(512),
  declared_mime: z.string().max(128).default(""),
  project_id: z.string().uuid().nullable().default(null),
});
