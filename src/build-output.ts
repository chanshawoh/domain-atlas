import type { BusinessBaseline } from "./core/baseline.js";

/** Keep long-running stages visible, including when output is redirected. */
export function startBuildProgress(write: (text: string) => void) {
  const started = Date.now();
  let current = "准备构建业务图";
  let lastUpdate = started;
  write(current + "…\n");
  const timer = setInterval(() => {
    if (Date.now() - lastUpdate >= 5_000) {
      write(`${current}…（已耗时 ${Math.floor((Date.now() - started) / 1000)} 秒）\n`);
      lastUpdate = Date.now();
    }
  }, 1_000);
  timer.unref();
  return {
    update(message: string) {
      current = message;
      lastUpdate = Date.now();
      write(message + "…\n");
    },
    stop() { clearInterval(timer); },
  };
}

export function formatBuildSummary(result: { written: boolean; baseline: BusinessBaseline }, dryRun: boolean): string {
  const { baseline, written } = result;
  const status = dryRun ? "预览完成（未保存）" : written ? "业务图构建完成，已保存" : "业务图内容已存在，本次未新增记录";
  const lines = [
    `${status}：${baseline.discovery.domains.length} 个业务领域、${baseline.discovery.capabilities.length} 个业务能力，基于 ${baseline.files.length} 个文件。`,
  ];
  if (baseline.coverage.limited) lines.push("本次仅覆盖部分源码或分析预算受限，业务图可能不完整。");
  if (baseline.discovery.provider.split(",").includes("incremental-fallback")) lines.push("业务名称由文件路径推断，需核实。");
  return lines.join("\n") + "\n";
}
