import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    TFolder,
    TAbstractFile,
    debounce,
    MarkdownView // 👈 新增引入这一项
} from 'obsidian';

// --- 插件设置接口 ---
interface AutoLinkSettings {
    targetFolders: string;
    fuzzyMatch: boolean;
    preventClickNavigation: boolean; // 新增：是否阻止点击跳转
}

const DEFAULT_SETTINGS: AutoLinkSettings = {
    targetFolders: '',
    fuzzyMatch: false,
    preventClickNavigation: false // 新增：默认关闭
};

// --- 定义缓存数据结构 ---
interface CachedFile {
    file: TFile;
    lowerBase: string; // 提前存好小写名字，防止打字时重复计算
}

// --- 核心插件类 ---
export default class AutoLinkPlugin extends Plugin {
    settings: AutoLinkSettings;
    cachedFiles: CachedFile[] = []; 
    
    // 防抖：1秒内如果文件发生多次变动，只执行最后一次刷新，保护 CPU
    debouncedUpdateCache = debounce(() => {
        this.updateCache();
    }, 1000, true);

    // 防抖：用户在设置里面打字时，停顿 750ms 后再悄悄保存和扫描硬盘
    debouncedSaveSettings = debounce(async () => {
        await this.saveData(this.settings);
        this.updateCache(); 
    }, 750, true);

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new AutoLinkSettingTab(this.app, this));
        this.registerEditorSuggest(new AutoLinkSuggest(this.app, this));
        this.app.workspace.onLayoutReady(() => this.updateCache());

        // ... (保留你原来的 handleFileChange 的代码) ...

        // 🚀 5. 终极强力拦截：阻止双链点击跳转，直接进入编辑状态
        const stopNavigation = (evt: MouseEvent | TouchEvent) => {
            if (!this.settings.preventClickNavigation) return;

            const target = evt.target as HTMLElement;
            
            // 1. 全面捕获各种模式下的双链元素
            // - 阅读模式/Live Preview 渲染组件: .internal-link
            // - Live Preview 源码/预览混合模式: .cm-hmd-internal-link, .cm-link
            const linkElement = target.closest('.internal-link, .cm-hmd-internal-link, .cm-link');
            if (!linkElement) return;

            // 2. 暴力提取链接文本 (Live Preview 下往往没有 data-href，只能取 textContent)
            let href = linkElement.getAttribute('data-href');
            if (!href) {
                href = linkElement.textContent || '';
            }
            
            // 剔除可能的包裹符 [[ ]]、别名 | 以及标题锚点 # ，只保留纯文件名
            // 例如 "[[张敬远#生平|老张]]" 会被还原成 "张敬远"
            href = href.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
            if (!href) return;

            // 3. ✨ 完美逻辑匹配：这个点击的链接，是否属于我们插件缓存里的目标文件？
            // 这样写绕开了复杂的相对路径问题，只要名字在你监听的文件夹里，就100%拦截
            const isTargetLink = this.cachedFiles.some(f => 
                f.file.basename === href || 
                f.file.name === href || 
                f.file.path === href
            );

            if (isTargetLink) {
                // 4. 强力阻断：彻底杀死点击事件，防止 Obsidian 核心接收并触发跳转
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();

                // 5. 自动切入编辑模式（如果用户当前处于“阅读模式 Preview”）
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view && view.getMode() === 'preview') {
                    const state = view.getState();
                    state.mode = 'source'; // 强制切换为实时预览/源码编辑模式
                    view.setState(state, { history: false });
                }
                
                // Note: 如果本身就是在 Live Preview 模式下点击，
                // 由于我们只阻断了 click，CodeMirror 的原生 mousedown 依然会生效并将光标放在你点击的字上。
            }
        };

        // 挂载到 window 的捕获阶段，确保权限最高！同时防备鼠标中键(auxclick)和移动端触摸(touchend)
        this.registerDomEvent(window, 'click', stopNavigation, { capture: true });
        this.registerDomEvent(window, 'auxclick', stopNavigation, { capture: true });
        this.registerDomEvent(window, 'touchend', stopNavigation, { capture: true });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // 格式化目标文件夹列表（抹平反斜杠、清理首尾空格、去掉末尾多余斜杠）
    getNormalizedFolders(): string[] {
        return this.settings.targetFolders
            .split('\n')
            .map(f => f.trim().replace(/\\/g, '/').replace(/\/+$/, '')) 
            .filter(f => f.length > 0);
    }

    // 更新文件缓存（核心性能优化点：仅扫描指定文件夹 + Map哈希去重）
    updateCache() {
        const folders = this.getNormalizedFolders();

        // 如果没有配置任何文件夹，清空缓存并退出
        if (folders.length === 0) {
            this.cachedFiles = [];
            return;
        }

        // 使用 Map 数据结构保证同一个文件不会因为文件夹的父子嵌套关系被重复添加
        const fileMap = new Map<string, CachedFile>(); 

        // 递归扫描文件夹的辅助函数
        const processFolder = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    // 如果 Map 里没有这个文件（通过绝对路径判断），才加进去
                    if (!fileMap.has(child.path)) {
                        fileMap.set(child.path, {
                            file: child,
                            lowerBase: child.basename.toLowerCase() 
                        });
                    }
                } else if (child instanceof TFolder) {
                    processFolder(child); // 如果是子文件夹，继续深入找
                }
            }
        };

        // 精准遍历目标文件夹
        for (const folderPath of folders) {
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (folder instanceof TFolder) {
                processFolder(folder);
            }
        }

        // 将哈希表中的结果转换为数组，供提示器高速读取
        this.cachedFiles = Array.from(fileMap.values());
    }
}

// --- 自动补全提示器类 ---
class AutoLinkSuggest extends EditorSuggest<CachedFile> {
    plugin: AutoLinkPlugin;

    constructor(app: App, plugin: AutoLinkPlugin) {
        super(app);
        this.plugin = plugin;
    }

    // 触发条件判断（防打扰、防长句误触发机制）
    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        if (this.plugin.cachedFiles.length === 0) return null;

        const line = editor.getLine(cursor.line);
        const linePrefix = line.substring(0, cursor.ch);
        if (linePrefix.length === 0) return null;

        // 避免在已经存在的双链 [[ ]] 内部重复触发
        const lastOpen = linePrefix.lastIndexOf('[[');
        const lastClose = linePrefix.lastIndexOf(']]');
        if (lastOpen > lastClose) return null;

        // 【精准词汇提取】：从最后一个空格或常见标点符号开始提取用户当前正在打的字序列
        const match = linePrefix.match(/([^ \s,.;?!\/()\[\]{}"'<>|*:]+)$/);
        if (!match) return null;
        
        let block = match[1];
        if (!block.trim()) return null;

        // 🚀 性能优化：限制最大向前追溯的字符数（假设最长需要匹配的文件名不超过 30 个字符）
        // 避免在长篇没有标点的中文段落中进行巨量无效计算导致卡顿
        const MAX_LOOKBACK = 30;
        if (block.length > MAX_LOOKBACK) {
            block = block.substring(block.length - MAX_LOOKBACK);
        }

        const isFuzzy = this.plugin.settings.fuzzyMatch;

        // 🎯 核心修复：倒序递减匹配（解决中文连续输入没有空格分隔的问题）
        // 例如用户输入 "30年前张"，block="30年前张"
        // 循环会依次判断："30年前张" -> "0年前张" -> "年前张" -> "前张" -> "张"
        for (let i = 0; i < block.length; i++) {
            const rawQuery = block.substring(i);
            const query = rawQuery.toLowerCase();

            // 英文最少输入 2 个字母触发，中文等其他语言 1 个字即可
            const isAscii = /^[\x00-\x7F]+$/.test(query);
            if (isAscii && query.length < 2) continue; // 如果当前截取的是单个英文字母，跳过找下一个

            let hasMatch = false;
            if (isFuzzy) {
                hasMatch = this.plugin.cachedFiles.some(f => f.lowerBase.includes(query));
            } else {
                hasMatch = this.plugin.cachedFiles.some(f => f.lowerBase.startsWith(query));
            }

            // 💡 一旦找到匹配（因为是从长到短找的，所以找到的一定是最长匹配）
            if (hasMatch) {
                return {
                    // start 的位置精确定位到匹配词的开头，替换时不会把前面的 "30年前" 误删掉
                    start: { line: cursor.line, ch: cursor.ch - rawQuery.length },
                    end: cursor,
                    query: query
                };
            }
        }

        return null;
    }

    // 获取并过滤建议列表
    getSuggestions(context: EditorSuggestContext): CachedFile[] {
        const query = context.query; 
        const isFuzzy = this.plugin.settings.fuzzyMatch;

        // 性能优化：将判断提起到过滤循环之外
        const results = isFuzzy
            ? this.plugin.cachedFiles.filter(f => f.lowerBase.includes(query))
            : this.plugin.cachedFiles.filter(f => f.lowerBase.startsWith(query));

        return results.slice(0, 10); // 限制最多展示 10 条结果，防止撑爆 UI
    }

    // 渲染建议下拉列表的 UI
    renderSuggestion(cachedItem: CachedFile, el: HTMLElement) {
        el.createEl("div", { text: cachedItem.file.basename });
        el.createEl("small", { text: cachedItem.file.path, cls: "suggestion-note" });
    }

    // 用户选择下拉项后的替换行为
    selectSuggestion(cachedItem: CachedFile, evt: MouseEvent | KeyboardEvent) {
        if (this.context) {
            const editor = this.context.editor;
            const activeFile = this.plugin.app.workspace.getActiveFile();
            const sourcePath = activeFile ? activeFile.path : '';
            
            // 使用 Obsidian 官方 API 生成符合用户偏好的相对/绝对/最短链接
            let linkText = this.plugin.app.fileManager.generateMarkdownLink(cachedItem.file, sourcePath);
            
            // 如果生成了内嵌叹号 ![[...]]，将叹号剔除
            if (linkText.startsWith('!')) {
                linkText = linkText.substring(1);
            }

            // 替换用户刚刚敲下的一小段文字为双链，并将光标移动到链接最后
            editor.replaceRange(linkText, this.context.start, this.context.end);
        }
    }
}

// --- 设置面板 UI ---
class AutoLinkSettingTab extends PluginSettingTab {
    plugin: AutoLinkPlugin;

    constructor(app: App, plugin: AutoLinkPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'Auto Link 自动补全双链 设置'});

        new Setting(containerEl)
            .setName('指定文件夹 (Target Folders)')
            .setDesc('输入需要被监听和自动补齐双链的文件夹路径。多个文件夹请用回车（换行）区分。例如：Notes/Person')
            .addTextArea(text => text
                .setPlaceholder('folder1\nfolder2/subfolder')
                .setValue(this.plugin.settings.targetFolders)
                .onChange(async (value) => {
                    this.plugin.settings.targetFolders = value;
                    this.plugin.debouncedSaveSettings();
                })
            );

        new Setting(containerEl)
            .setName('模糊匹配 (Fuzzy Match)')
            .setDesc('开启后，只需输入文件名中包含的任意字即可触发补齐（如：输入"和"或"你"能匹配"我和你"）。关闭时，仅支持按顺序前缀匹配。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fuzzyMatch)
                .onChange(async (value) => {
                    this.plugin.settings.fuzzyMatch = value;
                    this.plugin.debouncedSaveSettings();
                })
            );

        // 🚀 新增：点击不跳转设置
        new Setting(containerEl)
            .setName('防误触：点击指定双链不跳转')
            .setDesc('开启后，在阅读模式或实时预览模式下，点击指向「指定文件夹」中文件的双链，将不再触发页面跳转，而是直接将光标定位在上面进行文本编辑。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preventClickNavigation)
                .onChange(async (value) => {
                    this.plugin.settings.preventClickNavigation = value;
                    this.plugin.debouncedSaveSettings();
                })
            );
    }
}