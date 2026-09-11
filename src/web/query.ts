import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { GitObserver } from '../git/git-observer.js';
import type { AtlasSnapshot, ProjectedChange } from './contracts.js';
import { baselineSchema } from '../core/baseline.js';

const exec = promisify(execFile);
const id = z.string().regex(/^[a-z0-9_-]+$/i);
const confidence = z.enum(['low', 'medium', 'high']);
const evidence = z.object({ source: z.string(), reference: z.string(), confidence });
const domain = z.object({ schemaVersion: z.literal(1), id, name: z.string(), confidence, evidence: z.array(evidence) }).passthrough();
const capability = domain.extend({ domainId: id });
const version = z.object({ oid: z.string(), mode: z.string() });
const developmentIdentity = z.object({
  name: z.string().optional(), email: z.string().optional(), source: z.literal('git-config'),
  capturedAt: z.string().refine(value => Number.isFinite(Date.parse(value))), capturePoint: z.enum(['turn-start', 'ingest']),
});
const requirementParty = z.object({
  name: z.string().min(1), kind: z.enum(['alias', 'role', 'team']), source: z.literal('request'),
  evidence: z.string().min(1), confidence: z.literal('medium'),
});
const change = z.object({
  schemaVersion: z.literal(1), id, kind: z.enum(['change', 'correction', 'revert']),
  recordedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  request: z.string(), summary: z.string(),
  source: z.object({ host: z.literal('codex'), taskId: z.string().optional() }).passthrough(),
  changedFiles: z.array(z.string()),
  attribution: z.object({ developmentIdentity: developmentIdentity.nullable(), requestedBy: z.array(requirementParty), feedbackBy: z.array(requirementParty) }).optional(),
  fileChanges: z.array(z.object({ path: z.string(), before: version.nullable(), after: version.nullable() })).optional(),
  affectedCapabilityIds: z.array(id), tests: z.array(z.object({ command: z.string(), status: z.enum(['passed', 'failed', 'not-run']), summary: z.string().optional() })),
  evidence: z.array(z.object({ kind: z.enum(['requirement', 'changed-file', 'test', 'code-graph']), value: z.string() })),
  supersedes: id.optional(),
}).passthrough();

export class ProjectionError extends Error {
  constructor(public readonly code: 'FACTS_INVALID' | 'GIT_READ_FAILED', message: string) { super(message); }
}

async function existsDirectory(root: string): Promise<boolean> {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('事实目录必须是本地普通目录：' + root);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readRecords<T>(root: string, schema: z.ZodType<T>): Promise<T[]> {
  if (!(await existsDirectory(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const result: T[] = [];
  for (const entry of entries.filter(item => item.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) throw new Error('事实文件必须是普通 JSON 文件：' + entry.name);
    const parsed = schema.safeParse(JSON.parse(await readFile(path.join(root, entry.name), 'utf8')));
    if (!parsed.success) throw new Error('事实格式无效：' + path.basename(root) + '/' + entry.name);
    if ((parsed.data as { id: string }).id + '.json' !== entry.name) throw new Error('事实 ID 与文件名不一致：' + entry.name);
    result.push(parsed.data);
  }
  return result;
}

/** Rebuild the read model from immutable facts on every refresh; never initialize or mutate storage. */
export async function readAtlas(projectRoot: string): Promise<AtlasSnapshot> {
  let branch: string;
  try {
    const options = { cwd: projectRoot, timeout: 15_000 };
    const { stdout: top } = await exec('git', ['rev-parse', '--show-toplevel'], options);
    if (await realpath(top.trim()) !== await realpath(projectRoot)) throw new Error('请选择 Git 仓库根目录');
    const { stdout } = await exec('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], options).catch(async (error: { code?: number }) => {
      if (error.code !== 1) throw error;
      const head = await exec('git', ['rev-parse', '--short', 'HEAD'], options);
      return { stdout: 'detached · ' + head.stdout.trim() };
    });
    branch = stdout.trim();
  } catch (error) {
    throw new ProjectionError('GIT_READ_FAILED', '无法读取 Git 项目：' + (error as Error).message);
  }
  let facts;
  try {
    const root = path.join(projectRoot, '.domainatlas');
    const initialized = await existsDirectory(root);
    const [domains, capabilities, changes, baselines] = await Promise.all([
      readRecords(path.join(root, 'domains'), domain),
      readRecords(path.join(root, 'capabilities'), capability),
      readRecords(path.join(root, 'changes'), change),
      readRecords(path.join(root, 'baselines'), baselineSchema),
    ]);
    const baseline = baselines.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))[0];
    // Baseline semantics take precedence for matching IDs; retain incremental nodes and history.
    const mergedDomains = [...new Map([...domains, ...(baseline?.discovery.domains ?? [])].map(node => [node.id, node])).values()];
    const mergedCapabilities = [...new Map([...capabilities, ...(baseline?.discovery.capabilities ?? [])].map(node => [node.id, node])).values()];
    facts = { domains: mergedDomains, capabilities: mergedCapabilities, changes, initialized, baseline };
  } catch (error) {
    throw new ProjectionError('FACTS_INVALID', '无法读取事实数据：' + (error as Error).message);
  }
  const observer = new GitObserver(projectRoot);
  const changes: ProjectedChange[] = [];
  try {
    // Sequential Git reads avoid spawning an unbounded number of processes for a large ledger.
    for (const record of facts.changes) {
      changes.push({ ...record, lifecycle: await observer.resolveRecordLifecycle('.domainatlas/changes/' + record.id + '.json') });
    }
  } catch (error) {
    throw new ProjectionError('GIT_READ_FAILED', '无法读取记录提交状态：' + (error as Error).message);
  }
  changes.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id));
  const pending = changes.filter(record => record.lifecycle.state === 'pending').length;
  return {
    project: { name: path.basename(projectRoot), root: projectRoot, branch, initialized: facts.initialized },
    domains: facts.domains, capabilities: facts.capabilities, changes,
    ...(facts.baseline ? { baseline: { id: facts.baseline.id, recordedAt: facts.baseline.recordedAt, head: facts.baseline.head, coverage: facts.baseline.coverage } } : {}),
    totals: { domains: facts.domains.length, capabilities: facts.capabilities.length, changes: changes.length, pending, committed: changes.length - pending },
  };
}
