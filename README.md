# Codex Session Metrics · 会话指标

[![Test](https://github.com/AdJIa/codex-session-metrics/actions/workflows/test.yml/badge.svg)](https://github.com/AdJIa/codex-session-metrics/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Codex 桌面端本地插件：在当前聊天中查看 Token 用量、上下文快照，以及最近 10 次模型调用的平均 TTFT 和 TPS。适用于使用 custom 网关的本地会话，不依赖订阅额度接口。

- 从当前会话的插件面板入口点击 **statusx · 会话指标**，由宿主直接执行并打开。
- 展示当前轮、整个会话、最近请求的输入、输出、缓存及推理 Token，以及缓存输入占输入的百分比。
- 打开、切换会话和每秒刷新均走本地 MCP，不调用 AI 模型。
- 从桌面端调用元数据自动绑定当前会话，避免多个聊天串用统计数据。
- 可选本地流式代理收集 TTFT/TPS，原 API Key 保持不变。

> 当前为实验版本。MCP、日志解析、代理及滚动平均已通过自动化测试；桌面端最终展示位置取决于宿主，尚未完成原生 UI 端到端验收。

## 安装

需要支持插件与 MCP Apps 的 Codex 桌面端，以及 Node.js 22+。启用计时代理的安装脚本另需 macOS 和 Python 3.11+。仓库包含 dist 构建产物，安装使用时无需 npm install。

```sh
git clone https://github.com/AdJIa/codex-session-metrics.git
cd codex-session-metrics
codex plugin marketplace add "$PWD"
codex plugin add codex-session-metrics@local-session-metrics
```

完全退出并重新打开 Codex，在当前会话的插件面板入口选择 **statusx · 会话指标**。此入口由宿主直接打开，不发送聊天消息、不经过模型。

宿主调用 open_metrics 时传入空参数，并在请求元数据 thread_id / threadId 中携带当前会话；插件据此立即读取并展示指标。绑定区域仍支持按会话名称切换，名称来自本地 session_index.jsonl，缺少名称时显示“未命名会话”。未提供可靠元数据的旧宿主需从列表选择，不自动猜测最近活跃聊天。远程会话需要在日志所在的主机运行插件。

### 关于 /statusx

0.1.6 已移除原来的 statusx 技能入口，避免打开面板时触发模型。当前公开的桌面插件接口支持原生会话面板入口，未提供将自定义 /statusx 注册为内置命令的接口，因此本插件不宣称实现了原生斜杠命令。原生面板入口满足点击直开、自动绑定和零模型调用；自定义斜杠或快捷键仍需要宿主提供命令注册能力。

参考：[原生插件入口](https://developers.openai.com/plugins/build/extensions)、[宿主斜杠命令](https://learn.chatgpt.com/docs/reference/slash-commands)。

## 启用 TTFT / TPS

只安装插件即可读取本机日志中的 Token 和上下文快照。TTFT/TPS 需要在请求经过时记录流式时间，无法可靠补算旧调用。

在已有 custom provider 的 base_url 配置后执行：

```sh
python3 scripts/timing.py
```

脚本备份配置，启动仅监听 127.0.0.1:43188 的转发代理，并把选中 provider 的 base_url 指向 http://127.0.0.1:43188/v1。原网关地址从配置自动读取，凭证保持原样。重启 Codex 后开始积累计时样本；不足 10 次时展示已有的有效样本均值。

脚本支持标准 provider 表中的双引号 base_url，遇到无法安全匹配的配置会停止。macOS 后台注册失败时回退为独立进程，插件启动时会检查并恢复已启用的代理。

恢复原网关：

```sh
python3 scripts/timing.py --disable
```

随后重启 Codex。脚本恢复选中 provider 的原 base_url，停止代理，保留已有统计文件。

## 指标定义与限制

| 指标 | 计算方式 |
| --- | --- |
| Token | 读取本机 Codex JSONL usage，模型请求结算后更新 |
| 缓存输入占比 | 所选范围的缓存输入 Token / 输入 Token；输入为零或缺失时显示 — |
| 上下文 | 最近请求输入 + 输出 Token / 记录的模型窗口，是近似快照 |
| TTFT | 请求发出到第一个可见文本或工具参数增量到达，含网络和网关时间 |
| TPS | 每次调用的输出 Token / 首尾可见内容接收时间差，再对近 10 次成功完成调用取算术平均 |

- 失败、取消、进行中的调用不参与均值；缺失指标不按零计算，TTFT/TPS 分别展示有效样本数。
- 工具参数计入可见输出，工具执行时间不计入；只有单个缓冲内容事件时不计算 TPS。
- 按兼容协议从输出中扣除推理 Token；网关口径不同需要适配。缺少 usage 时以 o200k_base 估算，其他 tokenizer 可能有偏差。
- 代理需从 thread_id、x-codex-thread-id、session_id 或 x-codex-session-id 请求头取得 UUID。网关或客户端未提供可靠 ID 时，不会把计时随意归入会话。
- 当前转发保留请求路径，适用于 /v1 等路径一致的网关；需要路径重写的网关须另行适配。
- statusx 是原生会话面板的显示名称，当前插件 API 不支持注册自定义内置斜杠命令。

## 数据与隐私

本地统计位于 CODEX_HOME/session-metrics，默认是 ~/.codex/session-metrics。配置备份可能包含敏感信息，请勿提交或分享该目录。仓库不包含个人聊天记录、配置、凭证或运行时统计。

代理透明转发请求及鉴权头，不把凭证、请求或响应正文写入计时统计；每个会话仅保留最多 10 次完成调用摘要。插件解析本机会话日志中的 usage 字段，不向外部分析服务上报数据。

## 开发

```sh
npm ci
npm run build
npm test
```

测试使用临时目录和模拟会话，不需要真实聊天记录或 API Key。GitHub Actions 在 Node.js 22 上执行构建及测试。

- src/server.mjs：MCP 工具与原生面板入口。
- src/store.mjs：增量读取本机会话 usage。
- src/proxy.mjs、src/stream.mjs：流式转发和计时。
- src/averages.mjs：最近 10 次完成调用的滚动均值。
- web/：面板界面，构建为自包含 HTML。
- src/thread-context.mjs：从宿主 MCP 请求元数据解析当前会话。

MIT 许可证适用于本项目源代码；依赖包保留其各自许可证。详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
