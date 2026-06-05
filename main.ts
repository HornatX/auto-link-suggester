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
    debounce,
    MarkdownView 
} from 'obsidian';

// --- 插件设置接口 ---
interface AutoLinkSettings {
    targetFolders: string;
    fuzzyMatch: boolean;
    preventClickNavigation: boolean;
}

const DEFAULT_SETTINGS: AutoLinkSettings = {
    targetFolders: '',
    fuzzyMatch: false,
    preventClickNavigation: false
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

    // 修复 Warning 2: 使用 .then() 和 .catch() 处理 Promise，而不是裸奔的 async/await
    debouncedSaveSettings = debounce(() => {
        this.saveData(this.settings)
            .then(() => {
                this.updateCache(); 
            })
            .catch((e) => {
                console.error("AutoLink Plugin: Failed to save settings", e);
            });
    }, 750, true);

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new AutoLinkSettingTab(this.app, this));
        this.registerEditorSuggest(new AutoLinkSuggest(this.app, this));
        this.app.workspace.onLayoutReady(() => this.updateCache());

        // 🚀 5. 终极强力拦截：阻止双链点击跳转，直接进入编辑状态
        const stopNavigation = (evt: MouseEvent | TouchEvent) => {
            if (!this.settings.preventClickNavigation) return;

            const target = evt.target as HTMLElement;
            
            // 1. 全面捕获各种模式下的双链元素
            const linkElement = target.closest('.internal-link, .cm-hmd-internal-link, .cm-link');
            if (!linkElement) return;

            // 2. 暴力提取链接文本
            let href = linkElement.getAttribute('data-href');
            if (!href) {
                href = linkElement.textContent || '';
            }
            
            // 剔除可能的包裹符 [[ ]]、别名 | 以及标题锚点 # ，只保留纯文件名
            href = href.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
            if (!href) return;

            // 3. ✨ 完美逻辑匹配
            const isTargetLink = this.cachedFiles.some(f => 
                f.file.basename === href || 
                f.file.name === href || 
                f.file.path === href
            );

            if (isTargetLink) {
                // 4. 强力阻断
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();

                // 5. 自动切入编辑模式
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view && view.getMode() === 'preview') {
                    const state = view.getState();
                    state.mode = 'source'; // 强制切换为实时预览/源码编辑模式
                    view.setState(state, { history: false });
                }
            }
        };

        // 挂载到 window 的捕获阶段
        this.registerDomEvent(window, 'click', stopNavigation, { capture: true });
        this.registerDomEvent(window, 'auxclick', stopNavigation, { capture: true });
        this.registerDomEvent(window, 'touchend', stopNavigation, { capture: true });
    }

    async loadSettings() {
        // 修复 Warning 3: 增加类型断言，防止 Any 隐式污染
        const data = (await this.loadData()) as Partial<AutoLinkSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    // 格式化目标文件夹列表
    getNormalizedFolders(): string[] {
        return this.settings.targetFolders
            .split('\n')
            .map(f => f.trim().replace(/\\/g, '/').replace(/\/+$/, '')) 
            .filter(f => f.length > 0);
    }

    // 更新文件缓存
    updateCache() {
        const folders = this.getNormalizedFolders();

        if (folders.length === 0) {
            this.cachedFiles = [];
            return;
        }

        const fileMap = new Map<string, CachedFile>(); 

        const processFolder = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'md') {
                    if (!fileMap.has(child.path)) {
                        fileMap.set(child.path, {
                            file: child,
                            lowerBase: child.basename.toLowerCase() 
                        });
                    }
                } else if (child instanceof TFolder) {
                    processFolder(child);
                }
            }
        };

        for (const folderPath of folders) {
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (folder instanceof TFolder) {
                processFolder(folder);
            }
        }

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

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        if (this.plugin.cachedFiles.length === 0) return null;

        const line = editor.getLine(cursor.line);
        const linePrefix = line.substring(0, cursor.ch);
        if (linePrefix.length === 0) return null;

        const lastOpen = linePrefix.lastIndexOf('[[');
        const lastClose = linePrefix.lastIndexOf(']]');
        if (lastOpen > lastClose) return null;

        // 修复 Warning 4 & 5: 去除正则表达式中不必要的 \/ 和 \[ 转义
        const match = linePrefix.match(/([^ \s,.;?!/()[\]{}"'<>|*:]+)$/);
        if (!match) return null;
        
        let block = match[1];
        if (!block.trim()) return null;

        const MAX_LOOKBACK = 30;
        if (block.length > MAX_LOOKBACK) {
            block = block.substring(block.length - MAX_LOOKBACK);
        }

        const isFuzzy = this.plugin.settings.fuzzyMatch;

        for (let i = 0; i < block.length; i++) {
            const rawQuery = block.substring(i);
            const query = rawQuery.toLowerCase();

            // 修复 Warning 6: 避免正则使用控制字符(\x00)，改用可见 ASCII 字符范围(\x20-\x7E)
            const isAscii = /^[\x20-\x7E]+$/.test(query);
            if (isAscii && query.length < 2) continue; 

            let hasMatch = false;
            if (isFuzzy) {
                hasMatch = this.plugin.cachedFiles.some(f => f.lowerBase.includes(query));
            } else {
                hasMatch = this.plugin.cachedFiles.some(f => f.lowerBase.startsWith(query));
            }

            if (hasMatch) {
                return {
                    start: { line: cursor.line, ch: cursor.ch - rawQuery.length },
                    end: cursor,
                    query: query
                };
            }
        }

        return null;
    }

    getSuggestions(context: EditorSuggestContext): CachedFile[] {
        const query = context.query; 
        const isFuzzy = this.plugin.settings.fuzzyMatch;

        const results = isFuzzy
            ? this.plugin.cachedFiles.filter(f => f.lowerBase.includes(query))
            : this.plugin.cachedFiles.filter(f => f.lowerBase.startsWith(query));

        return results.slice(0, 10); 
    }

    renderSuggestion(cachedItem: CachedFile, el: HTMLElement) {
        el.createEl("div", { text: cachedItem.file.basename });
        el.createEl("small", { text: cachedItem.file.path, cls: "suggestion-note" });
    }

    selectSuggestion(cachedItem: CachedFile, evt: MouseEvent | KeyboardEvent) {
        if (this.context) {
            const editor = this.context.editor;
            const activeFile = this.plugin.app.workspace.getActiveFile();
            const sourcePath = activeFile ? activeFile.path : '';
            
            let linkText = this.plugin.app.fileManager.generateMarkdownLink(cachedItem.file, sourcePath);
            
            if (linkText.startsWith('!')) {
                linkText = linkText.substring(1);
            }

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

        // 修复 Error 1: 官方要求必须使用 Setting.setHeading() 生成标题，而不是自己写 HTML 元素
        new Setting(containerEl)
            .setName('Auto Link 自动补全双链 设置')
            .setHeading();

        new Setting(containerEl)
            .setName('指定文件夹 (Target Folders)')
            .setDesc('输入需要被监听和自动补齐双链的文件夹路径。多个文件夹请用回车（换行）区分。例如：Notes/Person')
            .addTextArea(text => text
                .setPlaceholder('folder1\nfolder2/subfolder')
                .setValue(this.plugin.settings.targetFolders)
                .onChange((value) => { // 修复 Warning 2: 移除了没必要的 async 标记
                    this.plugin.settings.targetFolders = value;
                    this.plugin.debouncedSaveSettings();
                })
            );

        new Setting(containerEl)
            .setName('模糊匹配 (Fuzzy Match)')
            .setDesc('开启后，只需输入文件名中包含的任意字即可触发补齐（如：输入"和"或"你"能匹配"我和你"）。关闭时，仅支持按顺序前缀匹配。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fuzzyMatch)
                .onChange((value) => { // 修复 Warning 2: 移除了没必要的 async 标记
                    this.plugin.settings.fuzzyMatch = value;
                    this.plugin.debouncedSaveSettings();
                })
            );

        new Setting(containerEl)
            .setName('防误触：点击指定双链不跳转')
            .setDesc('开启后，在阅读模式或实时预览模式下，点击指向「指定文件夹」中文件的双链，将不再触发页面跳转，而是直接将光标定位在上面进行文本编辑。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preventClickNavigation)
                .onChange((value) => { // 修复 Warning 2: 移除了没必要的 async 标记
                    this.plugin.settings.preventClickNavigation = value;
                    this.plugin.debouncedSaveSettings();
                })
            );
    }
}