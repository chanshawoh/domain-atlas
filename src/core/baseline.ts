import { z } from "zod";

const confidence = z.enum(["low", "medium", "high"]);
const evidence = z.object({ file: z.string().min(1), reason: z.string().trim().min(1) }).strict();
const node = z.object({ name: z.string().trim().min(1), confidence, evidence: z.array(evidence).min(1) }).strict();

/** AI supplies business semantics; the CLI supplies IDs and verifies file evidence. */
export const baselineInputSchema = z.object({
  schemaVersion: z.literal(1),
  domains: z.array(node.extend({ capabilities: z.array(node).min(1) })).min(1),
}).strict();

const storedNode = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z0-9_-]+$/i), name: z.string(), confidence,
  evidence: z.array(z.object({ source: z.string(), reference: z.string(), confidence })),
});
export const baselineSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^baseline_[a-f0-9]+$/), kind: z.literal("baseline"),
  recordedAt: z.string().datetime(),
  head: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), oid: z.string() })),
  coverage: z.object({ eligibleFiles: z.number().int().nonnegative(), selectedFiles: z.number().int().nonnegative(), limited: z.boolean() }),
  discovery: z.object({
    provider: z.string(), budgetLimited: z.boolean().optional(),
    domains: z.array(storedNode), capabilities: z.array(storedNode.extend({ domainId: z.string() })),
  }),
});
export type BusinessBaseline = z.infer<typeof baselineSchema>;
