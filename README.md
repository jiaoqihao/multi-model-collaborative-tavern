# 夜航酒馆 · MyTavern

一个以固定玩家角色参与、可随时发送导演指令的多角色 AI 剧情创作平台。第一版基于 React / TypeScript、Vinext、Cloudflare Workers 和 D1（SQLite）。

## 已实现

- 多个故事、可编辑的世界背景、开场、叙事风格和玩家档案。
- 每个故事最多 6 个角色，各自有设定、秘密、位置、服饰、身体状态、情绪、内心、目标、关系和记忆。
- OpenAI Chat Completions、OpenAI 兼容协议、Anthropic Messages、Google Gemini GenerateContent 四种适配；模型 ID 自行填写，不锁定易过时的模型列表。
- 主 AI 与角色分别分配模型；连接测试；服务端 AES-GCM 加密保存 API 密钥；前端仅获取 `hasKey`。
- 导演分发信息 → 角色独立回应 → 协调事件及客观状态 → 生成有限视角旁白 → 数据库整体保存。
- 导演指令与故事内行动分开；默认不替玩家说话、决定或推断内心。
- 演示模式明确标记为固定规则，不调用模型，不具备自由续写能力。真实模式失败不会回退到演示。
- 每回合完整快照、记忆来源、祖先路径筛选、回退、分支及重新生成。
- 乐观并发检查，旧页面不会覆盖新进度；完成请求重放不会再次调用模型。
- 手机侧栏与角色档案抽屉；键盘提交；生成阶段反馈与保留失败输入。

## 本地运行（Windows PowerShell）

需要 Node.js 22.13+；当前环境已验证 Node.js 24。

```powershell
npm run install:ci
npm run setup:local
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_left_the_anarchist.sql
npm run dev
```

已初始化的本地数据库不要重复执行同一个 SQL 文件。后续 schema 修改需要生成并依次应用新的迁移。

访问 http://localhost:5173/。本地开发由 Sites 自带的本地登录流程设置演示身份；生产站点使用平台注入的登录身份，数据库查询均按用户隔离。

`setup:local` 仅在 `.dev.vars` 不存在时生成加密密钥，不会覆盖原值。服务已经启动时，创建或改变 `.dev.vars` 后需要重启。请将该文件与 `.wrangler/state` 一起备份；丢失加密密钥后必须重新填写 API 密钥。

`npm start` 是底层 Worker 预览，不提供 Vite 的本地模拟登录。日常本地开发请使用 `npm run dev`。

## 第一次使用

1. 打开示例故事“雨夜来信”，在演示模式发送一句话，检查角色状态与历史版本。
2. 打开“模型与连接”，选择协议，填写基础地址、准确模型 ID 与 API 密钥，保存并测试已保存配置。
3. 选择“导演与叙事主 AI”，再关闭演示模式。每个角色默认跟随主 AI，可在角色设定中改为其他模型。
4. 在“角色行动”写自己的行动与台词；“导演指令”用于幕后安排。Ctrl / Cmd + Enter 提交。
5. 打开幕后信息可查看角色内心、秘密、记忆和信息分发。此开关仅影响作者界面，不会赋予玩家角色这些知识。
6. 在“剧情版本”切换任意回合，或重新生成当前回合。旧版本保留，状态与记忆不会叠加到新版本。

更换 API 地址或协议时需要重新填写密钥，避免将原服务商密钥误送到新地址。连接测试会发送小型真实请求，可能计费。

## 数据与执行设计

数据库第一版采用三个关系表：`stories`（用户、配置、根快照、当前快照、版本号），`turns`（父回合、正文、角色快照、分发记录），`profiles`（用户、模型配置、加密密钥）。角色在 JSON 快照中按 ID 独立保存，不是每个角色创建物理数据库。

一轮最多唤醒 4 个角色。角色调用可以并行；先完成信息分发，角色只得到自己的设定、秘密、相关记忆和获准感知的信息。裁决器确定客观变化，再将玩家可感知的事件交给叙事器。最终状态校验通过后，以 D1 `batch()` 原子保存回合与故事进度。外部 API 调用期间不持有数据库事务。

完整快照和父回合指针支持分支恢复。信息检索使用关键词（包含中文二元词片段）、重要性和近期经历，尚未使用向量数据库。用户可以编辑角色状态，编辑只影响当前进度之后的新回合。

## 验证

```powershell
npm run typecheck
npm run lint
npm test
# 在已运行 npm run dev、已应用本地迁移后：
npm run test:integration
```

核心测试使用模拟模型响应，不产生外部调用费用，覆盖上下文隔离、隐藏事件过滤、错误结构、未知角色、分支、加密及四类协议。接口测试验证真实本地 D1 的状态持久化、并发、重生成、回退、身份校验及密钥脱敏，结束后只清理其新建的测试数据。

## 当前边界

- 每个故事最多保存 150 个回合版本，适合验证产品流程；尚未实现历史归档、向量检索、长期剧情线索专表或自动总结压缩。
- 一轮仅执行一次角色响应阶段，尚无角色之间的多轮内部讨论。单回合正常需 3 次主 AI 调用和 0–4 次角色调用；格式重试和网络重试可能增加次数。
- 推送的是生成阶段进度，正文在全部生成、校验和保存后显示；尚未逐字流式显示正文。
- 信息范围、事件成立和旁白一致性的语义判断仍依赖模型，结构校验不能保证所有剧情都无矛盾。尚未使用用户的真实 API 密钥做在线模型联调。
- 正式版本目前依赖 Sites 登录和 Cloudflare Workers/D1；不是可直接运行的独立多用户自托管服务器。
- 未进行浏览器点击、截图和视觉测试。可选 WebMCP `stage_story_input` 仅填写待审核输入，不提交或调用模型；没有可用的验证上下文时不宣称其已验证。

## 部署

`.openai/hosting.json` 保留当前 Site ID 与 `DB` 逻辑绑定。使用 Sites 发布流程将已验证的源代码和构建产物发布到私有站点。生产环境必须设置独立的 `TAVERN_ENCRYPTION_KEY` secret；不要复用本地值，不要提交 `.dev.vars`。

密钥与故事正文不会写入应用日志。模型接口只允许公开 HTTPS 地址；原生协议限制官方域名，兼容接口不跟随重定向。单纯地址语法检查无法全面解决恶意 DNS 场景，若将来开放给不受信任的用户，需要进一步增加出口域名策略、配额和速率限制。

协议依据：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content)。
