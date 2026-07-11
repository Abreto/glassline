# Glassline Agent Handoff

本文件是给未来 coding agents 的项目状态说明。它不是用户营销文档；优先帮助后续修改保持 Glassline 的产品边界、架构约束和测试习惯。

## 产品边界

- Glassline 是一个只读的本地 AI agent session viewer，用于在浏览器里查看本机 agent session、transcript、命令输出、文件改动和 raw source data。
- 不要在没有明确产品决策的情况下加入 prompt submission、approve/deny、kill process、命令输入、交互式 web shell、WebSocket terminal 或任何会触碰执行链路的行为。
- 当前默认服务面向本机使用：`HOST` 默认是 `127.0.0.1`。如果为了手机测试改成 `HOST=0.0.0.0`，需要明确这是局域网暴露，不等于产品默认安全模型。
- HTTP Host 默认只允许 `localhost`、`127.0.0.1` 和 `::1`；反向代理或局域网访问必须用 `GLASSLINE_ALLOWED_HOSTS` 显式追加精确 hostname/IP。该白名单不提供鉴权，非 loopback 访问仍必须有外部认证。
- Provider 私有文件只允许作为 best-effort 数据源，不能当作稳定 API。解析失败、缺字段、索引滞后都要保守处理。
- 所有 session/timeline 数据都要尽量携带 `SourceRef`，并用 `quality` 明确数据质量：`complete`、`partial`、`process-only`、`stale`。

## 当前架构

- Runtime 是 Node.js 内置 HTTP server，无运行时 npm dependencies。`package.json` 的 scripts 包括：
  - `npm start` -> `node src/server.mjs`
  - `npm test` -> `node --test`
  - `npm run install-launchd` / `npm run uninstall-launchd` -> 安装或卸载 macOS user LaunchAgent。
  - `npm run check:sensitive-history` -> 扫描所有 reachable Git blob 的常见凭据和本机路径，并应用精确 baseline。
  - `npm run release-check` -> 顺序运行测试和历史敏感信息扫描。
- `src/server.mjs` 负责环境配置、provider 装配和启动 HTTP server。
- `src/http-app.mjs` 负责静态文件和 JSON API handler；只接受 `GET`，其他 method 返回 `405`，并确保所有响应包含统一安全头。
- `src/http-security.mjs` 负责 `GLASSLINE_ALLOWED_HOSTS` 解析、HTTP Host 校验和浏览器安全响应头。
- `src/server-listen.mjs` 负责 listen 和友好错误输出，例如 `EADDRINUSE`、`EPERM`。
- `src/core/provider.ts` 定义核心模型：`ProviderAdapter`、`Session`、`Turn`、`TimelinePage`、`TimelineItem`、`Message`、`CommandRun`、`ToolCall`、`FileChange`、`Status`、`SourceRef`、`ResumeRef`。
- `src/core/session-registry.mjs` 负责 provider 聚合、normalize、按 `lastUpdatedAt` 降序排序、`resumeRef` normalize、timeline page fallback、raw fallback，以及 adapter error session。
- Provider adapters 在 `src/providers/`：
  - `mock.mjs`：UI/demo 数据，默认启用。
  - `codex.mjs`：Codex process discovery + session-file adapter 汇总。
  - `codex-session-file.mjs`：读取和解析 `CODEX_HOME || ~/.codex` 下的 Codex JSONL。
  - `claude-code.mjs`：Claude Code process-only discovery。
  - `process-utils.mjs`：`ps` 进程发现、命令 token 化、process-only session 构造。
- Frontend 是 browser-native static modules，无 React/Vite/Tailwind：
  - `public/app.js`：应用状态、API 调用、session selection、timeline/raw 渲染、copy registry。
  - `public/api-client.js`：`requestJson()` 和 error state。
  - `public/timeline-renderers.js`：timeline grouping、safe markdown、activity group、collapsed output。
  - `public/session-renderers.js`：session/resume UI 小组件。
  - `public/styles.css`：移动端优先、双滚动区域布局。

## 运行、环境变量和 API

- 本地启动：
  ```sh
  npm start
  ```
- 默认地址：`http://127.0.0.1:6280`
- 常用环境变量：
  - `PORT`：HTTP port，默认 `6280`。
  - `HOST`：bind host，默认 `127.0.0.1`。
  - `GLASSLINE_ALLOWED_HOSTS`：逗号分隔的额外 HTTP Host hostname/IP；精确匹配、忽略请求 port，不允许 scheme、path、userinfo、port 或 wildcard。
  - `GLASSLINE_MOCK=0`：隐藏 mock provider。
  - `CODEX_HOME`：覆盖 Codex 数据目录，默认 `~/.codex`。
- 内部 smoke 命令示例：
  ```sh
  GLASSLINE_MOCK=0 PORT=6281 CODEX_HOME=test/fixtures/codex-home npm start
  ```
- HTTP API：
  - `GET /api/providers`
  - `GET /api/sessions`
  - `GET /api/sessions/:id`
  - `GET /api/sessions/:id/timeline?limit=80&cursor=<cursor>`：返回最新 timeline page；带 `cursor` 时返回更早一页。当前 cursor 是上一页窗口的起始 index 字符串。
  - `GET /api/raw/:id`

## Provider 当前行为

- `mock`
  - 返回一个完整 demo session，用于本地 UI 开发。
  - 可用 `GLASSLINE_MOCK=0` 关闭。
- `codex`
  - 进程发现使用 `ps -axo pid=,lstart=,command=`，匹配 `codex` / `codex-cli`，排除 app helper、daemon、Crashpad、Codex Computer Use 等非用户 session 进程。
  - session-file 读取 `session_index.jsonl` 和 `sessions/**/*.jsonl`。
  - 列表模式使用 lightweight summary；详情、timeline page 和 raw endpoint 按需读取完整 JSONL。
  - session title 要保持短标题：优先使用清理后的 `thread_name`；缺失或过长时，详情 parse 从第一条有意义的 user 请求提取标题；最终标题会截断到 96 字符，不能把完整 transcript/prompt blob 当 title。
  - `session-file` session id 形如 `codex:session-file:<uuid>`，质量通常是 `partial`。
  - `process-only` session id 形如 `codex:process:<pid>`，质量是 `process-only`。
  - 可确定 session id 时会把 process source 合并进匹配的 session-file session，并把状态标为 `running`；不能确定时保留 process-only，不用 cwd/时间窗口猜测。
  - `lastUpdatedAt` 的重要规则：完整 parse 用 index `updated_at` 与 JSONL 最新事件时间取较新值；summary 模式用 index 与 file mtime 取较新值；同一 session id 多个 rollout 文件时保留最新文件。
  - `resumeRef` 以 `codex resume <uuid>` 形式暴露，复制时只复制 raw provider argument。
- `claude-code`
  - 当前只做 process discovery，返回 `process-only` session。
  - 会从 `-r`、`--resume`、`--session-id` 提取 `resumeRef`，命令形式是 `claude -r <value>`。
- `tmux`
  - `SourceKind` 里已有 `tmux`，但当前没有 tmux adapter 或 web shell。
  - 如果未来增加，优先考虑只读 `tmux capture-pane` 视图；交互式 terminal 会改变产品边界。

## Frontend 当前行为

- Session list 按后端 `lastUpdatedAt` 降序显示；自动刷新间隔是 8 秒。
- 打开或切换 session 时，先加载最新 timeline page（默认 80 items）并自动定位到最新 message；向上滚动到 timeline 顶部附近时才用 cursor 加载更早 page 并 prepend。
- 后台刷新不会强制滚动；如果用户不在 timeline 末尾附近，当前已加载窗口会保留，避免打断阅读。
- 如果后台刷新发现 selected session 有比当前已加载尾部更新的 `lastUpdatedAt`，会在 timeline 末尾显示 `New content` 控制；点击它或向下滚到当前已加载窗口底部附近时，会从最新 page 沿 `nextCursor` 向后追到与已加载窗口重叠，再按 item id 替换已刷新项并追加未加载项，避免跨页缺口。
- 当前选中 session 刷新时会保留已经展开的 `activity_group` 和二级 details；切换 session 或浏览器重载后重置展开状态。
- 主布局是独立滚动容器：
  - desktop：左侧 `.session-list` 自己滚动，右侧 `.timeline` / `.raw-view` 自己滚动。
  - mobile：顶部横向 session strip，下面 timeline 独立纵向滚动，`body` 不作为主滚动容器。
- Timeline 顶层视觉主线是 message：
  - `message` 独立显示。
  - 连续 `command` / `tool_call` / `file_change` / `status` 合并为默认折叠的 `activity_group`。
  - 展开 group 后，command output、tool input/output、file diff 仍是二级折叠。
- Message 使用安全 markdown 子集渲染：
  - 支持 fenced code block、inline code、段落、换行、列表、blockquote、轻量 heading、bold/italic、链接。
  - 不支持 raw HTML；先 escape 再渲染白名单语法。
  - 链接只允许 `http:`、`https:`、`mailto:`。
  - Copy button 复制原始 message markdown，不复制 HTML。
- Raw view 始终是 escaped plaintext，不走 markdown renderer。
- UI 是信息密度优先的工具界面，不要改成营销页、hero page 或大装饰卡片。

## 测试和开发规则

- 搜索优先用 `rg` / `rg --files`。
- 手工编辑文件使用 `apply_patch`。
- `AGENTS.md` 必须进 git；每次大型修改架构、Provider、HTTP API、核心模型、前端行为、运行参数或测试策略时，都要同步更新本文件，避免未来 agent 依据过期上下文工作。
- 不要引入运行时依赖，除非有清楚理由并且同步更新测试和文档。
- fixture 和 mock 只能使用合成数据与 example path，不能提交真实 transcript、provider log、token、私有仓库路径或用户 home path。
- `.github/workflows/ci.yml` 在 macOS Node 20/22 和 Ubuntu Node 20 运行测试，并用完整 history 单独运行敏感信息扫描。
- 保持 read-only 边界；任何写入、控制、shell、WebSocket、PTY、prompt/approve/kill 行为都需要先做明确产品决策。
- 变更 provider/parser 时至少补 parser/provider 单测，尤其是：
  - malformed line 不应让整个 session 消失。
  - private file/index 缺失或滞后时要保守降级。
  - source/quality/resume metadata 不能丢。
  - timeline page 的 `items`、`nextCursor`、`hasMore` 要稳定，不能破坏旧的完整 `GET /api/sessions/:id` 行为。
  - process matcher 要排除 app helper、daemon、crash handler。
- 变更 frontend renderer/layout 时至少补对应 frontend tests：
  - markdown 必须保持安全 escape。
  - copy text 必须保持 raw source。
  - activity group 默认折叠。
  - 初始 timeline 只加载最新 page；向上滚动才加载更早 page，且 prepend 后不能跳动阅读位置。
  - 读历史时有新内容必须显示 `New content` 状态；点击或向下滚到底部附近能加载最新 page 并 append，不覆盖当前窗口。
  - mobile 独立滚动和 compact session card 不能回退。
- 提交前运行：
  ```sh
  npm run release-check
  git status --short
  ```

## 已知 MVP 限制

- Provider 数据是 best-effort，尤其 Codex/Claude 私有 session 文件不稳定。
- Codex session-file status 通常是 `unknown`，只有确定关联到运行中 process 时才标为 `running`。
- Claude Code 还没有 session-file/transcript parser。
- 没有通用 `jsonl` adapter、`tmux` adapter、app-server adapter。
- 没有鉴权、用户系统或远程部署模型；默认不要把它当共享网络服务。
- 没有 prompt 输入、approve、kill、命令执行或 web shell。
