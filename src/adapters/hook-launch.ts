import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type HookHost = "codex" | "cursor";

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function hookCommand(value: string): string {
  const resolved = path.resolve(value);
  return /^[A-Za-z0-9._/-]+$/.test(resolved) ? resolved : shellQuote(resolved);
}

export function hookShimPath(home: string): string {
  return path.join(path.resolve(home), "domainatlas-hook");
}

export function hookShimScript(nodePath: string, cliPath: string, host: HookHost): string {
  return "#!/bin/sh\nexec " + shellQuote(path.resolve(nodePath)) + " " + shellQuote(path.resolve(cliPath)) +
    " hook " + host + " \"$@\"\n";
}

export function isManagedHookCommand(command: string, host: HookHost, shim: string): boolean {
  const file = path.resolve(shim);
  return command === hookCommand(file) || command === shellQuote(file) ||
    command.endsWith(" " + host + "-hook --global") ||
    command === "domainatlas hook " + host;
}

export async function syncHookShim(options: {
  home: string;
  host: HookHost;
  nodePath: string;
  cliPath: string;
  write?: boolean;
  remove?: boolean;
}): Promise<{ file: string; command: string; changed: boolean }> {
  const file = hookShimPath(options.home);
  const command = hookCommand(file);
  const existing = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (options.remove) {
    if (options.write && existing !== null) await rm(file);
    return { file, command, changed: existing !== null };
  }
  const body = hookShimScript(options.nodePath, options.cliPath, options.host);
  const changed = existing !== body;
  if (options.write && changed) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, { mode: 0o755 });
  }
  if (!options.remove && options.write) await access(file);
  return { file, command, changed };
}
