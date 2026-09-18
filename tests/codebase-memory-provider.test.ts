import assert from "node:assert/strict";
import test from "node:test";
import { CodebaseMemoryCliProvider, CodeGraphResponseLimitError, type CodeGraphCliRunner } from "../src/code-graph/codebase-memory-cli-provider.js";
import { IncrementalFallbackCodeGraphProvider } from "../src/code-graph/fallback-provider.js";
import { CodeGraphProviderChain, type CodeGraphContext } from "../src/code-graph/provider.js";

const context: CodeGraphContext = {
  projectRoot: "/project", request: "退款审核", changedFiles: ["README.md", "tests/refund.ts", "src/billing/refund.ts", "src/billing/pay.ts"],
  budget: { maxDepth: 2, maxNodes: 20, maxSnippetReads: 8, maxTokens: 6000 },
};

function fixture(calls: string[][] = []): CodeGraphCliRunner {
  return async (args) => {
    calls.push(args);
    if (args[0] === "list_projects") return JSON.stringify({ projects: [{ name: "indexed-project", root_path: "/project" }] });
    if (args[0] === "get_architecture") return JSON.stringify({
      project: "indexed-project",
      packages: { cols: ["name", "nodes", "fan_in", "fan_out"], rows: [["billing", 12, 0, 0]] },
    });
    return JSON.stringify({
      qn_rule: 'qn = qn_prefix == "" ? name : qn_prefix + "." + name',
      cols: ["name", "label", "lines", "in", "out", "is_test"],
      groups: [
        { qn_prefix: "other", file: "src/other/refund.ts", rows: [["WrongRefund", "Class", "1-9", 0, 0, false]] },
        { qn_prefix: "project.billing", file: "src/billing/refund.ts", rows: [
          ["RefundTest", "Class", "30-40", 0, 0, true],
          ["Refund", "Class", "1-20", 3, 0, false],
        ] },
      ],
      total: 3,
      returned: 3,
    });
  };
}

test("CLI provider bounds queries, filters non-code before budgeting and matches the exact changed file", async () => {
  const calls: string[][] = [];
  const provider = new CodebaseMemoryCliProvider(fixture(calls));
  const result = await provider.discover({ ...context, budget: { ...context.budget, maxSnippetReads: 1 } });
  assert.equal(result.capabilities[0].name, "Refund");
  assert.equal(calls.filter((args) => args[0] === "search_graph").length, 1);
  assert.ok(calls[1].includes("packages"));
  assert.ok(calls[2].includes("--file-pattern"));
  assert.equal(calls[2][calls[2].indexOf("--file-pattern") + 1], "src/billing/refund.ts");
  assert.ok(calls[2].includes("--limit"));
  // 0.11 prints a tree unless JSON output is requested explicitly.
  for (const args of calls) assert.deepEqual(args.slice(-2), ["--format", "json"]);
});

test("both providers honor zero, odd node limits and conservative token limits", async () => {
  for (const provider of [new CodebaseMemoryCliProvider(fixture()), new IncrementalFallbackCodeGraphProvider()]) {
    for (const maxNodes of [0, 1, 3, 5]) {
      const result = await provider.discover({ ...context, budget: { ...context.budget, maxNodes } });
      assert.ok(result.domains.length + result.capabilities.length <= maxNodes);
    }
    for (const maxTokens of [0, 1, 200, 1000]) {
      const result = await provider.discover({ ...context, budget: { ...context.budget, maxTokens } });
      if (result.capabilities.length) {
        assert.ok(Buffer.byteLength(JSON.stringify({ domains: result.domains, capabilities: result.capabilities })) <= maxTokens);
      } else assert.deepEqual(result.domains, []);
    }
    await assert.rejects(provider.discover({ ...context, budget: { ...context.budget, maxTokens: -1 } }), /budget/);
  }
  let called = false;
  const provider = new CodebaseMemoryCliProvider(async () => { called = true; throw new Error("unexpected query"); });
  await provider.discover({ ...context, budget: { ...context.budget, maxTokens: 0 } });
  assert.equal(called, false);
});

test("oversized graph responses stop discovery without fallback or further queries", async () => {
  const calls: string[][] = [];
  const runner = fixture(calls);
  const primary = new CodebaseMemoryCliProvider(async (args, bytes) => {
    if (args[0] === "search_graph") { calls.push(args); throw new CodeGraphResponseLimitError(); }
    return runner(args, bytes);
  });
  const result = await new CodeGraphProviderChain(primary, new IncrementalFallbackCodeGraphProvider()).discover(context);
  assert.equal(result.provider, "codebase-memory-mcp");
  assert.equal(result.budgetLimited, true);
  assert.deepEqual(result.capabilities, []);
  assert.equal(calls.filter((args) => args[0] === "search_graph").length, 1);
  const oversized = new CodebaseMemoryCliProvider(async (args, bytes) => args[0] === "list_projects"
    ? runner(args, bytes) : "x".repeat(bytes + 1));
  assert.deepEqual((await oversized.discover(context)).capabilities, []);
});

test("only unavailable projects fall back; malformed output and process defects surface", async () => {
  const run = (runner: CodeGraphCliRunner) => new CodeGraphProviderChain(
    new CodebaseMemoryCliProvider(runner), new IncrementalFallbackCodeGraphProvider(),
  ).discover(context);
  assert.equal((await run(async () => '{"projects":[]}')).provider, "incremental-fallback");
  await assert.rejects(run(async () => "not json"), /Invalid codebase-memory-mcp response/);
  await assert.rejects(run(async () => '{"error":"bad query"}'), /Invalid codebase-memory-mcp response/);
  await assert.rejects(run(async () => { throw new Error("process exited 1"); }), /process exited 1/);
});

test("pre-0.11 responses name the version boundary instead of a generic parse error", async () => {
  const run = (runner: CodeGraphCliRunner) => new CodeGraphProviderChain(
    new CodebaseMemoryCliProvider(runner), new IncrementalFallbackCodeGraphProvider(),
  ).discover(context);
  const projects = JSON.stringify({ projects: [{ name: "indexed-project", root_path: "/project" }] });
  const legacyArchitecture = async (args: string[]) => args[0] === "list_projects" ? projects
    : args[0] === "get_architecture" ? JSON.stringify({ packages: [{ name: "billing" }] })
      : JSON.stringify({ results: [] });
  await assert.rejects(run(legacyArchitecture), /pre-0\.11 response format.*0\.11\.0 or newer/);
  const legacySearch = async (args: string[]) => args[0] === "list_projects" ? projects
    : args[0] === "get_architecture" ? JSON.stringify({ packages: { cols: ["name"], rows: [["billing"]] } })
      : JSON.stringify({ results: [{ name: "Refund", qualified_name: "p.Refund", file_path: "src/billing/refund.ts", is_test: false, label: "Class" }] });
  await assert.rejects(run(legacySearch), /pre-0\.11 response format.*0\.11\.0 or newer/);
});
