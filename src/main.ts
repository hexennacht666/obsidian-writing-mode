import { Plugin } from "obsidian";
import { DeviceStore } from "./device";
import { writingModeExtension } from "./editor";
import { WritingMode } from "./mode";
import { DEFAULT_SETTINGS, readSettings, type WritingModeSettings } from "./settings";
import { WritingModeSettingTab } from "./settingsTab";

export default class WritingModePlugin extends Plugin {
  settings: WritingModeSettings = DEFAULT_SETTINGS;
  device = new DeviceStore(this.app);
  mode = new WritingMode(this);

  async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.addSettingTab(new WritingModeSettingTab(this.app, this));
    this.registerEditorExtension(writingModeExtension());

    this.addCommand({
      id: "toggle",
      name: "Toggle",
      checkCallback: (checking) => {
        if (!this.mode.active && !this.mode.noteToEnter()) return false;
        if (!checking) this.mode.toggle();
        return true;
      },
    });

    this.addRibbonIcon("book-open-text", "Writing mode", () => this.mode.toggle());

    this.registerEvent(this.app.workspace.on("layout-change", () => this.mode.layoutChanged()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.mode.layoutChanged()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.mode.fileOpened()));
    this.registerEvent(this.app.workspace.on("css-change", () => this.mode.appearanceChanged()));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => this.mode.noteChanged(info)));
  }

  onunload(): void {
    this.mode.unload();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.mode.applySettings();
  }
}
