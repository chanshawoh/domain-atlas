import assert from "node:assert/strict";
import test from "node:test";
import { IncrementalFallbackCodeGraphProvider } from "../src/code-graph/fallback-provider.js";
import {
  CodeGraphProviderChain,
  CodeGraphUnavailableError,
  type CodeGraphContext,
  type CodeGraphProvider,
} from "../src/code-graph/provider.js";

const context: CodeGraphContext = {
  projectRoot: "/project",
  request: "记录业务变化",
  changedFiles: ["packages/orders/src/refund.ts"],
  budget: { maxDepth: 2, maxNodes: 10, maxSnippetReads: 0, maxTokens: 6000 },
};

test("falls back only when the primary provider is unavailable", async () => {
  const primary: CodeGraphProvider = {
    name: "codebase-memory-mcp",
    async discover() {
      throw new CodeGraphUnavailableError("not connected");
    },
  };
  const chain = new CodeGraphProviderChain(primary, new IncrementalFallbackCodeGraphProvider());
  const discovery = await chain.discover(context);
  assert.equal(discovery.provider, "incremental-fallback");
  assert.equal(discovery.domains[0].name, "orders");
  assert.equal(discovery.capabilities[0].name, "refund");
});

test("does not hide defects from the primary provider", async () => {
  const primary: CodeGraphProvider = {
    name: "broken-provider",
    async discover() {
      throw new Error("invalid graph response");
    },
  };
  const chain = new CodeGraphProviderChain(primary, new IncrementalFallbackCodeGraphProvider());
  await assert.rejects(chain.discover(context), /invalid graph response/);
});
