# Codex Session Metrics · 会话指标

[![Test](https://github.com/AdJIa/codex-session-metrics/actions/workflows/test.yml/badge.svg)](https://github.com/AdJIa/codex-session-metrics/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Codex 桌面端本地指标插件，仅读取 Codex 自身保存的会话记录。打开、切换和刷新均由本地代码执行，不调用 AI 模型，不依赖 CC Switch、计时代理或特定网关。

- Token：当前轮、整个会话、最近请求、最近 10 次调用的输入、输出、缓存及推理用量。
- 缓存输入占比：所选范围的总缓存输入 / 总输入 Token；同时展示未命中读取缓存的输入和缓存写入。
- 上下文快照：Codex 最近上下文 Token / 有效模型窗口，与真实请求用量分别保存。
- 上下文压缩：次数、最近压缩前后大小、变化比例及已记录的耗时。
- TTFT：最近完成轮次的首 Token 延迟。
- TPS：最近完成轮次的累计输出 Token / 整轮耗时。
- 工具耗时：合并并行工具的时间区间，展示已记录耗时占整轮的比例。
- 近 10 轮趋势：TTFT 均值、中位数、按耗时加权的整轮 TPS，以及各轮模型、推理强度、提供商。
- 最近调用：展示最近 10 次已结算模型调用，不足 10 次展示已有记录。
- 绑定会话：默认从宿主元数据绑定当前会话，支持按会话名称切换。

看板采用紧凑布局：上下文占用环、缓存输入分段图、压缩前后对比、轮次趋势和调用输出柱图；详细记录与指标说明按需展开。Token 用量位于第二排，默认查看整个会话。

## 安装与打开

需要支持插件与 MCP Apps 的 Codex 桌面端，以及 Node.js 22+。仓库包含 dist 构建产物，使用时无需 npm install。

```sh
git clone https://github.com/AdJIa/codex-session-metrics.git
cd codex-session-metrics
codex plugin marketplace add "$PWD"
codex plugin add codex-session-metrics@local-session-metrics
```

重启 Codex，在当前会话的插件面板入口选择 **statusx · 会话指标**。宿主直接执行 MCP 工具，不发送聊天消息、不经过模型。每秒刷新已有本机记录。

插件从请求元数据 thread_id / threadId 读取当前会话；旧宿主未提供可靠元数据时，可从会话名称列表选择，不自动猜测最近活跃聊天。名称读取自 session_index.jsonl；无名称时显示“未命名会话”。远程会话须在日志所在主机运行插件。

## TTFT / TPS 的统计口径

**两项主卡片均展示最近完成轮次的数据。** 本轮仍在进行时保留上一轮结果，结束后自动更新；取消的轮次不替换已完成结果。

TTFT 直接读取 task_complete.time_to_first_token_ms。TPS = 同轮累计 output_tokens / (task_complete.duration_ms / 1000)，没有 duration_ms 时使用该轮完成与开始时间差。输出用量优先使用 turn_token_usage，缺失时累加同轮去重后的调用用量；旧版仅有 token_count 时使用该轮前后的累计输出差值。

TPS 衡量整轮平均吞吐，耗时包含模型请求、工具执行和等待；与纯模型解码速度口径不同。界面同时展示计算所用的输出 Token 与耗时。缺少数据或时长为零时显示 —，真实零输出则显示 0。

最近 10 轮仅包含已完成轮次，不足 10 轮展示已有记录。TTFT 分别计算有效样本的均值和中位数；TPS 使用有效轮次的总输出除以总耗时。缺失值不按零纳入统计。轮次可能使用不同模型，展开明细可查看每轮配置；同轮切换配置时保留实际调用对应的配置列表。

工具耗时读取 item_completed 的 started_at_ms / completed_at_ms，按条目 ID 去重并对区间求并集，避免并行调用重复累计。界面显示条目数及含起止时间的数量，缺失时间不猜测。只覆盖已记录的命令、MCP、文件变更、动态工具及协作工具；后台命令在条目范围外继续运行的时间无法据此完整计入。

## 上下文、压缩与缓存

上下文快照优先反映按日志顺序收到的 Codex token_count.last_token_usage.total_tokens；请求用量记录也可更新快照。压缩后的快照可能只有 total_tokens 有值、输入和输出为零，因此它只更新上下文，不覆盖最近真实调用，也不新增调用次数。百分比限制在 0–100%，原始 Token 数保留。

压缩兼容 compacted、ContextCompaction 完成条目及旧 context_compacted 事件。使用事件标识去重，并在同轮相同完成时间区间内合并不同类型信号。压缩前后展示相邻已记录快照；缺少压缩后快照时显示 —，不会将下一次请求直接当作压缩后大小。

缓存占比按所选范围的总缓存输入除以总输入计算，不对每次百分比简单平均。未命中读取缓存的输入 = 输入 - 缓存读取；缓存写入单列，可能与未命中部分有重叠，三者不能相加。字段缺失显示 —，最近 10 次汇总中任一调用缺少某字段时，该字段汇总也显示 —。

最近 10 次模型调用明细独立保留，按 token_usage_record 的 response_id 去重，排除尚未结算的请求；没有该记录的旧版 Codex 则读取 token_count，仅在累计用量变化时新增记录。当前日志不保存逐次请求与首尾输出时间，主卡片使用上述轮次口径。

## 指标定义

| 指标 | 方式 |
| --- | --- |
| Token | 读取本机 JSONL usage，请求结算后更新 |
| 缓存占比 | 缓存输入 / 输入 Token；输入为零或缺失时显示 — |
| 上下文 | Codex 最近上下文快照 / 有效模型窗口，展示更新时间与来源 |
| 压缩 | 次数、相邻快照前后变化及生命周期耗时 |
| 最近调用 | 近 10 次已结算调用的时间、输入、输出和缓存占比 |
| TTFT | 最近完成轮次的 task_complete.time_to_first_token_ms |
| TPS | 最近完成轮次累计输出 Token / 整轮耗时，含工具与等待 |
| 工具占比 | 已记录工具时间区间并集 / 整轮耗时 |
| 近 10 轮 | TTFT 均值与中位数、总输出 / 总耗时、模型配置与趋势 |

## 从 0.1.6 及更早版本升级

0.1.7 已移除流式代理、启动代理逻辑和 tokenizer 依赖，不再读取独立计时文件。也没有引入 CC Switch 数据库适配。

如果旧版曾配置本地 43188 计时代理，运行以下恢复脚本，再重启 Codex：

```sh
python3 scripts/restore-gateway.py
```

脚本仅根据旧版安装状态恢复选中 provider 的原 base_url，并禁用代理自动启动。它暂留旧进程，避免打断仍使用旧配置的进行中会话；旧进程不再接收新版会话请求，系统重启后退出。脚本不会修改或发布 API Key。新用户不需要运行它。

## 原生入口与 /statusx

0.1.6 起移除了需要模型参与的 statusx 技能。statusx 是原生会话面板名称；公开插件 API 当前未提供自定义内置斜杠命令注册能力。

参考：[插件原生入口](https://developers.openai.com/plugins/build/extensions)、[宿主斜杠命令](https://learn.chatgpt.com/docs/reference/slash-commands)。原生入口元数据和自动绑定已通过协议测试；原生点击行为仍需在目标桌面版本验收。

## 数据与开发

仅读取 CODEX_HOME/sessions 和 CODEX_HOME/session_index.jsonl，默认位于 ~/.codex。插件不访问 API Key、不向分析服务上报数据、不持久化聊天正文。仓库不包含个人会话、配置或凭证。

```sh
npm ci
npm run build
npm test
```

测试使用临时模拟会话，不需要真实聊天或网关。GitHub Actions 执行构建及测试。MIT 适用于本项目源码，依赖保留各自许可证，见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
