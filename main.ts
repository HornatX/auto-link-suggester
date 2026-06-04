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
    debounce
} from 'obsidian';

// --- 插件设置接口 ---
interface AutoLinkSettings {
    targetFolders: string;
    fuzzyMatch: boolean;
}

const DEFAULT_SETTINGS: AutoLinkSettings = {
    targetFolders: '',
    fuzzyMatch: false
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

        // 1. 添加设置面板
        this.addSettingTab(new AutoLinkSettingTab(this.app, this));

        // 2. 注册自动补齐提示器
        this.registerEditorSuggest(new AutoLinkSuggest(this.app, this));

        // 3. 布局加载完成后初始化文件缓存
        this.app.workspace.onLayoutReady(() => {
            this.updateCache();
        });

        // 4. 全方位无死角的文件变动监听
        const handleFileChange = (file: TAbstractFile, oldPath?: string) => {
            if (file instanceof TFile && file.extension === 'md') {
                const folders = this.getNormalizedFolders();
                
                // 检查新路径是否在目标文件夹内
                const isNewPathInTarget = folders.some(folder => 
                    file.path.startsWith(folder + '/') || file.parent?.path === folder
                );
                
                // 检查旧路径（如文件被移出目标文件夹，或重命名前的路径）是否在目标文件夹内
                let isOldPathInTarget = false;
                if (oldPath) {
                    const lastSlash = oldPath.lastIndexOf('/');
                    const oldParent = lastSlash === -1 ? '/' : oldPath.substring(0, lastSlash);
                    isOldPathInTarget = folders.some(folder => 
                        oldPath.startsWith(folder + '/') || oldParent === folder
                    );
                }

                // 只要新旧路径有任何一个跟目标文件夹沾边，就刷新缓存
                if (isNewPathInTarget || isOldPathInTarget) {
                    this.debouncedUpdateCache();
                }
            }
        };

        this.registerEvent(this.app.vault.on('create', (file) => handleFileChange(file)));
        this.registerEvent(this.app.vault.on('delete', (file) => handleFileChange(file)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => handleFileChange(file, oldPath)));
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
                    // 使用防抖保存，避免疯狂打字时狂写硬盘卡死电脑
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
    }
}