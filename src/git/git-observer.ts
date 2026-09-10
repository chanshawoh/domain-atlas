import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GitIdentity } from "../core/model.js";

const execFileAsync = promisify(execFile);

export type RecordLifecycle =
  | { state: "pending" }
  | { state: "committed"; commitSha: string; author: GitIdentity; committer: GitIdentity };

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
    if (!firstCommit) return { state: "pending" };
    const { stdout: identities } = await execFileAsync(
      "git", ["show", "-s", "--format=%an%x00%ae%x00%cn%x00%ce", firstCommit],
      { cwd: this.projectRoot },
    );
    const [authorName, authorEmail, committerName, committerEmail] = identities.trimEnd().split("\0");
    return {
      state: "committed", commitSha: firstCommit,
      author: { name: authorName, email: authorEmail },
      committer: { name: committerName, email: committerEmail },
    };
  }
}
