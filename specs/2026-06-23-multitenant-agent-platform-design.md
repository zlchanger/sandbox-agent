# 多租户隔离 Agent 应用 · 方案 A 设计文档

- 日期:2026-06-23
- 状态:设计待评审(Draft)
- 范围:面向非开发用户的、对话式、多租户、带隔离性的 Agent 应用
- 选型基调:**自建一层薄控制面 + 可替换沙箱运行时(经 SandboxRuntime 抽象)+ 最大化复用 sandbox-agent 等开源件**
- 修订:2026-06-24,核对 boxlite 源码后修正其能力认知(快照**仅磁盘、无内存热恢复**),据此重写会话生命周期(§4)、底座决策(§10)、风险(§11)与验收(§12);新增 skill/MCP 开机重放(§4.4)。底座(Coder/Boxlite/Docker)**待拍板**。

> 本文是方案 A 的设计稿。实现计划(分阶段任务)在评审通过后单独产出。

---

## 1. 背景与目标

### 1.1 要做什么

一个面向**非开发人员**的 Agent 应用,体验类似**在线客服**:用户持续多轮问答,Agent 帮助**分析文档、查询数据**等业务任务。Agent 可以**自主编写并运行脚本**来完成某个任务(例如解析一个文档),但**不做软件研发**(不拉取代码、不改代码库)。

- Agent 核心复用 **OpenCode**(模型可接 Kimi/Moonshot)。不自研 Agent 内核。
- 业务能力通过 **skills / MCP server / CLI** 提供,少量自写。
- **多租户**,租户间数据与执行相互隔离。

### 1.2 关键非功能目标

- **隔离性**:租户间数据隔离;AI 自写脚本在隔离环境中执行,控制爆炸半径。
- **会话连续性**:多轮对话需保留上下文(类在线客服),不能一问一答即抛弃。
- **启动快、体量轻**:活跃时秒级响应,闲时不烧资源。
- **自托管**,**不强依赖 Kubernetes**。
- **MVP 优先**,管理能力可渐进式长出。
- **尽量复用开源**(对应诉求「非自主开发」)。

### 1.3 非目标(Out of Scope)

- 不做面向开发者的 IDE / SSH / 代码仓库工作流。
- 不在 MVP 阶段实现完整的计费、SSO、审计合规体系(预留扩展位)。
- 不自研 Agent 内核、不自研沙箱虚拟化底座。

### 1.4 已决策的前提(来自需求澄清)

| 维度 | 结论 |
|---|---|
| 状态模型 | 混合:**持久数据(对象存储+DB)+ 临时计算** |
| 计算生命周期 | **会话级**:活跃保持运行;中等空闲停机留盘、重开即恢复;长闲销毁、从 PG 事件 + 控制面清单重建(详见 §4)。**不依赖内存热恢复** |
| 部署 | 自托管,不依赖 K8s |
| 运行时 | 经 **SandboxRuntime** 抽象解耦,具体底座**待拍板**(Coder / Boxlite / Docker,权衡见 §10);三者均**仅冷启、无内存热恢复** |
| Agent 控制 | **sandbox-agent (Rivet)** 驱动 OpenCode |
| Coder | 作为底座候选之一参与权衡(§10);信息架构亦可作管理页参考 |

---

## 2. 总体架构

三层,均自托管、不依赖 K8s:

```
                 ┌──────────────────────────────────────────────┐
 终端用户 ──────▶│  对话前端(客服式 Chat UI)                   │
 (非开发)         └───────────────┬──────────────────────────────┘
                                  │ HTTP / SSE(后端优先,凭据不下发浏览器)
                 ┌────────────────▼─────────────────────────────┐
                 │  控制面 Control Plane(自建,核心代码)        │
                 │  · SessionManager  会话↔Box 生命周期/停机留盘/重建│
                 │  · TenantRouter    鉴权、租户路由、配额        │
                 │  · SandboxRuntime  运行时抽象接口(可换实现)  │
                 │  · sandbox-agent SDK(后端侧,持久化到 PG)    │
                 └───┬─────────────────┬──────────────────┬──────┘
                     │                 │                  │
        ┌────────────▼─────┐  ┌────────▼────────┐  ┌──────▼──────────┐
        │ 沙箱运行时(可换)│  │ 认证/租户(复用)│  │ 数据层           │
        │ Docker/微虚机    │  │ Logto/Zitadel   │  │ Postgres+对象存储│
        │ ┌──────────────┐ │  │ /Keycloak       │  │ (MinIO/S3)      │
        │ │ Box(=会话)   │ │  └─────────────────┘  └─────────────────┘
        │ │ sandbox-agent│ │
        │ │  server      │ │   ← 在 Box 内:0.0.0.0:PORT 暴露 HTTP/SSE
        │ │  + OpenCode  │ │      控制面通过 SDK 连接,事件落 Postgres
        │ │  + skills    │ │
        │ │  + MCP/CLI   │ │
        │ └──────────────┘ │
        └──────────────────┘
```

拓扑遵循 sandbox-agent 官方建议(`docs/orchestration-architecture.mdx`):**SDK 跑在你的后端**,前端只跟后端通信;后端负责长连接、会话亲和、跨请求状态、优雅恢复。

---

## 3. 组件与「复用 vs 自建」清单

| 组件 | 选型 | 自建/复用 | 说明 |
|---|---|---|---|
| 对话 UI | 自有前端 | 自建(可用现成 Chat 模板) | 客服式多轮对话;不暴露开发概念 |
| 控制面 / SessionManager | 自有后端 | **自建(核心)** | 会话↔Box 映射、停机留盘/重建、租户路由 |
| 沙箱运行时 | 经 **SandboxRuntime** 抽象;MVP Docker,强隔离切 **Boxlite**(`@boxlite-ai/boxlite`,`SimpleBox`)/microVM | 复用开源 | 底座待拍板(§10);见 `examples/boxlite`、`examples/coder` |
| Agent 控制 + 事件流 + 持久化 | **sandbox-agent (Rivet)** | 复用开源 | `SandboxAgent.connect` / `SessionPersistDriver` |
| 早期观测页 | sandbox-agent **Inspector** | 复用 | 直接当 v0 运行观测 |
| Agent 核心 | **OpenCode**(接 Kimi/Moonshot 模型) | 复用 | KimiCode 见 §9 |
| 认证 / 租户 / RBAC / API key | **Logto / Zitadel / Keycloak** | 复用开源 | 提供组织、用户、角色、密钥 |
| 关系数据 | Postgres | 复用 | 会话记录 + 事件历史(`SessionRecord`/`SessionEvent`) |
| 对象存储 | MinIO(或 S3) | 复用 | 租户文档/数据/产物 |
| 业务能力 | skills / MCP server / CLI | 复用 + 少量自写 | 打进 Box 镜像或启动时装载 |

**自建的核心其实只有「控制面 + 前端」**,其余皆复用。这是方案 A 的最大价值。

---

## 4. 会话生命周期(核心)

`SessionManager` 把「一段对话会话」映射到「一个沙箱 Box」。

**前提修正**:Boxlite/Coder/Docker **均无内存热恢复**(Boxlite 的 snapshot 仅 QCOW2 磁盘,见 §10)。本方案因此**不依赖温启**,而用「活跃保持运行 + 空闲分级回收」的三档梯子。这套恢复机制全部在 sandbox-agent + 控制面层实现,**与底座无关**。

```
 新对话 ──▶ PROVISIONING ──▶ ACTIVE(运行中)
            起 Box + 装 OpenCode +     │  用户持续 / 短间隔问答:沙箱一直开着,
            重放 skill/MCP + 挂数据     │  零恢复、秒回
                                        │
                                  空闲 > idleStop
                                        ▼
                                 STOPPED(停机留盘)
                                        │  用户回来:重开 Box,磁盘上的
                                        ▼  OpenCode 会话/skill/MCP 还在
                                 RESTORING ──▶ ACTIVE
                                        │
                                超长不活跃 / 会话显式结束
                                        ▼
                                 ARCHIVED(销毁 Box + 回收磁盘;
                                          会话留在 PG,可重建)
```

### 4.1 三档空闲与回收

| 档位 | 触发 | Box 处理 | 恢复路径 | 闲时成本 |
|---|---|---|---|---|
| 活跃 / 短间隔 | 持续会话 | **保持运行** | 无需恢复 | RAM/CPU 常驻 |
| 中等空闲 | 空闲 > `idleStop` | **停机但保留磁盘** | 重开,磁盘上的会话/skill/MCP 原样在 | 仅磁盘 |
| 长闲 / 归档 | 空闲 > `archiveAfter` 或显式结束 | **销毁,回收磁盘** | 新起 Box + 重放 skill/MCP(§4.4)+ 尾部回放(§4.3) | 仅 PG/对象存储 |

「闲时不烧资源」= 停掉 RAM/CPU;磁盘便宜可多留一会,真正长闲才回收磁盘。

### 4.2 两类「上下文」分开存(确保关了也不丢)

| 上下文 | 存在哪 | 销毁 Box 会丢吗 |
|---|---|---|
| **对话历史**(transcript/事件) | Postgres(`SessionPersistDriver`) | 不丢,可回放 |
| **skill / MCP 配置** | **控制面 DB(权威清单)**;运行时副本在 Box 内 | 清单不丢;Box 内副本随销毁丢,靠 §4.4 重放 |
| **沙箱工作态**(文件) | Box 磁盘;关键产物本就在对象存储 | STOPPED 不丢;ARCHIVED 丢 Box 内的,产物仍在对象存储 |

### 4.3 对话上下文回放(只带当前会话)

走 sandbox-agent 的 **Session Restoration**(`docs/session-restoration.mdx`):按 `SessionRecord` 的 **local session id** 重建会话,**只回放该会话的近期事件**作为下一条 prompt 的上下文;其它历史会话是独立记录,**不会被加载**。

- 回放是**有界尾部回放**:`replayMaxEvents`(默认 50)/ `replayMaxChars`(默认 12000)。会话很长时,冷恢复只带回**最近的尾部**,不是完整重建。
- **唯一要定的设计旋钮**:这两个上限。调大则上下文更全但 prompt 更大(更贵更慢);调小则反之。MVP 用默认起步,按实测调。

### 4.4 skill / MCP 重放(开机声明式恢复)

skill/MCP 配置存在 **in-sandbox 的 sandbox-agent server**,**不在** persist driver 的 schema(`SessionRecord`/`SessionEvent`)里。所以销毁重建后不会自动回来。

**机制**:控制面在自己 DB 里持有每个会话/租户的 **skill + MCP 清单(权威)**,每次 Box 冷启后、**第一条 prompt 之前**,用 `setSkillsConfig` / `setMcpConfig` 重放一遍(`docs/skills-config.mdx`、`docs/mcp-config.mdx`)。幂等、确定、与底座无关。STOPPED 重开时配置本就在磁盘上,此步可跳过或当幂等校验。

### 4.5 关键参数(MVP 默认,可配)

- `idleStop`:活跃到停机留盘阈值(建议 5-10 min)。
- `archiveAfter`:停机态保留时长,超过则 ARCHIVED(建议数小时到 1 天)。
- `maxConcurrentBoxesPerTenant`:租户级并发上限(配额)。
- `replayMaxEvents` / `replayMaxChars`:对话回放上限(默认值起步,见 §4.3)。

---

## 5. 一次对话回合的数据流

```
用户发消息
  → 前端 POST /chat → 控制面
  → TenantRouter:鉴权 + 解析租户 + 配额检查
  → SessionManager:
       若 ACTIVE     → 直接复用该 Box 的会话
       若 STOPPED    → 重开 Box(磁盘上的会话/skill/MCP 还在)→ ACTIVE
       若 无 / ARCHIVED → 新建 Box(挂租户数据)→ 重放 skill/MCP(§4.4)→ 重建会话 + 尾部回放(§4.3)
  → sandbox-agent SDK:session.prompt(...)
  → Box 内 OpenCode 执行(必要时自写脚本 / 调 MCP / 跑 CLI / 读挂载的数据)
  → 事件流 SSE 实时回前端,同时落 Postgres(边到边存)
  → 产物(报告/文件)写入对象存储,返回引用
  → 刷新会话 last-active 时间戳(驱动闲时停机 / 归档)
```

落库策略遵循 `docs/manage-sessions.mdx`:事件到达即写库;重连按 `offset = 最后事件 sequence` 续传,避免重复写。

---

## 6. 多租户与隔离

### 6.1 隔离层次

1. **计算隔离**:每个会话独立 Box(选 microVM/Boxlite 则独立内核,选 Docker 则 namespace 隔离),租户的 AI 自写脚本只能影响自己的 Box。
2. **数据隔离**:对象存储按 `tenantId` 前缀/桶划分;Postgres 行级带 `tenantId`;Box 只挂载**当前租户、当前会话**所需数据。
3. **凭据隔离**:LLM/MCP/第三方凭据按租户注入到对应 Box 的环境变量,不跨租户复用(参考 `examples/boxlite` 的 `env` 注入)。
4. **鉴权边界**:遵循 `docs/security.mdx`——**后端优先**,任何 sandbox 相关请求前先「认证调用方 + 校验其对目标会话/租户的访问权 + 限流 + 审计日志」。RBAC 复用认证组件(owner/member/viewer 起步)。

### 6.2 网络

- Box 内 `sandbox-agent server` 只对**控制面**可达(内网/回环+端口映射),不直接暴露公网。
- 前端永远只跟控制面通信,sandbox 凭据不下发浏览器。

---

## 7. 管理面(MVP 与路线图)

管理页是**你的应用的一部分**,渐进式建设。MVP 只做最基本,其余预留。

### 7.1 MVP(最小)

- **租户/用户**:直接用认证组件(Logto/Zitadel)自带的管理后台,几乎零自建。
- **运行观测**:直接用 sandbox-agent **Inspector** 看会话事件/transcript。
- **数据**:对象存储自带控制台(MinIO Console)看租户文件。

> MVP 阶段「管理页」≈ 复用三个现成后台 + 一个极简会话列表(自建)。

### 7.2 路线图(按需长出)

| 阶段 | 能力 | 复用基础 |
|---|---|---|
| P1 | 租户 & 用户管理、API key、配额 | 认证组件 + 控制面少量页面 |
| P2 | 运行/会话观测(状态、transcript、用量、错误) | Inspector + Postgres 事件 |
| P3 | 数据 & 能力配置(每租户文件、skills/MCP/CLI 开关) | 控制面 + 镜像/能力清单 |
| P4 | 沙箱/基础设施运维(在跑 Box、资源、kill/restart、镜像版本) | BoxRun + 控制面 |

信息架构可参考 Coder 的治理页(租户/RBAC/审计/模板)的组织方式。

---

## 8. 技术栈小结

- **运行时**:经 `SandboxRuntime` 抽象,MVP 可 Docker 起步,Boxlite(`SimpleBox`)/microVM 作为强隔离选项(底座待拍板,见 §10);OCI 镜像内含 `sandbox-agent` 二进制 + OpenCode + skills/MCP/CLI。
- **Agent 控制**:`sandbox-agent` TypeScript SDK(后端),`SessionPersistDriver` = Postgres。
- **控制面**:Node/TypeScript 后端(与 SDK 同栈,减少摩擦)。
- **认证**:Logto(自托管,组织/RBAC/API key 完整,最省事)——Zitadel/Keycloak 备选。
- **数据**:Postgres + MinIO。
- **观测(早期)**:Inspector;后续接 OpenTelemetry(`docs/telemetry.mdx`/`observability.mdx`)。

---

## 9. OpenCode 与 KimiCode 的关系(已定:OpenCode + Kimi 模型)

- sandbox-agent 有**一等公民的 OpenCode 适配器**,**无 KimiCode 适配器**(支持的是 OpenCode/Codex/Cursor/Amp/Pi/Claude Code)。
- **已采路径(①)**:用 **OpenCode 当 Agent 壳,Kimi(Moonshot)当模型**,零额外适配成本。Kimi 在 OpenCode 里是模型项(如 `opencode/kimi-k2`、`kimi-k2-thinking`、`kimi-k2.5`,见 `docs/agents/opencode.mdx`),不是独立 agent。
- **不采路径(②)**:独立 Kimi CLI 需自写一个 sandbox-agent 适配器,属额外工作量,**MVP 不做**,留待 P2+ 按需评估。

---

## 10. 底座选型:Coder vs Boxlite vs Docker(决策记录,已按实测修正)

**修正(2026-06-24)**:本节原称「Boxlite 有快照恢复、Coder 没有,故 Boxlite 更优」。**该前提错误**。核对 boxlite 源码:`SnapshotOptions` 是空结构,`create`/`restore` 的注释明写 “snapshot of the box's current **disk state**” / “restore box **disks**”,快照即 QCOW2 磁盘 COW;那些 `suspend`/`resume` 只是导出磁盘时用 SIGSTOP/SIGCONT 临时冻结 vCPU(`PauseGuard`),**没有把 guest 内存存盘再恢复的路径**。即 **Boxlite 与 Coder 一样,只有冷启 + 磁盘/回放重建,均无内存热恢复**。

叠加 §4 的结论(本方案根本不需要热恢复;且会话/skill/MCP 恢复全在 sandbox-agent + 控制面层、与底座无关),底座选型回到一个普通的 build-vs-buy:

| 维度 | Coder | Boxlite + 自建薄控制面 | Docker + 自建薄控制面 |
|---|---|---|---|
| 控制面 | 现成(模板/API/Web/基础 RBAC) | 自建 | 自建 |
| 重开延迟 | 最重(terraform apply ~5-15s) | 微虚机起,较快 | 容器起,秒级 |
| 隔离强度 | 取决于模板 | **每盒独立内核** | namespace |
| 成熟度 | 高 | 较新(R1) | 高 |
| License | 核心 AGPL;多组织/SSO/审计等治理走企业版收费 | Apache-2.0 | 宽松 |
| 交互纹理 | 面向开发者(SSH/IDE/Tasks),需全程隐藏 | 中性 | 中性 |

仍然成立的、不利于「扛 Coder 整套」的点:① 一盒两 agent(Coder 要 `coder agent`,我们要 `sandbox-agent + OpenCode`);② 开发者纹理与客服式产品错位;③ 真正想要的多租户治理(多组织/SSO/审计)恰在 Coder 企业版墙后,AGPL 核心只给基础;④ 频繁「停—留盘—重开」时 Coder 的 stop=reprovision 最重。

**待拍板的真问题**:你需不需要**内核级的每租户隔离**(microVM)?这指向 Boxlite/microVM,而非「用 Coder 的容器模板」。

**倾向(非最终)**:对面向非开发者的客服式产品,**自建薄控制面 + 经 `SandboxRuntime` 抽象的轻底座**仍是首选。**MVP 用 Docker 起步**(最成熟、最省、重开最快),把强隔离需求作为切到 **Boxlite/microVM** 的触发条件(见 §6 与 R1)。**仅当**确实要复用 Coder 的模板/RBAC/Web 当产品骨架、且接受其 License 与纹理代价时,才选 Coder。此项需正式拍板后回填本节结论。

---

## 11. 风险与待定项

| # | 风险/待定 | 影响 | 处置 |
|---|---|---|---|
| R1 | 恢复 UX 的延迟下限由 **OpenCode 冷启 + 上下文回放**决定(与底座基本无关) | 高 | 首周 PoC:测 OpenCode 冷启 + 尾部回放到「上下文就绪」耗时;据此定 §4.3 回放上限与 `idleStop`。底座侧仅测 Box 起停延迟,不再测「内存快照」(已确认不存在) |
| R2 | OpenCode 是编码 agent,要包装成非开发体验 | 中 | 通过系统提示/skills 收敛能力面;前端隐藏开发概念 |
| R3 | ~~KimiCode 适配口径未定~~ 已定 ①:OpenCode + Kimi 模型(§9) | 低 | 无需自写适配器;仅在确需独立 Kimi CLI 时(②)P2+ 重评 |
| R4 | 自写脚本执行的安全面(即便有微虚机) | 中 | 微虚机隔离 + 出网白名单 + 资源限额 + 凭据按租户隔离 |
| R5 | 规模假设:前期小规模(数十租户/低并发) | 低 | 控制面无状态、可水平扩;Box 调度后续接队列 |
| R6 | `SandboxRuntime` 抽象是否值得 | 低 | 值得:保留以后切 Docker/Boxlite/E2B 的余地,接口很薄 |
| R7 | 底座(Coder/Boxlite/Docker)未拍板(§10) | 中 | 由「是否需要内核级每租户隔离」决定;MVP 经 `SandboxRuntime` 用 Docker 起步,不阻塞控制面/前端开发 |

---

## 12. 验收标准(MVP 完成的定义)

1. 两个不同租户各自发起对话,Agent 能分析其上传文档/查询其数据,且**互不可见**。
2. 同一会话内多轮问答**保留上下文**;**活跃 / 短间隔期间沙箱保持运行、秒回**;**长闲停机后重开**,对话按**有界尾部回放**续上(界限可配,见 §4.3),skill/MCP 按 §4.4 重放。
3. 会话被彻底归档后再次进入,能**凭历史回放续上**对话。
4. 管理者可在 Inspector 看到任意会话的事件/transcript;在认证后台管理租户/用户。
5. 全栈**自托管、无 K8s 依赖**,一台机器可跑通 PoC。

---

## 附:与 sandbox-agent 现有能力的对应

| 设计点 | 仓库现有支撑 |
|---|---|
| 后端编排拓扑 | `docs/orchestration-architecture.mdx` |
| 事件持久化 / 续传 | `docs/manage-sessions.mdx`、`docs/session-persistence.mdx` |
| 关了不丢上下文(回放重建) | `docs/session-restoration.mdx` |
| Boxlite 起 Box + 跑 server + 连接 | `examples/boxlite/` |
| 后端优先鉴权 / RBAC | `docs/security.mdx` |
| 早期观测页 | `docs/inspector.mdx` |
| KimiCode/模型接入 | `docs/llm-credentials.mdx`、`docs/opencode-compatibility.mdx` |
