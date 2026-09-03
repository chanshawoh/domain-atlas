import type { BusinessCapability, BusinessDomain } from "../core/model.js";

export interface CodeGraphBudget {
  maxDepth: 2;
  maxNodes: number;
  maxSnippetReads: number;
  maxTokens: number;
}

export interface CodeGraphContext {
  projectRoot: string;
  request: string;
  changedFiles: string[];
  budget: CodeGraphBudget;
}

export interface BusinessDiscovery {
  domains: BusinessDomain[];
  capabilities: BusinessCapability[];
  provider: string;
}

export interface CodeGraphProvider {
  readonly name: string;
  discover(context: CodeGraphContext): Promise<BusinessDiscovery>;
}

export class CodeGraphUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeGraphUnavailableError";
  }
}

export class CodeGraphProviderChain implements CodeGraphProvider {
  readonly name = "provider-chain";

  constructor(
    private readonly primary: CodeGraphProvider | undefined,
    private readonly fallback: CodeGraphProvider,
  ) {}

  async discover(context: CodeGraphContext): Promise<BusinessDiscovery> {
    if (!this.primary) {
      return this.fallback.discover(context);
    }

    try {
      return await this.primary.discover(context);
    } catch (error) {
      if (!(error instanceof CodeGraphUnavailableError)) {
        throw error;
      }
      return this.fallback.discover(context);
    }
  }
}

