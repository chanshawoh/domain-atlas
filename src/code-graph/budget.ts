import type { BusinessDiscovery, CodeGraphBudget } from "./provider.js";

export function validateBudget(budget: CodeGraphBudget): void {
  if (budget.maxDepth !== 2 || [budget.maxNodes, budget.maxSnippetReads, budget.maxTokens]
    .some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Code graph budget must contain non-negative integer limits and depth 2");
  }
}

// UTF-8 bytes conservatively bound token cost without depending on a model tokenizer.
// Only domain/capability data is charged; the provider name is fixed metadata.
export function limitDiscovery(discovery: BusinessDiscovery, budget: CodeGraphBudget): BusinessDiscovery {
  validateBudget(budget);
  const result: BusinessDiscovery = { provider: discovery.provider, domains: [], capabilities: [] };
  if (discovery.budgetLimited) result.budgetLimited = true;
  for (const capability of discovery.capabilities) {
    const domain = discovery.domains.find((item) => item.id === capability.domainId);
    if (!domain) throw new Error("Code graph capability references a missing domain");
    const domains = result.domains.some((item) => item.id === domain.id)
      ? result.domains : [...result.domains, domain];
    const capabilities = [...result.capabilities, capability];
    if (domains.length + capabilities.length > budget.maxNodes ||
      Buffer.byteLength(JSON.stringify({ domains, capabilities }), "utf8") > budget.maxTokens) {
      result.budgetLimited = true;
      continue;
    }
    result.domains = domains;
    result.capabilities = capabilities;
  }
  return result;
}
