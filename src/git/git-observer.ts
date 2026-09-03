import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RecordLifecycle =
  | { state: "pending" }
  | { state: "committed"; commitSha: string };

function assertRelativeRecordPath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error("Record path must stay inside the project: " + relativePath);
  }
}

export class GitObserver {
  constructor(private readonly projectRoot: string) {}

  async resolveRecordLifecycle(relativeRecordPath: string): Promise<RecordLifecycle> {
    assertRelativeRecordPath(relativeRecordPath);
    const { stdout: insideWorkTree } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: this.projectRoot },
    );
    if (insideWorkTree.trim() !== "true") {
      throw new Error("DomainAtlas project root is not a Git work tree");
    }
    try {
      await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: this.projectRoot,
      });
    } catch {
      return { state: "pending" };
    }

    const { stdout } = await execFileAsync(
      "git",
      ["log", "--reverse", "--diff-filter=A", "--format=%H", "--", relativeRecordPath],
      { cwd: this.projectRoot },
    );
    const firstCommit = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
    return firstCommit
      ? { state: "committed", commitSha: firstCommit }
      : { state: "pending" };
  }
}
