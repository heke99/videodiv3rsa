import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * That every container the compose file declares can actually start.
 *
 * Four of the six could not. `service.Dockerfile` ended `CMD ["node",
 * "dist/server.js"]` for every service, but only the API produced one: the
 * orchestrator builds a Temporal worker, and `gpu-manager`, `director` and
 * `render` were libraries with no process at all. `docker compose up`, the
 * README's documented way to run the stack, could not work -- and nothing
 * noticed, because building an image succeeds whether or not its command
 * exists.
 *
 * Reading the files is enough to catch that, and costs no CI minutes. The
 * failure mode this guards is a declaration and a build script disagreeing.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface ComposeFile {
  services: Record<string, { build?: { args?: Record<string, string> }; image?: string } | undefined>;
}

const compose = parse(readFileSync(path.join(ROOT, "infra/docker/compose.dev.yml"), "utf8")) as ComposeFile;

/** Services we build, as opposed to images we pull. */
const built = Object.entries(compose.services)
  .filter(([, service]) => service?.build)
  .map(([name, service]) => ({
    name,
    service: service!.build!.args?.["SERVICE"] ?? name,
    entrypoint: service!.build!.args?.["ENTRYPOINT_FILE"] ?? "server.js",
  }));

function packageJson(service: string): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(path.join(ROOT, "services", service, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
}

describe("the local stack can start", () => {
  it("builds something", () => {
    expect(built.length).toBeGreaterThan(0);
  });

  it.each(built)("$name builds the file its container runs", ({ service, entrypoint }) => {
    const build = packageJson(service).scripts?.["build"];
    expect(build, `services/${service} has no build script`).toBeDefined();

    // tsup names its output after each entry, so the entrypoint the Dockerfile
    // runs has to appear as an entry in the build script. This is the exact
    // check that was missing: `gpu-manager` built src/index.ts and its
    // container ran dist/server.js.
    const source = entrypoint.replace(/\.js$/, ".ts");
    expect(build, `services/${service} never builds ${entrypoint}`).toContain(`src/${source}`);
  });

  it.each(built)("$name has the source file it claims to build", ({ service, entrypoint }) => {
    const source = path.join(ROOT, "services", service, "src", entrypoint.replace(/\.js$/, ".ts"));
    expect(() => readFileSync(source, "utf8"), `${source} does not exist`).not.toThrow();
  });

  it("does not declare a container for a package that has no process", () => {
    // director, render and qc are libraries the API and orchestrator import
    // in-process; ARCHITECTURE.md has always described them that way. They had
    // compose entries that built an image whose command did not exist.
    const names = built.map((b) => b.service);
    expect(names).not.toContain("director");
    expect(names).not.toContain("render");
    expect(names).not.toContain("qc");
  });

  it("runs the media service, which local storage cannot do without", () => {
    // It is the thing that checks the signature on a signed local URL. Absent
    // from compose, every media link 404s on the one deployment shape that
    // needs it most.
    expect(built.map((b) => b.service)).toContain("media");
  });
});
