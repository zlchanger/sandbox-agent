# 多租户隔离 Agent 应用 · 方案 A 设计文档

- 日期:2026-06-23
- 状态:设计待评审(Draft)
- 范围:面向非开发用户的、对话式、多租户、带隔离性的 Agent 应用
- 选型基调:**自建一层薄控制面 + 快沙箱运行时(Boxlite)+ 最大化复用 sandbox-agent 等开源件**

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
| 计算生命周期 | **会话级**:活跃保温、**闲时 checkpoint 挂起、回来 restore** |
| 部署 | 自托管,不依赖 K8s |
| 运行时 | **Boxlite**(Firecracker 微虚机,支持快照恢复,无 daemon) |
| Agent 控制 | **sandbox-agent (Rivet)** 驱动 OpenCode |
| Coder | 计算层弃用;仅作管理页信息架构参考(理由见 §10) |

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
                 │  · SessionManager  会话↔Box 生命周期/保温/快照│
                 │  · TenantRouter    鉴权、租户路由、配额        │
                 │  · SandboxRuntime  运行时抽象接口(可换实现)  │
                 │  · sandbox-agent SDK(后端侧,持久化到 PG)    │
                 └───┬─────────────────┬──────────────────┬──────┘
                     │                 │                  │
        ┌────────────▼─────┐  ┌────────▼────────┐  ┌──────▼──────────┐
        │ Boxlite 运行时   │  │ 认证/租户(复用)│  │ 数据层           │
        │ 微虚机+checkpoint │  │ Logto/Zitadel   │  │ Postgres+对象存储│
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
| 控制面 / SessionManager | 自有后端 | **自建(核心)** | 会话↔Box 映射、保温、快照、租户路由 |
| 沙箱运行时 | **Boxlite**(`@boxlite-ai/boxlite`,`SimpleBox`)+ BoxRun | 复用开源 | 见 `examples/boxlite` |
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

`SessionManager` 把「一段对话会话」映射到「一个 Boxlite Box」。状态机:

```
 新对话 ──▶ PROVISIONING ──▶ ACTIVE(温热)
            启动 Box +              │  用户持续问答:秒回(文件/内存都在)
            装 OpenCode/能力 +      │
            挂租户数据             空闲 > idleTimeout
                                    ▼
                              SUSPENDED(已 checkpoint 快照)
                                    │  用户回来
                                    ▼
                                 RESTORING ──▶ ACTIVE(秒级唤醒)
                                    │
                            超长不活跃 / 会话显式结束
                                    ▼
                                ARCHIVED(对话归档 PG + 销毁 Box)
```

### 4.1 两类「上下文」分开存(确保关了也不丢)

| 上下文 | 存在哪 | 关掉 Box 会丢吗 |
|---|---|---|
| **对话历史**(transcript/事件) | Postgres(`SessionPersistDriver`) | 不丢,可回放 |
| **沙箱工作态**(文件/内存) | Box 内,靠 Boxlite checkpoint/restore | 仅在 ARCHIVED 时丢;且关键数据本就在对象存储 |

### 4.2 两级恢复(对应 sandbox-agent 的两种能力)

1. **SUSPENDED → RESTORING**:用 **Boxlite checkpoint/restore** 秒级唤醒,文件+内存原样恢复。`SessionRecord.sandboxId` 记录绑定的 Box。
2. **ARCHIVED 后用户又回来**:Box 已销毁,走 sandbox-agent 的 **Session Restoration**(`docs/session-restoration.mdx`)——新起一个 Box,重建会话,**回放最近事件**(`replayMaxEvents`/`replayMaxChars` 受控)作为上下文,并重新挂载对象存储里的租户数据。

这样:**活跃秒回 · 闲时不烧钱 · 唤醒秒级 · 彻底销毁也能续上**。

### 4.3 关键参数(MVP 默认,可配)

- `idleTimeout`:活跃→挂起阈值(建议 5–10 min)。
- `suspendRetention`:挂起态保留时长,超过则 ARCHIVED(建议数小时~1 天)。
- `maxConcurrentBoxesPerTenant`:租户级并发上限(配额)。
- `replayMaxEvents` / `replayMaxChars`:跨重建回放上限(用默认值起步)。

---

## 5. 一次对话回合的数据流

```
用户发消息
  → 前端 POST /chat → 控制面
  → TenantRouter:鉴权 + 解析租户 + 配额检查
  → SessionManager:
       若 ACTIVE     → 直接复用该 Box 的会话
       若 SUSPENDED  → Boxlite restore → ACTIVE
       若 无 / ARCHIVED → 新建 Box(挂租户数据)→ 重建会话 + 回放历史
  → sandbox-agent SDK:session.prompt(...)
  → Box 内 OpenCode 执行(必要时自写脚本 / 调 MCP / 跑 CLI / 读挂载的数据)
  → 事件流 SSE 实时回前端,同时落 Postgres(边到边存)
  → 产物(报告/文件)写入对象存储,返回引用
  → 刷新会话 last-active 时间戳(驱动闲时挂起)
```

落库策略遵循 `docs/manage-sessions.mdx`:事件到达即写库;重连按 `offset = 最后事件 sequence` 续传,避免重复写。

---

## 6. 多租户与隔离

### 6.1 隔离层次

1. **计算隔离**:每个会话独立 Box(Boxlite 微虚机,独立内核),租户的 AI 自写脚本只能影响自己的 Box。
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

- **运行时**:Boxlite(`SimpleBox`)+ BoxRun;OCI 镜像内含 `sandbox-agent` 二进制 + OpenCode + skills/MCP/CLI。
- **Agent 控制**:`sandbox-agent` TypeScript SDK(后端),`SessionPersistDriver` = Postgres。
- **控制面**:Node/TypeScript 后端(与 SDK 同栈,减少摩擦)。
- **认证**:Logto(自托管,组织/RBAC/API key 完整,最省事)——Zitadel/Keycloak 备选。
- **数据**:Postgres + MinIO。
- **观测(早期)**:Inspector;后续接 OpenTelemetry(`docs/telemetry.mdx`/`observability.mdx`)。

---

## 9. OpenCode 与 KimiCode 的关系(待确认)

- sandbox-agent 有**一等公民的 OpenCode 适配器**,无 KimiCode 适配器。
- **推荐路径**:用 **OpenCode 接 Kimi(Moonshot)模型**,即「OpenCode 当 Agent 壳,Kimi 当模型」。这样零额外适配成本。
- 若**确需独立的 Kimi CLI**:需要自写一个 sandbox-agent 适配器,属额外工作量,**MVP 不建议**,留待 P2+ 评估。
- **待确认问题**:你说的「KimiCode」指的是 ① OpenCode 用 Kimi 模型,还是 ② 独立 Kimi CLI?默认按 ①。

---

## 10. 为什么不「复用 Coder + 换成 Boxlite」(决策记录)

Coder 的计算后端是 **Terraform 模板**(provisioner 仅 `terraform` 与测试用 `echo` 两种实现,见 `provisionersdk/proto/provisioner.proto`),且每个 workspace 必须内跑 `coder agent`。把它换成 Boxlite 需要自写一个 provisioner 或把 Boxlite 包成 TF 资源——**改造级工作**,并撞上四个根本冲突:

1. **生命周期冲突(最致命)**:Coder「启动」= 重新 provision,**没有内存快照 restore 概念**;与我们选定的「保温+checkpoint/restore」相悖,等于**抵消 Boxlite 的快与轻**。
2. **沙箱内 agent 冲突**:Coder 要 `coder agent`,我们靠 `sandbox-agent + OpenCode`,一盒两 agent。
3. **交互模型冲突**:Coder 偏「人用 SSH/IDE/Tasks 操作 workspace」,与「客服式聊天、Agent 代劳」错位;Coder Tasks 也是编码/开发取向。
4. **License**:Coder 核心 AGPL,治理类(RBAC/SSO/审计/多组织)多为企业版收费。

**结论**:要快和轻 → 自建薄控制面 + Boxlite(本方案);要省事和现成治理 → 原样用 Coder。两者难以兼得,本方案选前者。

---

## 11. 风险与待定项

| # | 风险/待定 | 影响 | 处置 |
|---|---|---|---|
| R1 | Boxlite 较新,checkpoint/restore 成熟度/性能需实测 | 高 | 立项首周做 PoC:起停、快照恢复延迟、并发密度基准 |
| R2 | OpenCode 是编码 agent,要包装成非开发体验 | 中 | 通过系统提示/skills 收敛能力面;前端隐藏开发概念 |
| R3 | KimiCode 适配口径未定(§9) | 中 | 先确认 ①/②;默认 ① |
| R4 | 自写脚本执行的安全面(即便有微虚机) | 中 | 微虚机隔离 + 出网白名单 + 资源限额 + 凭据按租户隔离 |
| R5 | 规模假设:前期小规模(数十租户/低并发) | 低 | 控制面无状态、可水平扩;Box 调度后续接队列 |
| R6 | `SandboxRuntime` 抽象是否值得 | 低 | 值得:保留以后切 Docker/Boxlite/E2B 的余地,接口很薄 |

---

## 12. 验收标准(MVP 完成的定义)

1. 两个不同租户各自发起对话,Agent 能分析其上传文档/查询其数据,且**互不可见**。
2. 同一会话内多轮问答**保留上下文**;中途空闲触发挂起,回来后**秒级恢复且上下文仍在**。
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
