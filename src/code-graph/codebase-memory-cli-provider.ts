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

interface ArchitecturePackage {
  name: string;
}

interface ArchitectureResponse {
  packages: ArchitecturePackage[];
}

interface SearchResult {
  name: string;
  qualified_name: string;
  file_path: string;
  is_test: boolean;
  label: string;
}

interface SearchResponse {
  results: SearchResult[];
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
    throw new Error("Invalid codebase-memory-mcp response for " + operation);
  }
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
      const projects = parseJson<ProjectListResponse>(await this.runner(["list_projects"], 128 * 1024), "list_projects");
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
        ["get_architecture", "--project", project.name, "--aspects", "packages"],
      );
      if (!Array.isArray(architecture.packages) || architecture.packages.some((item) => typeof item.name !== "string")) {
        throw new Error("Invalid codebase-memory-mcp response for get_architecture");
      }
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
        const architecturePackage = architecture.packages.find((candidate) =>
          segments.includes(candidate.name.toLowerCase()),
        );
        if (!architecturePackage) {
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
        ]);
        if (!Array.isArray(search.results)) throw new Error("Invalid codebase-memory-mcp response for search_graph");
        const symbol = search.results.find(
          (result) =>
            !result.is_test &&
            result.file_path === changedFile &&
            ["Class", "Function", "Interface", "Method", "Type"].includes(result.label),
        );
        const domainName = architecturePackage.name;
        const capabilityName = symbol?.name ?? readableCapabilityName(fileStem);
        const domainId = createStableId("domain", [domainName]);
        const capabilityId = createStableId("capability", [domainId, capabilityName]);
        const reference = symbol?.qualified_name ?? changedFile;
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
