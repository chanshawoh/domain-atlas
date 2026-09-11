# npm 版本发布

发布流程参考 Image2GenMCP 的 `script/release.sh`：默认执行检查，只有显式 `--publish` 才发布。入口保留 Bash 形式，内部用 Node.js 处理 pnpm 工作区、JSON 和错误状态；没有增加发布工具依赖。

## 使用

在 Git checkout 中使用现有 Node.js 22+ 和 `package.json` 固定的 pnpm 版本：

```sh
# 检查，不发布；也可用 pnpm release:check
bash script/release.sh

# 正式发布；也可用 pnpm release
bash script/release.sh --publish

# 帮助
bash script/release.sh --help
```

脚本可从任意目录启动，会定位回 DomainAtlas 工具仓库。检查模式允许未提交修改，但会提示正式发布要求干净工作区。检查会安装锁定依赖、生成构建产物，并在系统临时目录安装待发布包，结束后清理临时目录；它不是完全不写磁盘的只读命令。

## 发布前准备

1. 根目录 `package.json` 和 `apps/web/package.json` 使用一致的稳定版本号，如 `0.1.0`。升级版本时同时修改两处；当前脚本只发布稳定版到 `latest`，不处理预发布标签。
2. 运行默认检查。根包发布文件白名单包含 `dist/src`、`apps/web/dist`、`skills`、`docs` 和 README；子工作区 `@domainatlas/web` 保持私有，仅将其构建资源包含到根包。
3. 审阅并提交、推送准备好的修改，使本地 `main` 与远端 `origin/main` 的 SHA 一致。
4. 确认 npm 账号有目标包名的发布权限，必要时运行 `npm login --registry=https://registry.npmjs.org`，再执行 `--publish`。首次发布时包名可用性和账号权限最终以 Registry 为准。脚本不自动登录，不读取或打印令牌。

### npm 两步验证（EOTP）

在本机交互终端直接运行 `bash script/release.sh --publish`。最后的真实 `npm publish` 继承终端输入输出；如果 npm 账号要求两步验证，npm 会在此时提示输入认证器中的最新验证码，或打开其提供的浏览器验证流程。无需在开始构建前准备验证码，DomainAtlas 不采集或保存验证码。

`npm whoami` 成功只说明已经登录，不代表发布无需 OTP。通过管道或无 TTY 的 CI 运行时，npm 无法交互询问验证码；需要在运行环境中使用 npm 支持的发布认证方式。临时 `npm_config_otp` 环境变量也会由 npm 读取，但验证码可能在构建结束前过期，因此本机发布优先使用终端交互。

若 npm 已返回 `EOTP` 并退出，本次发布没有通过认证；重新运行前先确认目标版本是否存在。脚本会自行查询 Registry 并拒绝覆盖已有版本。修复脚本后仍需将改动提交、推送到 `origin/main`，才能通过正式发布的 Git 状态检查。

## 自动检查内容

- 校验版本一致性、公开 Registry 配置和 pnpm 版本；`pnpm install --frozen-lockfile --ignore-scripts` 使用锁文件，随后执行 `pnpm test`，包含前后端构建和回归测试。
- `pnpm audit --prod --audit-level=high` 阻止生产依赖存在高危或严重漏洞；网络或审计失败也会停止。真实图谱集成测试仍遵循项目的默认跳过规则。
- 只构建一个真实 `.tgz`，检查 CLI、Web HTML/JS/CSS、图标和技能文件。拒绝业务事实、环境文件、源码、测试、项目钩子等越界内容，并核对本地文件的 SHA-1 与 npm 打包清单。
- 临时安装该包，只安装生产依赖并禁用生命周期脚本；检查安装后的 CLI 帮助、全局钩子预览及 Web HTML、静态资源和只读 API。不会安装真实全局钩子，也不初始化当前项目。
- 对该 `.tgz` 执行 `npm publish --dry-run`。检查模式下未登录只提示；实际发布必须登录。
- 查询准确版本和 `latest`。只有明确 `E404` 才视为不存在，认证、限流、网络错误不会当作包名可用。已发布版本不可覆盖；检查模式只允许其 Registry shasum 与本地包一致。新版本必须高于当前 `latest`。
- 正式发布前再次检查分支、工作区、HEAD 和远端 SHA，并核对压缩包未变；发布的是同一个经过安装验证的包，禁用生命周期脚本以避免重新构建。
- 发布后最多查询 6 次，核对准确版本、`latest` 和 Registry shasum。只启动一次正式 `npm publish` 进程，npm 自身可在该进程内完成 OTP 或浏览器验证后继续请求；脚本不会自动重启失败的发布进程。如果发布成功但校验失败，应先人工检查 Registry 状态。

## 安装与发布边界

发布成功后，用户可以运行：

```sh
npm install -g domainatlas
domainatlas init -g --codex
```

全局钩子仍需 Codex `/hooks` 信任；目标项目执行过 `domainatlas init` 后才自动记录。

脚本只负责 npm 发布，不自动修改版本、创建 Git commit、推送分支、创建 Git tag 或 GitHub Release。GitHub Release 可在 npm 校验成功后单独创建，并指向相同版本的已验证提交。当前命令和全局钩子面向 macOS/Linux，未验证 Windows 原生环境。
