var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AutoLinkPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  targetFolders: "",
  fuzzyMatch: false,
  preventClickNavigation: false
};
var AutoLinkPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.cachedFiles = [];
    // 防抖：1秒内如果文件发生多次变动，只执行最后一次刷新，保护 CPU
    this.debouncedUpdateCache = (0, import_obsidian.debounce)(() => {
      this.updateCache();
    }, 1e3, true);
    // 修复 Warning 2: 使用 .then() 和 .catch() 处理 Promise，而不是裸奔的 async/await
    this.debouncedSaveSettings = (0, import_obsidian.debounce)(() => {
      this.saveData(this.settings).then(() => {
        this.updateCache();
      }).catch((e) => {
        console.error("AutoLink Plugin: Failed to save settings", e);
      });
    }, 750, true);
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AutoLinkSettingTab(this.app, this));
    this.registerEditorSuggest(new AutoLinkSuggest(this.app, this));
    this.app.workspace.onLayoutReady(() => this.updateCache());
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.debouncedUpdateCache();
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.debouncedUpdateCache();
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.debouncedUpdateCache();
      }
    }));
    const stopNavigation = (evt) => {
      if (!this.settings.preventClickNavigation) return;
      const target = evt.target;
      const linkElement = target.closest(".internal-link, .cm-hmd-internal-link, .cm-link");
      if (!linkElement) return;
      let href = linkElement.getAttribute("data-href");
      if (!href) {
        href = linkElement.textContent || "";
      }
      href = href.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
      if (!href) return;
      const isTargetLink = this.cachedFiles.some(
        (f) => f.file.basename === href || f.file.name === href || f.file.path === href
      );
      if (isTargetLink) {
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (view && view.getMode() === "preview") {
          const state = view.getState();
          state.mode = "source";
          view.setState(state, { history: false });
        }
      }
    };
    this.registerDomEvent(window, "click", stopNavigation, { capture: true });
    this.registerDomEvent(window, "auxclick", stopNavigation, { capture: true });
    this.registerDomEvent(window, "touchend", stopNavigation, { capture: true });
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }
  // 格式化目标文件夹列表
  getNormalizedFolders() {
    return this.settings.targetFolders.split("\n").map((f) => f.trim().replace(/\\/g, "/").replace(/\/+$/, "")).filter((f) => f.length > 0);
  }
  // 更新文件缓存
  updateCache() {
    const folders = this.getNormalizedFolders();
    if (folders.length === 0) {
      this.cachedFiles = [];
      return;
    }
    const fileMap = /* @__PURE__ */ new Map();
    const processFolder = (folder) => {
      for (const child of folder.children) {
        if (child instanceof import_obsidian.TFile && child.extension === "md") {
          if (!fileMap.has(child.path)) {
            fileMap.set(child.path, {
              file: child,
              lowerBase: child.basename.toLowerCase()
            });
          }
        } else if (child instanceof import_obsidian.TFolder) {
          processFolder(child);
        }
      }
    };
    for (const folderPath of folders) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof import_obsidian.TFolder) {
        processFolder(folder);
      }
    }
    this.cachedFiles = Array.from(fileMap.values());
  }
};
var AutoLinkSuggest = class extends import_obsidian.EditorSuggest {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onTrigger(cursor, editor, file) {
    if (this.plugin.cachedFiles.length === 0) return null;
    const line = editor.getLine(cursor.line);
    const linePrefix = line.substring(0, cursor.ch);
    if (linePrefix.length === 0) return null;
    const lastOpen = linePrefix.lastIndexOf("[[");
    const lastClose = linePrefix.lastIndexOf("]]");
    if (lastOpen > lastClose) return null;
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
      const isAscii = /^[\x20-\x7E]+$/.test(query);
      if (isAscii && query.length < 2) continue;
      let hasMatch = false;
      if (isFuzzy) {
        hasMatch = this.plugin.cachedFiles.some((f) => f.lowerBase.includes(query));
      } else {
        hasMatch = this.plugin.cachedFiles.some((f) => f.lowerBase.startsWith(query));
      }
      if (hasMatch) {
        return {
          start: { line: cursor.line, ch: cursor.ch - rawQuery.length },
          end: cursor,
          query
        };
      }
    }
    return null;
  }
  getSuggestions(context) {
    const query = context.query;
    const isFuzzy = this.plugin.settings.fuzzyMatch;
    const results = isFuzzy ? this.plugin.cachedFiles.filter((f) => f.lowerBase.includes(query)) : this.plugin.cachedFiles.filter((f) => f.lowerBase.startsWith(query));
    return results.slice(0, 10);
  }
  renderSuggestion(cachedItem, el) {
    el.createEl("div", { text: cachedItem.file.basename });
    el.createEl("small", { text: cachedItem.file.path, cls: "suggestion-note" });
  }
  selectSuggestion(cachedItem, evt) {
    if (this.context) {
      const editor = this.context.editor;
      const activeFile = this.plugin.app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : "";
      let linkText = this.plugin.app.fileManager.generateMarkdownLink(cachedItem.file, sourcePath);
      if (linkText.startsWith("!")) {
        linkText = linkText.substring(1);
      }
      editor.replaceRange(linkText, this.context.start, this.context.end);
    }
  }
};
var AutoLinkSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Auto Link \u81EA\u52A8\u8865\u5168\u53CC\u94FE \u8BBE\u7F6E").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u6307\u5B9A\u6587\u4EF6\u5939 (Target Folders)").setDesc("\u8F93\u5165\u9700\u8981\u88AB\u76D1\u542C\u548C\u81EA\u52A8\u8865\u9F50\u53CC\u94FE\u7684\u6587\u4EF6\u5939\u8DEF\u5F84\u3002\u591A\u4E2A\u6587\u4EF6\u5939\u8BF7\u7528\u56DE\u8F66\uFF08\u6362\u884C\uFF09\u533A\u5206\u3002\u4F8B\u5982\uFF1ANotes/Person").addTextArea(
      (text) => text.setPlaceholder("folder1\nfolder2/subfolder").setValue(this.plugin.settings.targetFolders).onChange((value) => {
        this.plugin.settings.targetFolders = value;
        this.plugin.debouncedSaveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u6A21\u7CCA\u5339\u914D (Fuzzy Match)").setDesc('\u5F00\u542F\u540E\uFF0C\u53EA\u9700\u8F93\u5165\u6587\u4EF6\u540D\u4E2D\u5305\u542B\u7684\u4EFB\u610F\u5B57\u5373\u53EF\u89E6\u53D1\u8865\u9F50\uFF08\u5982\uFF1A\u8F93\u5165"\u548C"\u6216"\u4F60"\u80FD\u5339\u914D"\u6211\u548C\u4F60"\uFF09\u3002\u5173\u95ED\u65F6\uFF0C\u4EC5\u652F\u6301\u6309\u987A\u5E8F\u524D\u7F00\u5339\u914D\u3002').addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.fuzzyMatch).onChange((value) => {
        this.plugin.settings.fuzzyMatch = value;
        this.plugin.debouncedSaveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u9632\u8BEF\u89E6\uFF1A\u70B9\u51FB\u6307\u5B9A\u53CC\u94FE\u4E0D\u8DF3\u8F6C").setDesc("\u5F00\u542F\u540E\uFF0C\u5728\u9605\u8BFB\u6A21\u5F0F\u6216\u5B9E\u65F6\u9884\u89C8\u6A21\u5F0F\u4E0B\uFF0C\u70B9\u51FB\u6307\u5411\u300C\u6307\u5B9A\u6587\u4EF6\u5939\u300D\u4E2D\u6587\u4EF6\u7684\u53CC\u94FE\uFF0C\u5C06\u4E0D\u518D\u89E6\u53D1\u9875\u9762\u8DF3\u8F6C\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.preventClickNavigation).onChange((value) => {
        this.plugin.settings.preventClickNavigation = value;
        this.plugin.debouncedSaveSettings();
      })
    );
  }
};
