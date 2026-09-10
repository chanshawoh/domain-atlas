import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { handleCodexHook } from "../src/adapters/codex-hooks.js";
import { createStableId } from "../src/core/model.js";
import { extractRequirementParties } from "../src/core/requirement-parties.js";
import { readDevelopmentIdentity } from "../src/git/git-identity.js";
import { git } from "../src/git/git-snapshot.js";
import { GitObserver } from "../src/git/git-observer.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";
import { readAtlas } from "../src/web/query.js";

const exec = promisify(execFile);
async function repository(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "domainatlas-attribution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "core.hooksPath", "/dev/null"]);
  await git(root, ["config", "user.name", "woody"]);
  await git(root, ["config", "user.email", "woody@example.invalid"]);
  return root;
}

test("explicit requesters and feedback roles retain their own original evidence", () => {
  const parties = extractRequirementParties("clp 提了需求，前端反馈订单列表缺少手机号，请帮我修改。");
  assert.deepEqual(parties, {
    requestedBy: [{ name: "clp", kind: "alias", source: "request", evidence: "clp 提了需求", confidence: "medium" }],
    feedbackBy: [{ name: "前端", kind: "role", source: "request", evidence: "前端反馈订单列表缺少手机号", confidence: "medium" }],
  });
  for (const text of ["clp 提过来手机号查询需求", "这个需求是 clp 提过来的", "由 clp 提出的需求", '“clp” 提出了退款需求', "$domainatlas record clp 提了退款需求"]) {
    assert.equal(extractRequirementParties(text).requestedBy[0]?.name, "clp", text);
  }
  assert.equal(extractRequirementParties("前端 提过来某某需求").requestedBy[0]?.kind, "role");
  assert.equal(extractRequirementParties("支付团队反馈退款失败").feedbackBy[0]?.kind, "team");
  const multiple = extractRequirementParties("clp 提了退款需求；张三提出了审核需求；clp 提了退款需求；clp 反馈审核失败。");
  assert.deepEqual(multiple.requestedBy.map(party => party.name), ["clp", "张三"]);
  assert.equal(multiple.feedbackBy[0]?.name, "clp");
});

test("mentions, uncertain identities, negation, questions and examples do not assert attribution", () => {
  for (const request of [
    "请找 clp 和前端联调", "clp 没有提出需求", "不是 clp 提过来的需求", "clp 提了需求吗？",
    "如果 clp 提了需求，前端反馈缺少手机号，就记录下来", "比如 clp 提了需求，前端反馈缺少手机号",
    "前端可能反馈了错误", "我提了需求", "有人反馈错误", "```text\nclp 提了需求\n```",
    "分别记录吧", "clp 提出了建议", "不要把 clp 提了需求记录成事实", "clp 未提出需求", "clp 说前端反馈了错误",
  ]) assert.deepEqual(extractRequirementParties(request), { requestedBy: [], feedbackBy: [] }, request);
});

test("turn identity stays fixed while actual commit author and committer remain distinct", async t => {
  const root = await repository(t);
  const event = { cwd: root, session_id: "session", turn_id: "turn", prompt: "clp 提了需求，前端反馈缺少手机号" };
  await handleCodexHook({ ...event, hook_event_name: "UserPromptSubmit" }, null);
  await git(root, ["config", "user.name", "release-bot"]);
  await git(root, ["config", "user.email", "release@example.invalid"]);
  await writeFile(path.join(root, "phone.ts"), "export const phone = true;\n");
  await handleCodexHook({ ...event, hook_event_name: "Stop", last_assistant_message: "已支持手机号；other 反馈的需求" }, null);
  const [stored] = await createDomainAtlasRuntime(root, null).store.listChanges();
  const attribution = stored.record.attribution!;
  assert.equal(attribution.developmentIdentity?.name, "woody");
  assert.equal(attribution.developmentIdentity?.email, "woody@example.invalid");
  assert.equal(attribution.developmentIdentity?.capturePoint, "turn-start");
  assert.ok(Number.isFinite(Date.parse(attribution.developmentIdentity!.capturedAt)));
  assert.deepEqual(attribution.requestedBy.map(party => party.name), ["clp"]);
  assert.deepEqual(attribution.feedbackBy.map(party => party.name), ["前端"]);
  const bytes = await readFile(path.join(root, stored.relativePath), "utf8");
  const observer = new GitObserver(root);
  assert.deepEqual(await observer.resolveRecordLifecycle(stored.relativePath), { state: "pending" });
  await git(root, ["add", "."]);
  await exec("git", ["commit", "-m", "记录手机号需求"], { cwd: root, env: {
    ...process.env, GIT_AUTHOR_NAME: "code-author", GIT_AUTHOR_EMAIL: "author@example.invalid",
    GIT_COMMITTER_NAME: "release-bot", GIT_COMMITTER_EMAIL: "release@example.invalid",
  } });
  const commitSha = (await git(root, ["rev-parse", "HEAD"])).trim();
  await git(root, ["config", "user.name", "later-user"]);
  const expected = {
    state: "committed", commitSha,
    author: { name: "code-author", email: "author@example.invalid" },
    committer: { name: "release-bot", email: "release@example.invalid" },
  };
  assert.deepEqual(await observer.resolveRecordLifecycle(stored.relativePath), expected);
  const atlas = await readAtlas(root);
  assert.deepEqual(atlas.changes[0].attribution, attribution);
  assert.deepEqual(atlas.changes[0].lifecycle, expected);
  const cli = await exec(process.execPath, [path.resolve("dist/src/cli.js"), "list"], { cwd: root });
  assert.deepEqual(JSON.parse(cli.stdout)[0].lifecycle, expected);
  assert.equal(await readFile(path.join(root, stored.relativePath), "utf8"), bytes);
});

test("manual ingest captures current config; legacy records and hook baselines stay unknown", async t => {
  const root = await repository(t);
  const runtime = createDomainAtlasRuntime(root, null);
  const stored = await runtime.adapter.handleTaskCompleted({ request: "clp 提了需求", summary: "记录需求", changedFiles: [] });
  assert.equal(stored.record.attribution?.developmentIdentity?.capturePoint, "ingest");
  // An old persisted record is not retroactively assigned today's identity or parser output.
  const { attribution: _attribution, ...legacy } = stored.record;
  await writeFile(path.join(root, stored.relativePath), JSON.stringify(legacy));
  assert.equal((await readAtlas(root)).changes[0].attribution, undefined);
  const event = { cwd: root, session_id: "session", turn_id: "old", prompt: "实现退款" };
  await handleCodexHook({ ...event, hook_event_name: "UserPromptSubmit" }, null);
  const statePath = path.join(root, ".git/domainatlas/turns", createStableId("change", ["codex-hook", "session", "old"]) + ".json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  delete state.developmentIdentity;
  await writeFile(statePath, JSON.stringify(state));
  await handleCodexHook({ ...event, hook_event_name: "Stop", last_assistant_message: "完成" }, null);
  const oldTurn = (await runtime.store.listChanges()).find(item => item.record.source.taskId === "session/old")!;
  assert.equal(oldTurn.record.attribution?.developmentIdentity, null);
  const malformed = { ...stored.record, attribution: { developmentIdentity: null, requestedBy: "clp", feedbackBy: [] } };
  await writeFile(path.join(root, stored.relativePath), JSON.stringify(malformed));
  await assert.rejects(readAtlas(root), /事实格式无效/);
});

test("missing Git configuration remains unknown instead of using operating-system defaults", async t => {
  const root = await repository(t);
  // Empty local values mask any inherited global config without modifying the user's settings.
  await git(root, ["config", "user.name", ""]);
  await git(root, ["config", "user.email", ""]);
  assert.equal(await readDevelopmentIdentity(root, "turn-start"), null);
  const stored = await createDomainAtlasRuntime(root, null).adapter.handleTaskCompleted({ request: "更新接口", summary: "完成", changedFiles: [] });
  assert.equal(stored.record.attribution?.developmentIdentity, null);
  await git(root, ["config", "user.name", "woody"]);
  const partial = await readDevelopmentIdentity(root, "ingest");
  assert.equal(partial?.name, "woody");
  assert.equal(partial?.email, undefined);
});
