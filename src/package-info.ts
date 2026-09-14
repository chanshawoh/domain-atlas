import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function packageVersion(from = fileURLToPath(import.meta.url)): Promise<string> {
  let dir = path.dirname(from);
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (pkg.name === "domainatlas" && typeof pkg.version === "string" && pkg.version) return pkg.version;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Unable to determine DomainAtlas version");
}

export function isNpmInstalledCli(cliPath: string): boolean {
  const parts = path.resolve(cliPath).split(path.sep);
  const index = parts.lastIndexOf("node_modules");
  return index >= 0 && parts[index + 1] === "domainatlas";
}
