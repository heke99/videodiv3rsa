import { describe, expect, it } from "vitest";
import { UploadRejected, checkSize, detectAndVerify, detectType, sanitizeLabel } from "@videoai/api";

/**
 * Upload validation (spec section 76).
 *
 * An upload is the one place a user's bytes enter the system, so these tests
 * are about what happens when those bytes lie: a declared type that disagrees
 * with the content, a filename carrying path separators, a file too small to
 * be media at all.
 */

function bytes(...values: number[]): Uint8Array {
  const out = new Uint8Array(16);
  out.set(values);
  return out;
}

function withAscii(offset: number, text: string): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  return out;
}

describe("content type detection", () => {
  it("identifies a JPEG from its leading bytes", () => {
    expect(detectType(bytes(0xff, 0xd8, 0xff)).mime).toBe("image/jpeg");
  });

  it("identifies a PNG from its leading bytes", () => {
    expect(detectType(bytes(0x89, 0x50, 0x4e, 0x47)).mime).toBe("image/png");
  });

  it("identifies an MP4 from its ftyp box", () => {
    expect(detectType(withAscii(4, "ftyp")).kind).toBe("video");
  });

  it("distinguishes WAV from WebP, which share a RIFF header", () => {
    const wav = withAscii(0, "RIFF");
    for (let i = 0; i < 4; i++) wav[8 + i] = "WAVE".charCodeAt(i);
    expect(detectType(wav).mime).toBe("audio/wav");

    const webp = withAscii(0, "RIFF");
    for (let i = 0; i < 4; i++) webp[8 + i] = "WEBP".charCodeAt(i);
    expect(detectType(webp).mime).toBe("image/webp");
  });

  it("rejects a file whose bytes match nothing we accept", () => {
    expect(() => detectType(bytes(0x00, 0x01, 0x02, 0x03))).toThrow(UploadRejected);
  });

  it("rejects a file too small to be media", () => {
    expect(() => detectType(new Uint8Array(4))).toThrow(/too small/);
  });

  it("rejects an executable renamed to look like an image", () => {
    // ELF magic. A client claiming image/png does not make it one.
    expect(() => detectAndVerify(bytes(0x7f, 0x45, 0x4c, 0x46), "image/png")).toThrow(UploadRejected);
  });

  it("rejects content that disagrees with its declared type", () => {
    expect(() => detectAndVerify(bytes(0xff, 0xd8, 0xff), "video/mp4")).toThrow(
      /claims to be/,
    );
  });

  it("accepts content that matches its declared type", () => {
    expect(detectAndVerify(bytes(0xff, 0xd8, 0xff), "image/jpeg").extension).toBe("jpg");
  });
});

describe("size limits", () => {
  it("accepts a file inside its limit", () => {
    expect(() => checkSize("image", 1024)).not.toThrow();
  });

  it("rejects a file over its limit with the limit named", () => {
    expect(() => checkSize("image", 64 * 1024 * 1024)).toThrow(/the limit for image is 32 MB/);
  });

  it("rejects a kind we do not accept at all", () => {
    expect(() => checkSize("executable", 1)).toThrow(/not accepted/);
  });
});

describe("filename handling", () => {
  it("strips path separators so a label can never read as a directory", () => {
    expect(sanitizeLabel("../../etc/passwd")).not.toContain("/");
  });

  it("strips control characters, which terminals and log viewers interpret", () => {
    expect(sanitizeLabel("holiday\u0007video.mp4")).toBe("holidayvideo.mp4");
  });

  it("caps length so a label cannot be used to bloat a row", () => {
    expect(sanitizeLabel("a".repeat(500)).length).toBe(128);
  });

  it("falls back to a placeholder rather than an empty label", () => {
    expect(sanitizeLabel("   ")).toBe("untitled");
  });

  it("keeps an ordinary filename readable", () => {
    expect(sanitizeLabel("Summer Campaign v2.mp4")).toBe("Summer Campaign v2.mp4");
  });
});
