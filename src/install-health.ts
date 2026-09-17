import { access, lstat, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureCodexHooks } from "./adapters/codex-hook-install.js";
import { configureCursorHooks } from "./adapters/cursor-hook-install.js";
import { hookCommand, hookShimPath, hookShimScript, isManagedHookCommand } from "./adapters/hook-launch.js";
import { isNpmInstalledCli, packageVersion } from "./package-info.js";
import { findGitRoot } from "./storage/project-registry.js";

export type HostName = "codex" | "cursor";
export type IssueCode = "invalid-config" | "unreadable" | "legacy-command" | "path-command" |
  "missing-shim" | "stale-shim" | "broken-target" | "orphan-shim";

export type HealthIssue = { code: IssueCode; message: string; fixable: boolean };
export type HostHealth = {
  name: HostName;
  home: string;
  hooksFile: string;
  installed: boolean;
  command?: string;
  shim: string;
  issues: HealthIssue[];
};
export type ProjectHealth = { root?: string; status: "initialized" | "uninitialized" | "invalid" | "not-git" };
export type InstallHealth = {
  version: string;
  install: "npm" | "source";
  cliPath: string;
  nodePath: string;
  hosts: HostHealth[];
  project: ProjectHealth;
};

const marker = "DomainAtlas: 全局业务记录";
const cursorEvents = ["beforeSubmitPrompt", "afterAgentResponse", "stop"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function hostHome(name: HostName, override?: string): string {
  if (name === "codex") return path.resolve(override ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
  return path.resolve(override ?? process.env.CURSOR_HOME ?? path.join(os.homedir(), ".cursor"));
}

export function statusUsage(): string {
  return [
    "Usage: domainatlas status [--codex-home PATH] [--cursor-home PATH]",
    "",
    "Show the CLI install, host hook status, and repairable problems.",
    "Does not write files or initialize a project.",
    "",
    "      --codex-home PATH  Override CODEX_HOME (default: ~/.codex when unset)",
    "      --cursor-home PATH Override CURSOR_HOME (default: ~/.cursor when unset)",
    "  -h, --help             Show this help",
  ].join("\n");
}

export function doctorUsage(): string {
  return [
    "Usage: domainatlas doctor [--dry-run] [--codex-home PATH] [--cursor-home PATH]",
    "",
    "Repair broken or outdated DomainAtlas host hook installs. Rewrites already-",
    "installed Codex/Cursor launchers and hook entries. Does not install hooks for",
    "hosts that were never configured, initialize a project, or download npm packages.",
    "",
    "      --dry-run          Preview repairs without writing files",
    "      --codex-home PATH  Override CODEX_HOME (default: ~/.codex when unset)",
    "      --cursor-home PATH Override CURSOR_HOME (default: ~/.cursor when unset)",
    "  -h, --help             Show this help",
    "",
    "Examples:",
    "  domainatlas doctor",
    "  domainatlas doctor --dry-run",
  ].join("\n");
}

export async function inspectInstall(options: {
  cliPath: string;
  nodePath?: string;
  cwd?: string;
  codexHome?: string;
  cursorHome?: string;
}): Promise<InstallHealth> {
  const cliPath = path.resolve(options.cliPath);
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const version = await packageVersion(cliPath);
  return {
    version,
    install: isNpmInstalledCli(cliPath) ? "npm" : "source",
    cliPath,
    nodePath,
    hosts: [
      await inspectHost("codex", hostHome("codex", options.codexHome), nodePath, cliPath),
      await inspectHost("cursor", hostHome("cursor", options.cursorHome), nodePath, cliPath),
    ],
    project: await inspectProject(options.cwd ?? process.cwd()),
  };
}

export function formatStatus(health: InstallHealth): string {
  const lines = [
    "domainatlas " + health.version + " (" + health.install + ")",
    "Node: " + health.nodePath,
    "CLI:  " + health.cliPath,
    "",
  ];
  for (const host of health.hosts) {
    if (!host.installed && !host.issues.length) {
      lines.push(host.name + "  not installed");
      continue;
    }
    const label = host.installed ? "installed" : "not installed";
    if (!host.issues.length) {
      lines.push(host.name + "  " + label + "  " + host.hooksFile);
      continue;
    }
    lines.push(host.name + "  " + label + "  " + host.hooksFile);
    for (const issue of host.issues) lines.push("  " + (issue.fixable ? "error" : "blocked") + ": " + issue.message);
  }
  lines.push("");
  if (health.project.status === "initialized") lines.push("project  initialized  " + health.project.root);
  else if (health.project.status === "invalid") lines.push("project  invalid configuration  " + health.project.root);
  else if (health.project.status === "uninitialized") lines.push("project  not initialized  " + health.project.root);
  else lines.push("project  not a Git repository");
  const problems = health.hosts.flatMap((host) => host.issues);
  lines.push("");
  lines.push(problems.length ? problems.length + " issue(s). Run domainatlas doctor to repair." : "No hook issues found.");
  return lines.join("\n") + "\n";
}

export function formatDoctor(result: { health: InstallHealth; dryRun: boolean; repaired: HostName[]; skipped: string[] }): string {
  const lines: string[] = [];
  if (result.dryRun) {
    if (result.repaired.length) lines.push("Would repair: " + result.repaired.join(", ") + ".");
    else lines.push("No repairable hook issues.");
  } else if (result.repaired.length) {
    lines.push("Repaired: " + result.repaired.join(", ") + ".");
  } else {
    lines.push("No repairable hook issues.");
  }
  for (const skip of result.skipped) lines.push("Skipped: " + skip);
  if (result.dryRun) lines.push("Preview only. Repeat this command without --dry-run to apply.");
  return lines.join("\n") + "\n";
}

export async function repairInstall(options: {
  cliPath: string;
  nodePath?: string;
  dryRun?: boolean;
  cwd?: string;
  codexHome?: string;
  cursorHome?: string;
}): Promise<{ health: InstallHealth; dryRun: boolean; repaired: HostName[]; skipped: string[] }> {
  const dryRun = !!options.dryRun;
  const health = await inspectInstall(options);
  const repaired: HostName[] = [];
  const skipped: string[] = [];
  for (const host of health.hosts) {
    const blocked = host.issues.filter((issue) => !issue.fixable);
    const fixable = host.issues.filter((issue) => issue.fixable);
    if (blocked.length) {
      skipped.push(host.name + " (" + blocked.map((issue) => issue.code).join(", ") + ")");
      continue;
    }
    if (!fixable.length) continue;
    if (!dryRun) {
      if (host.installed) {
        if (host.name === "codex") {
          await configureCodexHooks({ cliPath: options.cliPath, nodePath: options.nodePath, codexHome: host.home, write: true });
        } else {
          await configureCursorHooks({ cliPath: options.cliPath, nodePath: options.nodePath, cursorHome: host.home, write: true });
        }
      } else if (fixable.some((issue) => issue.code === "orphan-shim")) {
        await rm(host.shim, { force: true });
      }
    }
    repaired.push(host.name);
  }
  return { health: dryRun ? health : await inspectInstall(options), dryRun, repaired, skipped };
}

async function inspectProject(cwd: string): Promise<ProjectHealth> {
  const root = await findGitRoot(cwd);
  if (!root) return { status: "not-git" };
  const file = path.join(root, ".domainatlas/config.json");
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return { root, status: "uninitialized" };
  try {
    const config = JSON.parse(raw) as { schemaVersion?: unknown; storage?: unknown };
    if (config.schemaVersion === 1 && config.storage === "immutable-json-files") return { root, status: "initialized" };
  } catch { /* Invalid JSON is reported as invalid configuration. */ }
  return { root, status: "invalid" };
}

async function inspectHost(name: HostName, home: string, nodePath: string, cliPath: string): Promise<HostHealth> {
  const hooksFile = path.join(home, "hooks.json");
  const shim = hookShimPath(home);
  const report: HostHealth = { name, home, hooksFile, installed: false, shim, issues: [] };
  const raw = await readFile(hooksFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    report.issues.push({ code: "unreadable", message: "Cannot read " + hooksFile + ": " + error.message, fixable: false });
    return undefined;
  });
  if (raw === undefined) return finish(report, nodePath, cliPath);
  if (raw === null) return finish(report, nodePath, cliPath);
  let commands: string[] | null;
  try {
    commands = managedCommands(name, JSON.parse(raw), shim);
  } catch {
    report.issues.push({ code: "invalid-config", message: "Invalid hooks configuration: " + hooksFile, fixable: false });
    return finish(report, nodePath, cliPath);
  }
  if (commands === null) {
    report.issues.push({ code: "invalid-config", message: "Invalid hooks configuration: " + hooksFile, fixable: false });
    return finish(report, nodePath, cliPath);
  }
  report.installed = commands.length > 0;
  report.command = commands[0];
  if (report.installed) {
    const expected = hookCommand(shim);
    if (commands.some((command) => command.endsWith(" " + name + "-hook --global"))) {
      report.issues.push({ code: "legacy-command", message: "Hook command still uses a pinned Node/CLI path", fixable: true });
    }
    if (commands.some((command) => command === "domainatlas hook " + name)) {
      report.issues.push({ code: "path-command", message: "Hook command relies on PATH to find domainatlas", fixable: true });
    }
    if (commands.some((command) => command !== expected) && !report.issues.length) {
      report.issues.push({ code: "legacy-command", message: "Hook command does not use the DomainAtlas launcher", fixable: true });
    }
  }
  return finish(report, nodePath, cliPath);
}

async function finish(report: HostHealth, nodePath: string, cliPath: string): Promise<HostHealth> {
  const shimStat = await lstat(report.shim).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (report.installed) {
    if (shimStat === null) {
      report.issues.push({ code: "missing-shim", message: "Hook launcher is missing: " + report.shim, fixable: true });
    } else {
      const body = await readFile(report.shim, "utf8");
      if (body !== hookShimScript(nodePath, cliPath, report.name)) {
        report.issues.push({ code: "stale-shim", message: "Hook launcher does not match this CLI", fixable: true });
      }
      await access(report.shim, constants.X_OK).catch(() => {
        report.issues.push({ code: "stale-shim", message: "Hook launcher is not executable: " + report.shim, fixable: true });
      });
    }
    await access(cliPath).catch(() => {
      report.issues.push({ code: "broken-target", message: "CLI is missing: " + cliPath, fixable: false });
    });
    await access(nodePath, constants.X_OK).catch(() => {
      report.issues.push({ code: "broken-target", message: "Node is missing or not executable: " + nodePath, fixable: false });
    });
  } else if (shimStat !== null) {
    report.issues.push({ code: "orphan-shim", message: "Leftover hook launcher with no installed hooks: " + report.shim, fixable: true });
  }
  return report;
}

function managedCommands(name: HostName, config: unknown, shim: string): string[] | null {
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) return null;
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;
  const commands: string[] = [];
  if (name === "codex") {
    for (const event of ["UserPromptSubmit", "Stop"]) {
      const groups = hooks[event];
      if (groups === undefined) continue;
      if (!Array.isArray(groups)) return null;
      for (const group of groups) {
        if (!object(group) || !Array.isArray(group.hooks)) return null;
        for (const handler of group.hooks) {
          if (object(handler) && handler.type === "command" && handler.statusMessage === marker &&
            typeof handler.command === "string" && isManagedHookCommand(handler.command, "codex", shim)) {
            commands.push(handler.command);
          }
        }
      }
    }
    return commands;
  }
  for (const event of cursorEvents) {
    const group = hooks[event];
    if (group === undefined) continue;
    if (!Array.isArray(group)) return null;
    for (const handler of group) {
      if (object(handler) && (handler.type === undefined || handler.type === "command") &&
        typeof handler.command === "string" && isManagedHookCommand(handler.command, "cursor", shim)) {
        commands.push(handler.command);
      }
    }
  }
  return commands;
}
