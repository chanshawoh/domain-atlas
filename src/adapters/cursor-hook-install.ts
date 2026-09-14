import { access, copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const events = ["beforeSubmitPrompt", "afterAgentResponse", "stop"] as const;
type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function isManaged(handler: unknown): boolean {
  return object(handler) && (handler.type === undefined || handler.type === "command") &&
    typeof handler.command === "string" && handler.command.endsWith(" cursor-hook --global");
}

export async function configureCursorHooks(options: {
  cliPath: string;
  nodePath?: string;
  cursorHome?: string;
  remove?: boolean;
  write?: boolean;
}) {
  const home = path.resolve(options.cursorHome ?? process.env.CURSOR_HOME ?? path.join(os.homedir(), ".cursor"));
  const file = path.join(home, "hooks.json");
  const command = `${shellQuote(path.resolve(options.nodePath ?? process.execPath))} ${shellQuote(path.resolve(options.cliPath))} cursor-hook --global`;
  if (!options.remove) {
    await access(path.resolve(options.cliPath));
    await access(path.resolve(options.nodePath ?? process.execPath), constants.X_OK);
  }

  async function prepare() {
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && !stat.isFile()) throw new Error("Refusing to replace a non-regular Cursor hooks file: " + file);
    const before = stat ? await readFile(file, "utf8") : null;
    const config: unknown = before === null ? {} : JSON.parse(before);
    if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) {
      throw new Error("Invalid Cursor hooks configuration: " + file);
    }
    const hooks = (config.hooks ?? {}) as JsonObject;
    for (const event of events) {
      const group = hooks[event] ?? [];
      if (!Array.isArray(group)) throw new Error("Invalid Cursor hook group: " + event);
      const retained = group.filter((handler) => !isManaged(handler));
      if (!options.remove) {
        retained.push({
          command,
          timeout: event === "stop" ? 180 : 60,
        });
      }
      if (retained.length || hooks[event] !== undefined) hooks[event] = retained;
    }
    if (config.version === undefined) config.version = 1;
    if (config.hooks !== undefined || Object.keys(hooks).length) config.hooks = hooks;
    const after = JSON.stringify(config, null, 2) + "\n";
    const changed = JSON.stringify(before === null ? {} : JSON.parse(before)) !== JSON.stringify(config);
    return { before, after, changed, mode: stat ? stat.mode & 0o777 : 0o600 };
  }

  if (!options.write) {
    const plan = await prepare();
    return { file, action: options.remove ? "remove" : "install", written: false,
      changed: plan.changed, ...(options.remove ? {} : { command }),
      notice: "Preview only. Repeat this command without --dry-run to apply." };
  }
  await mkdir(home, { recursive: true });
  const lockFile = file + ".domainatlas.lock";
  const lock = await open(lockFile, "wx", 0o600);
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    const plan = await prepare();
    if (!plan.changed) return { file, written: false, changed: false };
    const backup = plan.before === null ? undefined : file + ".domainatlas-" + randomUUID() + ".bak";
    if (backup) await copyFile(file, backup, constants.COPYFILE_EXCL);
    await writeFile(temporary, plan.after, { flag: "wx", mode: plan.mode });
    const current = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (current !== plan.before) throw new Error("Cursor hooks changed during installation; retry after reviewing the file");
    await rename(temporary, file);
    return { file, action: options.remove ? "remove" : "install", written: true, changed: true,
      ...(backup ? { backup } : {}),
      notice: "Review new or changed hooks in Cursor Settings → Hooks. User-level hooks do not run in Cloud Agents." };
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockFile);
  }
}
