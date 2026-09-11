# 初始业务图构建

`init` 创建配置，`build` 构建已有项目的当前业务基线，`ui` 展示基线和后续增量业务事实。基线不是历史开发事件，不会伪造需求、作者、测试或过去的提交时间。目前不支持 Git 历史回放。

## 命令方式

在目标 Git 仓库根目录执行，需 Node.js 22+：

```sh
domainatlas init
domainatlas build
domainatlas ui
```

构建默认立即写入。只验证和预览时使用 `domainatlas build --dry-run`；扩大范围时使用 `domainatlas build --max-files 500`（默认 200，范围 1..2000）。按路径排序选取 Git 已跟踪源码，不包含未跟踪文件、测试、文档、依赖和常见构建产物。选取的文件若已删除或不是普通文件，命令会报错；修正索引或文件后重试。文档可作为 AI 输入的证据。

命令分批调用现有 codebase-memory 索引推导结构；索引不存在或工具未安装时使用低置信度路径推断。工具响应格式错误、进程失败等错误不会被掩盖。构建不会自动刷新索引，请在需要最新图谱证据时先通过 codebase-memory 对目标根目录建立或刷新索引。自动命名主要来自包、符号和路径；要得到业务语言命名，使用下面的 AI 方式。

返回 JSON 包含 `written`、`baseline.id`、领域和能力、证据文件内容哈希、构建时 HEAD，以及 `coverage`。`selectedFiles` 表示选取的文件数，不能证明业务语义完整；`limited` 表示有源码未被选取或图谱预算受限。AI 输入只引用部分文件时也会提示范围有限。

## 自然语言与 skill

将包内的 `skills/domainatlas` 安装到 AI 宿主的 skills 目录。以 Codex 的默认目录为例（已存在同名 skill 时先检查本地定制）：

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/domainatlas"
cp -R "$(npm root -g)/domainatlas/skills/domainatlas/." "${CODEX_HOME:-$HOME/.codex}/skills/domainatlas/"
```

全局 npm 安装包含 skill 文件，但不会自动复制到宿主目录。源码开发时可从本仓库 `skills/domainatlas/` 复制。让宿主重新加载 skills 后，可以说：

> 用 DomainAtlas 构建这个项目已有业务的业务图，基于源码和文档分析业务领域、能力及证据。

也可显式使用 `$domainatlas`。Skill 允许针对构建请求的自然语言选择，普通开发仍由 hooks 记录，不依赖 skill。目标项目须先初始化；若请求同时包含初始化，AI 可一并执行。

AI 分析后生成以下 JSON，再调用 `domainatlas build --input /absolute/path/to/baseline.json`。CLI 不内置大模型，也不调用远程模型服务。

```json
{
  "schemaVersion": 1,
  "domains": [{
    "name": "订单管理",
    "confidence": "medium",
    "evidence": [{ "file": "src/orders/order.ts", "reason": "实现订单生命周期管理" }],
    "capabilities": [{
      "name": "退款审核",
      "confidence": "medium",
      "evidence": [{ "file": "src/orders/refund.ts", "reason": "校验退款申请并执行审核状态转换" }]
    }]
  }]
}
```

`confidence` 为 `low`、`medium` 或 `high`。每个领域和能力必须提供证据；`file` 必须是目标仓库内真实、已跟踪、非符号链接的普通文件，使用相对路径。CLI 生成稳定 ID、校验引用并记录内容哈希，业务解释是否正确由分析者核实。示例中的路径不是默认值。

## 存储与更新

基线作为一个完整 JSON 写入 `.domainatlas/baselines/`，校验失败或预览不会写入，重复相同构建不会新增文件。变化后的构建追加新快照。UI 使用最新创建的基线，合并 `.domainatlas/domains/` 和 `capabilities/` 中的增量事实；同 ID 时优先使用基线，原始事实均保留。因此再次导入时要提交完整的目标基线范围。它不是删除已有增量能力的入口。

基线不会增加变更账本条数，`domainatlas list` 仍可能为空。在统一 UI 的全部项目列表中选择该项目，点击刷新可看到领域、能力、证据及基线范围提示。旧版项目未显示时，参见[多项目工作台](multi-project-ui.md)登记项目。基线记录的 HEAD 是扫描时的代码上下文，不表示基线事实已经提交；提交和推送需单独执行。后续已接入的 Codex hooks 继续记录增量变化。

本地开发版本可在目标项目根目录执行 `node /absolute/path/to/DomainAtlas/dist/src/cli.js build`；先在工具仓库 `pnpm build`。源码修改不会自动升级已全局安装的 npm 包。
