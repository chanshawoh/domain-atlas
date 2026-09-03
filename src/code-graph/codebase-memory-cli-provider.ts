import { execFile } from "node:child_process";
import path from "node:path";
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

async function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "codebase-memory-mcp",
      ["cli", ...args],
      { maxBuffer: 4 * 1024 * 1024, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
          return;
        }
        const failure = error as NodeJS.ErrnoException;
        if (failure.code === "ENOENT") {
          reject(new CodeGraphUnavailableError("codebase-memory-mcp is not installed"));
          return;
        }
        reject(
          new CodeGraphUnavailableError(
            "codebase-memory-mcp is unavailable: " + (stderr.trim() || failure.message),
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

  async discover(context: CodeGraphContext): Promise<BusinessDiscovery> {
    const projects = parseJson<ProjectListResponse>(await runCli(["list_projects"]), "list_projects");
    const project = projects.projects.find(
      (candidate) => path.resolve(candidate.root_path) === path.resolve(context.projectRoot),
    );
    if (!project) {
      throw new CodeGraphUnavailableError("project is not indexed by codebase-memory-mcp");
    }

    const architecture = parseJson<ArchitectureResponse>(
      await runCli(["get_architecture", "--project", project.name]),
      "get_architecture",
    );
    const domains = new Map<string, BusinessDomain>();
    const capabilities = new Map<string, BusinessCapability>();
    const searchableFiles = context.changedFiles
      .filter(isBusinessCodeFile)
      .slice(0, context.budget.maxSnippetReads);

    for (const changedFile of searchableFiles) {
      if (domains.size + capabilities.size >= context.budget.maxNodes) {
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
      const search = parseJson<SearchResponse>(
        await runCli([
          "search_graph",
          "--project",
          project.name,
          "--name-pattern",
          symbolPattern(fileStem),
        ]),
        "search_graph",
      );
      const symbol = search.results.find(
        (result) =>
          !result.is_test &&
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

    return {
      domains: [...domains.values()],
      capabilities: [...capabilities.values()],
      provider: this.name,
    };
  }
}
