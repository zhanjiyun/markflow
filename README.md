# MarkFlow

本地优先的 Markdown 桌面编辑器，专注于写作体验。

MarkFlow 基于 Tauri v2 构建，提供所见即所得编辑、源码编辑、实时预览和分栏视图，支持多标签管理、AI 写作辅助和会话持久化。

## 主要特性

- **所见即所得编辑**：基于 Milkdown / ProseMirror，支持类 Typora 的即时渲染体验
- **源码模式**：基于 CodeMirror 6，支持语法高亮和格式化快捷键
- **分栏视图**：左侧源码 + 右侧实时预览，支持同步滚动
- **仅预览模式**：纯阅读视图，支持字体缩放
- **多标签管理**：支持固定标签、拖拽排序、批量关闭、标签重命名
- **文件树**：打开文件夹后可通过侧边栏浏览和管理 Markdown 文件
- **目录大纲**：从文档标题自动生成，点击跳转，滚动高亮
- **AI 写作助手**：支持兼容 OpenAI 接口格式的 API（默认 DeepSeek），提供润色、翻译、扩写、缩写、总结等快捷操作
- **会话持久化**：自动保存打开的标签、光标位置和界面状态，下次启动恢复
- **导出**：支持导出 HTML、纯文本，以及通过浏览器打印生成 PDF
- **搜索替换**：支持在源码、预览和所见即所得三种模式下搜索与替换
- **快速切换**：Ctrl+P 按文件名快速定位并打开工作区文件
- **明暗主题**：支持亮色和暗色主题切换
- **专注模式 / 禅模式**：隐藏侧边栏或进入全屏无干扰写作
- **拖拽打开**：支持拖拽 .md 文件或文件夹到窗口直接打开
- **自动保存**：编辑内容 1 秒后自动保存到磁盘
- **字数统计**：实时显示词数和字符数

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri v2 |
| 前端框架 | React 19 + TypeScript |
| WYSIWYG 编辑器 | Milkdown (ProseMirror) |
| 源码编辑器 | CodeMirror 6 |
| Markdown 渲染 | markdown-it |
| 数学公式 | KaTeX |
| AI 通信 | reqwest (Rust 侧 HTTP 客户端) |
| 打包 | NSIS（Windows 安装包） |

## 安装与运行

### 前置条件

- Node.js 22+
- Rust 1.77+（`stable-x86_64-pc-windows-msvc`）
- Windows 平台需安装 Visual Studio Build Tools（含 C++ 工作负载）

### 开发运行

```bash
# 安装依赖
npm install

# 启动前端开发服务器
npm run dev

# 启动 Tauri 应用（另开终端）
npx tauri dev
```

### 构建打包

```bash
npx tauri build
```

构建产物位于 `src-tauri/target/release/bundle/nsis/`，生成 `markflow-setup.exe` 安装包。

## 本地数据存储

MarkFlow 是本地优先的应用，所有数据默认存储在本地，不会上传到任何服务器。

### 数据保存位置

| 数据类型 | 存储位置 |
| -------- | -------- |
| 你的 Markdown 文件 | 你自行选择的路径（MarkFlow 直接读写本地 `.md` 文件） |
| 会话状态（打开的标签、光标位置、界面布局等） | `%LocalAppData%\com.markflow.editor\session.json` |
| 未命名草稿恢复文件 | `%LocalAppData%\com.markflow.editor\untitled\` |
| AI 设置与对话历史 | 浏览器 localStorage（WebView 数据目录中） |
| 最近文件 / 工作区 | 浏览器 localStorage |

> **快速打开数据目录**：在 MarkFlow 中打开设置（右上角齿轮图标），点击「打开数据目录」按钮即可。

### 如何备份

备份 `%LocalAppData%\com.markflow.editor\` 整个文件夹即可，包含：
- `session.json` — 当前所有打开的标签和界面状态
- `session.json.bak` — 自动备份的上一份会话
- `untitled/` — 未命名标签的自动保存内容

### 如何彻底重置应用状态

1. 关闭 MarkFlow
2. 删除 `%LocalAppData%\com.markflow.editor\` 文件夹
3. 重新启动 MarkFlow，所有设置和会话恢复数据将回到初始状态

### 未命名草稿恢复

未命名（未保存路径的）标签会自动备份到 `untitled/` 目录中。
如果 MarkFlow 异常退出，下次启动时会自动检测并恢复这些草稿。

> **安全提示**：AI API Key 以明文形式存储在 `localStorage` 中。请勿在不受信任的环境中使用。

## 项目结构

```text
markflow/
├── public/                 静态前端资源
├── src/                    React 前端源码
│   ├── components/         界面组件
│   ├── hooks/              自定义 Hook（文件系统、AI、会话等）
│   ├── types/              类型定义
│   ├── utils/              工具函数（导出、Markdown 渲染等）
│   ├── index.css           全局样式
│   └── main.tsx            应用入口
├── src-tauri/              Tauri 后端（Rust）
│   ├── src/
│   │   ├── lib.rs          后端逻辑（AI 代理、文件读写、会话管理）
│   │   └── main.rs         入口
│   ├── Cargo.toml          Rust 依赖与版本
│   ├── tauri.conf.json     Tauri 配置（窗口、打包、版本号）
│   └── icons/              应用图标
├── tests/                  Markdown 渲染测试用例与运行器
├── package.json            前端依赖与脚本
├── vite.config.ts          Vite 构建配置
└── rust-toolchain.toml     Rust 工具链约束
```

## 测试

```bash
# 本地回归测试（自定义用例）
npm run test:markdown

# CommonMark 0.31.2 规范兼容性测试
npm run test:spec
```

CommonMark 0.31.2 兼容性：**647/651 通过（99.4%）**，4 个失败项均集中在自动链接（Autolinks）的边界情况处理上。

> 规范测试数据来自 CommonMark 官方 spec.json。如需重新获取：
>
> ```bash
> curl -L -o tests/spec.json https://spec.commonmark.org/0.31.2/spec.json
> ```

## 当前限制

- **仅支持 Windows**：Rust 工具链固定为 `stable-x86_64-pc-windows-msvc`，打包格式为 NSIS。macOS 和 Linux 尚未适配。
- **单窗口应用**：不支持多窗口。
- **AI 非流式响应**：AI 对话采用一次性返回，不支持逐字流式输出。
- **PDF 导出依赖浏览器打印**：通过打开系统打印对话框生成 PDF，而非直接生成 PDF 文件。
- **Markdown 文件关联**：目前仅支持 `.md`、`.markdown`、`.mdown`、`.mdx` 扩展名。
- **CommonMark 自动链接**：有 4 个边界用例未通过（URL 中含空格、裸 URL/邮箱的识别策略与标准存在差异）。

## 常见问题

### 双击 .md 文件没有用 MarkFlow 打开？

1. 右键 .md 文件 →「打开方式」→「选择其他应用」
2. 找到 MarkFlow，勾选「始终使用此应用打开 .md 文件」
3. 如果 MarkFlow 不在列表中，点击「在这台电脑上查找其他应用」，找到 MarkFlow 安装目录下的 `MarkFlow.exe`

### 如何卸载？

通过 Windows 设置 → 应用 → 已安装的应用 → 找到 MarkFlow → 卸载。
卸载后建议手动删除数据目录 `%LocalAppData%\com.markflow.editor\` 清除残留数据。

### 升级到新版本后，旧设置还在吗？

在的。升级安装不会清除应用数据目录，会话和设置会自动保留。

### 如何免安装使用（便携版）？

参考 [便携版说明](docs/PORTABLE.md)。

## 快捷键速查

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + N` | 新建文件 |
| `Ctrl + O` | 打开文件 |
| `Ctrl + S` | 保存 |
| `Ctrl + /` | 切换源码 / 所见即所得模式 |
| `Ctrl + P` | 快速切换文件 |
| `Ctrl + F` | 查找 |
| `Ctrl + H` | 查找并替换 |
| `Ctrl + Shift + E` | 切换侧边栏 |
| `Ctrl + Shift + I` | AI 助手 |
| `F11` | 禅模式（专注模式） |
| `Ctrl + 滚轮` | 缩放预览字体 |

## 开源协议

本项目基于 MIT License 开源。详见 [LICENSE](./LICENSE) 文件。

## 致谢

MarkFlow 依赖以下开源项目：

- [Tauri](https://tauri.app/) — 桌面应用框架
- [Milkdown](https://milkdown.dev/) — WYSIWYG Markdown 编辑器
- [CodeMirror](https://codemirror.net/) — 代码编辑器
- [markdown-it](https://github.com/markdown-it/markdown-it) — Markdown 解析器
- [KaTeX](https://katex.org/) — 数学公式渲染
- [Lucide](https://lucide.dev/) — 图标库
