import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BusinessDiscovery } from "../code-graph/provider.js";
import { FileDomainModelStore } from "../storage/file-domain-model-store.js";
import { baselineInputSchema, baselineSchema, type BusinessBaseline } from "./baseline.js";
import { createStableId, type BusinessCapability, type BusinessDomain } from "./model.js";

const exec = promisify(execFile);
const extensions = /\.(c|cc|cpp|cs|go|java|js|jsx|kt|php|py|rb|rs|swift|ts|tsx)$/i;
const excluded = /(^|\/)(\.[^/]+|node_modules|vendor|dist|build|coverage|Library|Temp|obj|bin|tests?|__tests__|docs|scripts?)(\/|$)|\.(test|spec|d)\.[^/]+$/i;

export async function buildBaseline(projectRoot: string, options: {
  dryRun?: boolean; input?: unknown; maxFiles?: number;
  onProgress?: (message: string) => void;
} = {}): Promise<{ written: boolean; baseline: BusinessBaseline }> {
  const progress = options.onProgress ?? (() => {});
  progress("检查项目配置");
  const git = async (args: string[]) => (await exec("git", args, { cwd: projectRoot, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const root = await realpath(projectRoot);
  if (await realpath((await git(["rev-parse", "--show-toplevel"])).trim()) !== root) throw new Error("Run domainatlas build from the Git project root");
  const config = JSON.parse(await readFile(path.join(root, ".domainatlas/config.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("Project is not initialized. Run domainatlas init first.");
    throw error;
  }));
  if (config.schemaVersion !== 1 || config.storage !== "immutable-json-files") throw new Error("Invalid DomainAtlas configuration");
  // Refuse redirected fact directories before publishing anything.
  for (const relative of [".domainatlas", ".domainatlas/baselines"]) {
    const stat = await lstat(path.join(root, relative)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Fact directory must be a local directory: " + relative);
  }
  const maxFiles = options.maxFiles ?? 200;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 2000) throw new Error("--max-files must be an integer from 1 to 2000");
  if (options.input === undefined) {
    throw new Error("业务图构建已停止：缺少经过业务分析的输入。自动将文件路径、包名或代码符号转为业务能力无法保证质量，已禁用。请先补齐分析环境：配置 codebase-memory-mcp，为目标项目根目录建立或刷新索引并确认就绪；再使用 DomainAtlas skill 分析源码和文档，核实业务领域、能力及文件证据，生成 JSON 后运行 domainatlas build --input <文件>。本次未写入业务基线。");
  }
  progress("扫描已跟踪文件");
  const tracked = [...new Set((await git(["ls-files", "-z", "--cached"])).split("\0").filter(Boolean))].sort();
  const eligible = tracked.filter(file => extensions.test(file) && !excluded.test(file));
  progress("校验导入的业务领域、能力及证据");
  const input = baselineInputSchema.parse(options.input);
  const references = input.domains.flatMap(domain => [...domain.evidence, ...domain.capabilities.flatMap(cap => cap.evidence)]);
  const selected = [...new Set(references.map(item => item.file))].sort();
  if (selected.length > maxFiles) throw new Error("Input exceeds --max-files evidence limit");
  for (const file of selected) {
    if (!tracked.includes(file) || file.startsWith(".domainatlas/") || path.isAbsolute(file) || file.split("/").includes("..")) {
      throw new Error("Evidence must reference a tracked project file: " + file);
    }
  }
  const domains: BusinessDomain[] = [];
  const capabilities: BusinessCapability[] = [];
  const evidenceFor = (item: typeof input.domains[number]) => item.evidence.map(e => ({ source: "baseline-ai-analysis", reference: e.file + ": " + e.reason, confidence: item.confidence }));
  for (const domain of input.domains) {
    const domainId = createStableId("domain", [domain.name]);
    if (domains.some(item => item.id === domainId)) throw new Error("Duplicate domain: " + domain.name);
    domains.push({ schemaVersion: 1, id: domainId, name: domain.name, confidence: domain.confidence, evidence: evidenceFor(domain) });
    for (const cap of domain.capabilities) {
      const id = createStableId("capability", [domainId, cap.name]);
      if (capabilities.some(item => item.id === id)) throw new Error("Duplicate capability: " + cap.name);
      capabilities.push({ schemaVersion: 1, id, domainId, name: cap.name, confidence: cap.confidence,
        evidence: cap.evidence.map(e => ({ source: "baseline-ai-analysis", reference: e.file + ": " + e.reason, confidence: cap.confidence })) });
    }
  }
  const discovery: BusinessDiscovery = { provider: "ai-analysis", domains, capabilities };
  progress(`校验 ${selected.length} 个证据文件`);
  for (const file of selected) {
    const absolute = path.join(root, file);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || !((await realpath(absolute)).startsWith(root + path.sep))) {
      throw new Error("Evidence must be a regular project file: " + file);
    }
  }
  if (!selected.length) throw new Error("No eligible tracked source files. Track source files with git add, or use --input with verified file evidence.");
  const head = (await git(["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim() || null;
  const hashes = (await git(["hash-object", "--", ...selected])).trim().split("\n");
  if (!discovery.capabilities.length) throw new Error("No business capabilities discovered. Use the DomainAtlas skill and build --input with verified evidence.");
  progress("核对文件一致性并整理业务图");
  if ((await git(["hash-object", "--", ...selected])).trim() !== hashes.join("\n") || ((await git(["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim() || null) !== head) {
    throw new Error("Project changed during baseline discovery; retry build");
  }
  const content = {
    schemaVersion: 1 as const, kind: "baseline" as const, head,
    files: selected.map((file, index) => ({ path: file, oid: hashes[index] })),
    coverage: { eligibleFiles: eligible.length, selectedFiles: selected.length,
      limited: !!discovery.budgetLimited || eligible.some(file => !selected.includes(file)) }, discovery,
  };
  const baseline = baselineSchema.parse({ ...content, id: createStableId("baseline", [JSON.stringify(content)]), recordedAt: new Date().toISOString() });
  if (!options.dryRun) progress("保存业务图");
  const written = options.dryRun ? false : await new FileDomainModelStore(root).appendBaseline(baseline);
  if (!options.dryRun && !written) {
    return { written, baseline: baselineSchema.parse(JSON.parse(await readFile(path.join(root, ".domainatlas/baselines", baseline.id + ".json"), "utf8"))) };
  }
  return { written, baseline };
}
