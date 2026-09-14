import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { configureCodexHooks, hasManagedCodexHooks } from "./adapters/codex-hook-install.js";
import { configureCursorHooks, hasManagedCursorHooks } from "./adapters/cursor-hook-install.js";
import { isNpmInstalledCli, packageVersion } from "./package-info.js";

const exec = promisify(execFile);
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type NpmRunner = (args: string[]) => Promise<string>;
export type HostName = "codex" | "cursor";
export type PackageAction = "install" | "unchanged" | "skipped-source" | "preview";
export type HostStatus = "updated" | "unchanged" | "absent" | "preview";

export type UpgradeHost = {
  name: HostName;
  status: HostStatus;
  file?: string;
};

export type UpgradeResult = {
  from: string;
  latest?: string;
  packageAction: PackageAction;
  hosts: UpgradeHost[];
  dryRun: boolean;
};

export function upgradeUsage(): string {
  return [
    "Usage: domainatlas upgrade [--dry-run] [--codex-home PATH] [--cursor-home PATH]",
    "",
    "Install the latest published domainatlas package when this CLI came from npm,",
    "then refresh host hooks that are already installed. Hosts without DomainAtlas",
    "hooks are left alone. Does not initialize the current project.",
    "",
    "      --dry-run          Preview without installing or writing hook files",
    "      --codex-home PATH  Override CODEX_HOME (default: ~/.codex when unset)",
    "      --cursor-home PATH Override CURSOR_HOME (default: ~/.cursor when unset)",
    "  -h, --help             Show this help",
    "",
    "Examples:",
    "  domainatlas upgrade",
    "  domainatlas upgrade --dry-run",
  ].join("\n");
}

export function formatUpgrade(result: UpgradeResult): string {
  const lines: string[] = [];
  if (result.packageAction === "install") {
    lines.push("Upgraded domainatlas from " + result.from + " to " + result.latest + ".");
  } else if (result.packageAction === "preview") {
    lines.push("Would upgrade domainatlas from " + result.from + " to " + result.latest + ".");
  } else if (result.packageAction === "unchanged") {
    lines.push("domainatlas " + result.from + " is already the latest version.");
  } else if (result.dryRun) {
    lines.push("This CLI is not an npm install; would skip package download and refresh host hooks for this build (" + result.from + ").");
  } else {
    lines.push("This CLI is not an npm install; skipped package download. Refreshing host hooks for this build (" + result.from + ").");
  }
  const present = result.hosts.filter((host) => host.status !== "absent");
  if (!present.length) {
    lines.push("No installed host hooks to update.");
  } else if (result.dryRun) {
    lines.push("Would refresh host hooks: " + present.map((host) => host.name).join(", ") + ".");
  } else if (present.every((host) => host.status === "unchanged")) {
    lines.push("Host hooks already current: " + present.map((host) => host.name).join(", ") + ".");
  } else {
    lines.push("Refreshed host hooks: " + present.map((host) => host.name).join(", ") + ".");
  }
  if (result.dryRun) lines.push("Preview only. Repeat this command without --dry-run to apply.");
  return lines.join("\n") + "\n";
}

export async function upgradeDomainAtlas(options: {
  cliPath: string;
  dryRun?: boolean;
  codexHome?: string;
  cursorHome?: string;
  npm?: NpmRunner;
}): Promise<UpgradeResult> {
  const from = await packageVersion(options.cliPath);
  const dryRun = !!options.dryRun;
  const installed = { codex: await hasManagedCodexHooks(options.codexHome), cursor: await hasManagedCursorHooks(options.cursorHome) };
  let latest: string | undefined;
  let packageAction: PackageAction = "skipped-source";
  let cliPath = path.resolve(options.cliPath);

  if (options.npm || isNpmInstalledCli(cliPath)) {
    const npm = options.npm ?? defaultNpm;
    latest = parseVersion(await npm(["view", "domainatlas", "version"]), "latest domainatlas version");
    if (newer(from, latest)) {
      packageAction = dryRun ? "preview" : "install";
      if (!dryRun) {
        await npm(["install", "-g", "domainatlas@" + latest]);
        const root = (await npm(["root", "-g"])).trim();
        if (!root) throw new Error("npm root -g returned an empty path");
        cliPath = path.join(root, "domainatlas", "dist", "src", "cli.js");
        await access(cliPath);
      }
    } else {
      packageAction = "unchanged";
    }
  }

  const hosts = await refreshHosts({ cliPath, dryRun, installed, codexHome: options.codexHome, cursorHome: options.cursorHome });
  return { from, latest, packageAction, hosts, dryRun };
}

async function refreshHosts(options: {
  cliPath: string;
  dryRun: boolean;
  installed: { codex: boolean; cursor: boolean };
  codexHome?: string;
  cursorHome?: string;
}): Promise<UpgradeHost[]> {
  const hosts: UpgradeHost[] = [];
  if (options.installed.codex) {
    const result = await configureCodexHooks({
      cliPath: options.cliPath, write: !options.dryRun, codexHome: options.codexHome,
    });
    hosts.push(hostResult("codex", result, options.dryRun));
  } else {
    hosts.push({ name: "codex", status: "absent" });
  }
  if (options.installed.cursor) {
    const result = await configureCursorHooks({
      cliPath: options.cliPath, write: !options.dryRun, cursorHome: options.cursorHome,
    });
    hosts.push(hostResult("cursor", result, options.dryRun));
  } else {
    hosts.push({ name: "cursor", status: "absent" });
  }
  return hosts;
}

function hostResult(name: HostName, result: { file: string; changed?: boolean }, dryRun: boolean): UpgradeHost {
  return { name, file: result.file, status: dryRun ? "preview" : result.changed ? "updated" : "unchanged" };
}

function parseVersion(text: string, label: string): string {
  const version = text.trim();
  if (!stable.test(version)) throw new Error("Invalid " + label + ": " + (version || "(empty)"));
  return version;
}

function newer(current: string, latest: string): boolean {
  if (!stable.test(current)) throw new Error("Invalid current domainatlas version: " + current);
  const left = current.split(".").map(BigInt);
  const right = latest.split(".").map(BigInt);
  const index = left.findIndex((value, offset) => value !== right[offset]);
  return index >= 0 && left[index] < right[index];
}

async function defaultNpm(args: string[]): Promise<string> {
  const timeout = args[0] === "install" ? 120_000 : 20_000;
  const { stdout } = await exec("npm", args, { timeout, encoding: "utf8" });
  return stdout;
}
