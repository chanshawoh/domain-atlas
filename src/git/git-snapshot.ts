import { execFile } from "node:child_process";
import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { FileChange, FileVersion } from "../core/model.js";

export type GitSnapshot = Record<string, FileVersion>;

export function git(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["--literal-pathspecs", ...args],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15_000 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(input);
  });
}

export async function gitRoot(cwd: string): Promise<string> {
  return realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
}

export function isLedgerPath(file: string): boolean {
  return file === ".domainatlas" || file.startsWith(".domainatlas/");
}

export function versionAt(snapshot: GitSnapshot, file: string): FileVersion | null {
  return Object.hasOwn(snapshot, file) ? snapshot[file] : null;
}

export function sameVersion(left: FileVersion | null, right: FileVersion | null): boolean {
  return left?.oid === right?.oid && left?.mode === right?.mode;
}

export async function indexSnapshot(root: string): Promise<GitSnapshot> {
  const snapshot: GitSnapshot = Object.create(null);
  for (const entry of (await git(root, ["ls-files", "--stage", "-z"])).split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const [mode, oid, stage] = entry.slice(0, tab).split(" ");
    if (stage !== "0") throw new Error("Resolve Git index conflicts before recording or staging");
    snapshot[entry.slice(tab + 1)] = { oid, mode };
  }
  return snapshot;
}

export async function headSnapshot(root: string): Promise<GitSnapshot> {
  const snapshot: GitSnapshot = Object.create(null);
  // An unborn branch has no HEAD. Other Git failures must remain visible.
  if (!(await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch((error) => {
    if (error.code === 1) return "";
    throw error;
  })).trim()) return snapshot;
  for (const entry of (await git(root, ["ls-tree", "-rz", "HEAD"])).split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const [mode, , oid] = entry.slice(0, tab).split(" ");
    snapshot[entry.slice(tab + 1)] = { oid, mode };
  }
  return snapshot;
}

export async function worktreeSnapshot(root: string): Promise<GitSnapshot> {
  const snapshot = await indexSnapshot(root);
  const changed = (await git(root, ["diff", "--name-only", "--no-renames", "-z", "--"]))
    + (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  for (const file of new Set(changed.split("\0").filter(Boolean))) {
    if (isLedgerPath(file)) continue;
    const absolute = path.join(root, file);
    const stat = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    if (!stat) { delete snapshot[file]; continue; }
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error("Unsupported changed Git entry (for example a submodule): " + file);
    }
    const oid = stat.isSymbolicLink()
      ? await git(root, ["hash-object", "--stdin"], await readlink(absolute))
      : await git(root, ["hash-object", "--path=" + file, "--", file]);
    snapshot[file] = { oid: oid.trim(), mode: stat.isSymbolicLink() ? "120000" : (stat.mode & 0o111) ? "100755" : "100644" };
  }
  for (const file of Object.keys(snapshot).filter(isLedgerPath)) delete snapshot[file];
  return snapshot;
}

export function snapshotChanges(before: GitSnapshot, after: GitSnapshot): FileChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((file) => !isLedgerPath(file) && !sameVersion(versionAt(before, file), versionAt(after, file)))
    .map((file) => ({ path: file, before: versionAt(before, file), after: versionAt(after, file) }));
}
