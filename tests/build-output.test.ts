import assert from "node:assert/strict";
import test from "node:test";
import { formatBuildSummary, startBuildProgress } from "../src/build-output.js";
import { buildBaseline } from "../src/core/build-baseline.js";

test("waiting stages remain visible and stopping clears the heartbeat", t => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  const output: string[] = [];
  const progress = startBuildProgress(text => output.push(text));
  progress.update("分析业务结构：已完成 0/16 个文件");
  t.mock.timers.tick(5_000);
  assert.match(output.at(-1)!, /已完成 0\/16.*已耗时 5 秒/);
  progress.update("分析业务结构：已完成 8/16 个文件");
  t.mock.timers.tick(5_000);
  assert.match(output.at(-1)!, /已完成 8\/16.*已耗时 10 秒/);
  progress.stop();
  const count = output.length;
  t.mock.timers.tick(10_000);
  assert.equal(output.length, count);
});

test("summary discloses limited coverage and path inference without dumping evidence", () => {
  const result = {
    written: true,
    baseline: { discovery: { domains: [{}], capabilities: [{}, {}], provider: "incremental-fallback" }, files: [{}], coverage: { limited: true } },
  } as Awaited<ReturnType<typeof buildBaseline>>;
  const summary = formatBuildSummary(result, false);
  assert.match(summary, /1 个业务领域、2 个业务能力.*1 个文件/);
  assert.match(summary, /业务图可能不完整/);
  assert.match(summary, /文件路径推断/);
});
