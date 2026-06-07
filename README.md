# Auto Link Suggester (自动双链补全助手)

如果您觉得这款插件对您有帮助，欢迎在小红书（RED）上关注我，我会在那里分享更多技巧、教程和更新。

If you find this plugin helpful, feel free to follow me on Xiaohongshu (RED) where I share more tips, tutorials, and updates.

<a href="https://www.xiaohongshu.com/user/profile/6353523d000000001802f8ae?xsec_token=YB4vLkLfzOijtg8c1Vh12ZASaI1ByqPPYi82ZzKbG72qE=&xsec_source=app_share&xhsshare=QQ&appuid=6353523d000000001802f8ae&apptime=1780631605&share_id=3846902afcd94e2ab78467cd7b9b5669" target="_blank" style="display: inline-block; padding: 10px 20px; background-color: #ff2442; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; transition: background-color 0.3s;">📱 关注小红书</a>

💡 **温馨提示 / Notice:**
本插件是一款专为 Obsidian **中文汉字**深度输入体验设计的“智能双链补全助手”。它通过指定文件夹扫描、智能防抖缓存、中英文差异化触发以及多匹配模式，在保障库运行流畅的前提下，为您提供更符合直觉的本地笔记关联体验。

QQ交流群:1094620986


`Auto Link` 是一款致力于优化 Obsidian 输入流与卡片盒笔记关联的轻量化插件。它专注于解决“库文件过多导致全局搜索卡顿”以及“非双链语法下无法快速联想”的痛点。通过限定扫描范围、精细化的缓存更新与防抖机制，该插件能在不占用过多系统资源的前提下，为您提供高效、即时的输入补全体验。

---

## 🌟 核心功能

### 1. 指定文件夹扫描 (Folder-Targeted Indexing)
* **按需建立索引**：无需对整个知识库进行全局扫描，您可以自由指定一个或多个高频使用的核心文件夹（如日常随笔、人名库、项目列表等）。
* **自动去重与合并**：即使指定的文件夹存在包含关系，内部的 Map 数据结构也能自动去重，确保缓存占用与检索效率处于理想状态。

### 2. 智能触发与防打扰机制 (Smart Trigger Rules)
* **精准词汇提取**：插件会根据光标前的最后一个空格或标点符号自动切分，提取您当前输入的关键字，避免无谓的弹窗干扰。
* **双链状态识别**：当检测到光标已经处于已有的双链中（如 `[[...]]`），补全器将自动静默，防止二次干扰。
* **中英文差异化触发**：输入中文、日文等非 ASCII 字符时支持单字触发；输入英文等 ASCII 字符时，自动过滤单字母输入，需达到 2 个字符才触发，平衡输入流畅度。

### 3. 多匹配模式切换 (Fuzzy & Prefix Matching)
* **前缀模式 (Prefix)**：默认仅检索以输入字词开头的笔记名称，适合结构清晰的规范化命名。
* **模糊模式 (Fuzzy)**：开启后支持任意位置的包含匹配（例如输入“流”即可关联到“文件限流”、“信息流”），帮您快速发现笔记间的隐性关联。

### 4. 无缝原生双链生成 (Official Path Resolution)
* **遵循用户偏好**：调用 Obsidian 官方的 `generateMarkdownLink` 接口，生成的链接格式（如：相对路径、绝对路径、最短路径）将完全契合您在 Obsidian 软件中配置的全局首选项。
* **内联图示过滤**：自动识别并剔除可能因 API 默认生成的内嵌叹号（`!`），保障双链的纯净呈现。

### 5. 守护 CPU 的性能设计 (Performance-Oriented Architecture)
* **多重防抖机制**：无论是文件系统层面的“新建、重命名、删除”变动，还是您在后台输入文件夹配置的间歇，插件均内置了防抖控制器（Debounce）。合并多余计算，避免对硬盘和 CPU 造成高频读写压力。
* **列表限流展现**：补全建议框单次至多渲染 10 条结果，降低频繁键入时的 UI 渲染开销。

---

## ⚙️ 数据存储机制

所有的用户偏好设置（包括目标文件夹路径、匹配模式开关等）均保存在 Obsidian 插件默认的本地 `data.json` 配置文件中。插件不需要且绝不请求任何网络权限，保障您的本地笔记数据隐私。

---

## 📥 安装方法

### 方法一：手动安装
1. 本插件尚未发布到社区市场前，请下载编译好的 `main.js`, `manifest.json` 和 `styles.css` 文件。
2. 打开您的 Obsidian 库所在的本地文件夹，进入 `.obsidian/plugins/` 目录。
3. 创建一个名为 `auto-link-plugin` 的新文件夹。
4. 将上述三个文件放入该文件夹中。
5. 在 Obsidian 设置 > 社区插件 中刷新并启用该插件。

---

## 🛠️ 使用指南

1. **配置目标目录**：前往 Obsidian 设置 > `Auto Link 自动补全双链 设置`。
2. **输入文件夹路径**：在文本框中输入您想要检索的文件夹路径。支持配置多个路径（一行一个，例如：`Notes` 或 `Work/Projects`）。
3. **切换匹配模式**：根据检索习惯，决定是否开启 `模糊匹配 (Fuzzy Match)` 开关。
4. **日常输入体验**：配置完成后，只要在编辑区中输入目标目录内笔记名称的部分字词，下拉框就会快速呈现对应的补全建议。


🇬🇧 **English**

`Auto Link` is a lightweight, performance-focused autocompletion companion designed to streamline the link-building experience in Obsidian. It bypasses the overhead of scanning the entire vault by letting you narrow down search spaces to specified folders, while employing fine-grained debouncing and indexing strategies to offer fluid, context-aware suggestions as you type.

---

## 🌟 Key Features

### 1. Target Folder Scanning
* **Selective Indexing**: Stop wasting CPU cycles on massive vaults. Limit auto-suggestions to files from designated folders of your choice (e.g., people, projects, concepts).
* **Smart Deduplication**: Avoid duplicate indexing and redundant scans even if folder paths overlap, powered by an internal Map structure.

### 2. Smart Trigger & Anti-Disturb Logic
* **Context-Aware Triggers**: Automatically extracts search terms based on punctuation or spaces, maintaining non-intrusive operations.
* **Double-Bracket Prevention**: Deactivates suggestions when the cursor is already inside existing `[[...]]` links.
* **Smart Multi-Language Handling**: Triggers immediately on a single CJK character, but requires at least 2 characters for English/ASCII inputs to avoid cluttering your writing flow.

### 3. Dual Matching Modes
* **Prefix Matching**: Filters results starting with your query. Best for structured, predictable naming conventions.
* **Inclusion/Fuzzy Matching**: Matches any files containing the query substring anywhere in their basename, perfect for discovering serendipitous connections.

### 4. Native Link Integration
* **Consistent Paths**: Utilizes Obsidian's official `generateMarkdownLink` API to respect your path format preference (relative, shortest, absolute).
* **Embed Cleaning**: Automatically strips leading exclamation marks (`!`) generated during resolved path calls.

### 5. CPU & Memory Preservation
* **Double-Layer Debouncing**: Integrates debounce controls on file system events (`create`/`delete`/`rename`) and settings saves, ensuring smooth operation during rapid typing or file batching.
* **Limited UI Render**: Limits the suggestion dropdown to a maximum of 10 items, protecting the editor from DOM lag.

---

## ⚙️ Data Security & Storage

All settings, target directory configuration, and match rules are saved locally inside the standard `data.json` configuration folder of the plugin. The plugin runs entirely offline and requires no internet permissions.

---

## 📥 Installation

### Method: Manual Installation
1. Download the compiled release files (`main.js`, `manifest.json`, and `styles.css`).
2. Open your local Obsidian vault directory and navigate to `.obsidian/plugins/`.
3. Create a new directory named `auto-link-plugin`.
4. Put the three files into this directory.
5. Head to Settings > Community Plugins, reload, and enable.