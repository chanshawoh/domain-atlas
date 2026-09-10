import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DevelopmentIdentity } from "../core/model.js";

const exec = promisify(execFile);

/** Configuration is a development-environment label, never proof of authorship. */
export async function readDevelopmentIdentity(
  root: string,
  capturePoint: DevelopmentIdentity["capturePoint"],
): Promise<DevelopmentIdentity | null> {
  async function config(key: string): Promise<string | undefined> {
    try {
      const { stdout } = await exec("git", ["config", "--get", key], { cwd: root });
      return stdout.trim() || undefined;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return undefined;
      throw error;
    }
  }
  const [name, email] = await Promise.all([config("user.name"), config("user.email")]);
  if (!name && !email) return null;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), source: "git-config", capturedAt: new Date().toISOString(), capturePoint };
}
