import { execFile } from "node:child_process";
import path from "node:path";
import { limitDiscovery, validateBudget } from "./budget.js";
import { createStableId, type BusinessCapability, type BusinessDomain } from "../core/model.js";
import {
  CodeGraphUnavailableError,
  type BusinessDiscovery,
  type CodeGraphContext,
  type CodeGraphProvider,
} from "./provider.js";

interface IndexedProject {
  name: string;
  root_path: string;
}

interface ProjectListResponse {
  projects: IndexedProject[];
}

// Since 0.11 the CLI returns column-oriented tables under `--format json`, with
// search hits grouped by file instead of a flat result list.
interface ColumnarTable {
  cols: string[];
  rows: unknown[][];
}

interface ArchitectureResponse {
  packages: ColumnarTable;
}

interface SearchGroup {
  qn_prefix: string;
  file: string;
  rows: unknown[][];
}

interface SearchResponse extends Pick<ColumnarTable, "cols"> {
  groups: SearchGroup[];
}

interface FoundSymbol {
  name: string;
  label: string;
  filePath: string;
  qualifiedName: string;
  isTest: boolean;
}

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);

const NON_BUSINESS_PATHS = new Set(["docs", "test", "tests"]);

function regexEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function symbolPattern(fileStem: string): string {
  const words = fileStem.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const pascalWords = words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1));
  return ".*" + pascalWords.map(regexEscape).join(".*") + ".*";
}

function readableCapabilityName(fileStem: string): string {
  return fileStem.replace(/[_-]+/g, " ").trim() || "project";
}

function parseJson<T>(output: string, operation: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw invalidResponse(operation);
  }
}

// `--format json` is required because 0.11 prints a human-readable tree by default.
const JSON_FORMAT = ["--format", "json"] as const;

function invalidResponse(operation: string): Error {
  return new Error("Invalid codebase-memory-mcp response for " + operation);
}

// 0.11 replaced the flat JSON shapes with column-oriented tables and grouped search hits.
// Naming that boundary beats a generic parse error when an older CLI is still on PATH.
function outdatedResponse(operation: string): Error {
  return new Error(
    "codebase-memory-mcp is too old for DomainAtlas: " + operation +
    " returned the pre-0.11 response format; 0.11.0 or newer is required. Run `codebase-memory-mcp update`.",
  );
}

function isLegacyShape(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  return typeof value === "object" && value !== null && Array.isArray((value as { results?: unknown }).results);
}

function requireTable(value: unknown, operation: string): ColumnarTable {
  const table = value as Partial<ColumnarTable> | null | undefined;
  if (
    !table ||
    !Array.isArray(table.cols) ||
    !table.cols.every((column) => typeof column === "string") ||
    !Array.isArray(table.rows) ||
    !table.rows.every((row) => Array.isArray(row))
  ) {
    throw invalidResponse(operation);
  }
  return { cols: table.cols, rows: table.rows };
}

function requireColumn(table: Pick<ColumnarTable, "cols">, name: string, operation: string): number {
  const index = table.cols.indexOf(name);
  if (index < 0) throw invalidResponse(operation);
  return index;
}

function packageNames(response: ArchitectureResponse): string[] {
  if (isLegacyShape(response.packages)) throw outdatedResponse("get_architecture");
  const table = requireTable(response.packages, "get_architecture");
  const index = requireColumn(table, "name", "get_architecture");
  const names = table.rows.map((row) => row[index]);
  if (names.some((name) => typeof name !== "string")) throw invalidResponse("get_architecture");
  return names as string[];
}

function findSymbols(response: SearchResponse): FoundSymbol[] {
  if (isLegacyShape(response)) throw outdatedResponse("search_graph");
  if (!Array.isArray(response.cols) || !Array.isArray(response.groups)) {
    throw invalidResponse("search_graph");
  }
  const nameIndex = requireColumn(response, "name", "search_graph");
  const labelIndex = requireColumn(response, "label", "search_graph");
  const testIndex = response.cols.indexOf("is_test");
  const symbols: FoundSymbol[] = [];
  for (const group of response.groups) {
    if (typeof group.qn_prefix !== "string" || typeof group.file !== "string" || !Array.isArray(group.rows)) {
      throw invalidResponse("search_graph");
    }
    for (const row of group.rows) {
      if (!Array.isArray(row)) throw invalidResponse("search_graph");
      const name = row[nameIndex];
      const label = row[labelIndex];
      if (typeof name !== "string" || typeof label !== "string") throw invalidResponse("search_graph");
      symbols.push({
        name,
        label,
        filePath: group.file,
        qualifiedName: group.qn_prefix ? group.qn_prefix + "." + name : name,
        isTest: testIndex >= 0 && row[testIndex] === true,
      });
    }
  }
  return symbols;
}

export class CodeGraphResponseLimitError extends Error {}

export type CodeGraphCliRunner = (args: string[], maxBytes: number) => Promise<string>;

async function runCli(args: string[], maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "codebase-memory-mcp",
      ["cli", ...args],
      { maxBuffer: maxBytes, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
          return;
        }
        const failure = error as NodeJS.ErrnoException;
        if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          reject(new CodeGraphResponseLimitError("codebase-memory-mcp response budget exhausted"));
          return;
        }
        if (failure.code === "ENOENT") {
          reject(new CodeGraphUnavailableError("codebase-memory-mcp is not installed"));
          return;
        }
        reject(
          new Error(
            "codebase-memory-mcp failed: " + (stderr.trim() || failure.message),
          ),
        );
      },
    );
    child.stdin?.end();
  });
}

function pathSegments(file: string): string[] {
  return file.split(/[\\/]+/).filter(Boolean).map((segment) => segment.toLowerCase());
}

function isBusinessCodeFile(file: string): boolean {
  const segments = pathSegments(file);
  return (
    CODE_EXTENSIONS.has(path.extname(file).toLowerCase()) &&
    !segments.some((segment) => NON_BUSINESS_PATHS.has(segment))
  );
}

export class CodebaseMemoryCliProvider implements CodeGraphProvider {
  readonly name = "codebase-memory-mcp";

  constructor(private readonly runner: CodeGraphCliRunner = runCli) {}

  async discover(context: CodeGraphContext): Promise<BusinessDiscovery> {
    validateBudget(context.budget);
    const domains = new Map<string, BusinessDomain>();
    const capabilities = new Map<string, BusinessCapability>();
    let budgetLimited = false;
    const result = () => limitDiscovery({ domains: [...domains.values()],
      capabilities: [...capabilities.values()], provider: this.name,
      ...(budgetLimited ? { budgetLimited: true } : {}) }, context.budget);
    if (context.budget.maxTokens === 0 || context.budget.maxNodes < 2 || context.budget.maxSnippetReads === 0) {
      budgetLimited = context.changedFiles.some(isBusinessCodeFile);
      return result();
    }
    let remainingBytes = context.budget.maxTokens;
    const query = async <T>(args: string[]): Promise<T> => {
      if (remainingBytes <= 0) throw new CodeGraphResponseLimitError("Graph response budget exhausted");
      const output = await this.runner(args, remainingBytes);
      remainingBytes -= Buffer.byteLength(output, "utf8");
      if (remainingBytes < 0) throw new CodeGraphResponseLimitError("Graph response budget exhausted");
      return parseJson<T>(output, args[0]);
    };
    try {
      // Project routing metadata is separately bounded and never used as model context.
      const projects = parseJson<ProjectListResponse>(
        await this.runner(["list_projects", ...JSON_FORMAT], 128 * 1024), "list_projects");
      if (!Array.isArray(projects.projects) || projects.projects.some((item) =>
        typeof item.name !== "string" || typeof item.root_path !== "string")) {
        throw new Error("Invalid codebase-memory-mcp response for list_projects");
      }
      const project = projects.projects.find(
        (candidate) => path.resolve(candidate.root_path) === path.resolve(context.projectRoot),
      );
      if (!project) {
        throw new CodeGraphUnavailableError("project is not indexed by codebase-memory-mcp");
      }

      const architecture = await query<ArchitectureResponse>(
        ["get_architecture", "--project", project.name, "--aspects", "packages", ...JSON_FORMAT],
      );
      const architecturePackages = packageNames(architecture);
      const searchableFiles = context.changedFiles
        .filter(isBusinessCodeFile)
        .slice(0, context.budget.maxSnippetReads);
      budgetLimited = context.changedFiles.filter(isBusinessCodeFile).length > searchableFiles.length;

      for (const changedFile of searchableFiles) {
        if (domains.size + capabilities.size >= context.budget.maxNodes) {
          budgetLimited = true;
          break;
        }
        const segments = pathSegments(changedFile);
        const domainName = architecturePackages.find((candidate) =>
          segments.includes(candidate.toLowerCase()),
        );
        if (!domainName) {
          continue;
        }

        const fileStem = path.basename(changedFile, path.extname(changedFile));
        const search = await query<SearchResponse>([
          "search_graph",
          "--project",
          project.name,
          "--name-pattern",
          symbolPattern(fileStem),
          "--file-pattern", changedFile,
          "--limit", String(Math.min(context.budget.maxNodes, 20)),
          // `is_test` is not part of the default projection.
          "--fields", "is_test",
          ...JSON_FORMAT,
        ]);
        const symbol = findSymbols(search).find(
          (result) =>
            !result.isTest &&
            result.filePath === changedFile &&
            ["Class", "Function", "Interface", "Method", "Type"].includes(result.label),
        );
        const capabilityName = symbol?.name ?? readableCapabilityName(fileStem);
        const domainId = createStableId("domain", [domainName]);
        const capabilityId = createStableId("capability", [domainId, capabilityName]);
        const reference = symbol?.qualifiedName ?? changedFile;
        const evidence = {
          source: this.name,
          reference,
          confidence: "medium" as const,
        };

        if (!domains.has(domainId)) {
          domains.set(domainId, {
            schemaVersion: 1,
            id: domainId,
            name: domainName,
            confidence: "medium",
            evidence: [evidence],
          });
        }
        if (!capabilities.has(capabilityId)) {
          capabilities.set(capabilityId, {
            schemaVersion: 1,
            id: capabilityId,
            domainId,
            name: capabilityName,
            confidence: "medium",
            evidence: [evidence],
          });
        }
      }
    } catch (error) {
      if (!(error instanceof CodeGraphResponseLimitError)) throw error;
      budgetLimited = true;
    }
    return result();
  }
}
