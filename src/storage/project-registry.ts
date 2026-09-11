import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { createStableId } from "../core/model.js";

const exec = promisify(execFile);
const projectSchema = z.object({ schemaVersion: z.literal(1), id: z.string().regex(/^project_[a-f0-9]{16}$/), root: z.string().refine(path.isAbsolute) });
export interface RegisteredProject {
  id: string; name: string; root: string; status: "available" | "unavailable"; message?: string;
}
export interface ProjectDirectory { projects: RegisteredProject[]; warnings: string[] }
export const registryHome = () => path.resolve(process.env.DOMAINATLAS_HOME || path.join(os.homedir(), ".domainatlas"));

export async function findGitRoot(directory: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: directory, timeout: 10_000 });
    return await realpath(stdout.trim());
  } catch (error) {
    if ((error as { code?: number | string }).code === 128 || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function isInitialized(root: string): Promise<boolean> {
  try {
    const directory = await lstat(path.join(root, ".domainatlas"));
    const file = await lstat(path.join(root, ".domainatlas/config.json"));
    if (!directory.isDirectory() || !file.isFile()) throw new Error("项目事实目录或配置必须是本地普通文件");
    const config = JSON.parse(await readFile(path.join(root, ".domainatlas/config.json"), "utf8"));
    if (config?.schemaVersion !== 1 || config.storage !== "immutable-json-files") throw new Error("DomainAtlas 项目配置无效");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Register only an already initialized Git root. Never initializes or changes project facts. */
export async function registerProject(directory: string, home = registryHome()): Promise<string | null> {
  const root = await realpath(directory);
  if (!await isInitialized(root)) return null;
  if (await findGitRoot(root) !== root) throw new Error("只能登记 Git 仓库根目录：" + root);
  const id = createStableId("project", [root]);
  const folder = path.join(home, "projects");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, id + ".json");
  const content = JSON.stringify({ schemaVersion: 1, id, root }, null, 2) + "\n";
  try { if (await readFile(file, "utf8") === content) return id; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
  return id;
}

async function readEntry(id: string, home: string) {
  if (!/^project_[a-f0-9]{16}$/.test(id)) return null;
  const file = path.join(home, "projects", id + ".json");
  try {
    if (!(await lstat(file)).isFile()) throw new Error("项目登记必须是普通文件");
    const entry = projectSchema.parse(JSON.parse(await readFile(file, "utf8")));
    if (entry.id !== id || createStableId("project", [entry.root]) !== id) throw new Error("项目登记 ID 无效");
    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function availableRoot(root: string): Promise<void> {
  if (await realpath(root) !== root) throw new Error("项目路径已发生变化，请在新位置重新执行 domainatlas init");
  if (!await isInitialized(root)) throw new Error("项目配置已移除，请重新执行 domainatlas init");
  if (await findGitRoot(root) !== root) throw new Error("项目 Git 仓库不可用");
}

export async function resolveProject(id: string, home = registryHome()): Promise<string | null> {
  const entry = await readEntry(id, home);
  if (!entry) return null;
  await availableRoot(entry.root);
  return entry.root;
}

export async function listProjects(home = registryHome()): Promise<ProjectDirectory> {
  const entries = await readdir(path.join(home, "projects")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const result: ProjectDirectory = { projects: [], warnings: [] };
  for (const filename of entries.filter(file => file.endsWith(".json")).sort()) {
    try {
      const entry = await readEntry(filename.slice(0, -5), home);
      if (!entry) { result.warnings.push("无效项目登记：" + filename); continue; }
      const project: RegisteredProject = { id: entry.id, name: path.basename(entry.root), root: entry.root, status: "available" };
      try { await availableRoot(entry.root); }
      catch (error) { project.status = "unavailable"; project.message = (error as Error).message; }
      result.projects.push(project);
    } catch { result.warnings.push("无法读取项目登记：" + filename); }
  }
  result.projects.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
  return result;
}

/** Explicit migration of legacy init directories, bounded and without following directory symlinks. */
export async function discoverProjects(directory: string, home = registryHome(), maxDirectories = 10_000) {
  const pending = [await realpath(directory)];
  const ids = new Set<string>();
  const warnings: string[] = [];
  let visited = 0;
  const excluded = new Set(["node_modules", "vendor", "dist", "build", "coverage", "Library", "Temp", "obj", "bin"]);
  while (pending.length && visited < maxDirectories) {
    const root = pending.pop()!;
    visited++;
    try {
      const id = await registerProject(root, home);
      if (id) ids.add(id);
    } catch (error) { warnings.push(root + ": " + (error as Error).message); }
    try {
      const children = await readdir(root, { withFileTypes: true });
      for (const entry of children.sort((a, b) => b.name.localeCompare(a.name))) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name)) pending.push(path.join(root, entry.name));
      }
    } catch (error) { warnings.push(root + ": " + (error as Error).message); }
  }
  if (pending.length) warnings.push("已达到目录扫描上限，请对剩余子目录单独使用 --scan");
  return { registered: ids.size, visited, warnings };
}
