import { App, Platform, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type WritingModePlugin from "./main";
import { clampSize, SIZE_MAX, SIZE_MIN, sizeDescription } from "./size";

/** The control key of the one per-device value, read and written on this device only. */
const SIZE_CONTROL = "fontSize";

// Built with the declarative settings API (getSettingDefinitions and the
// control value pair), new in Obsidian 1.13 and the reason for minAppVersion.
export class WritingModeSettingTab extends PluginSettingTab {
  plugin: WritingModePlugin;

  constructor(app: App, plugin: WritingModePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    if (key === SIZE_CONTROL) return this.plugin.mode.currentSize();
    return this.plugin.settings[key as keyof typeof this.plugin.settings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === SIZE_CONTROL) {
      this.plugin.device.fontSize = clampSize(Number(value));
      this.plugin.mode.sizeChanged();
      return;
    }
    (this.plugin.settings[key as keyof typeof this.plugin.settings] as unknown) = value;
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Typewriter scroll",
        desc: "The line you're currently typing stays in a fixed position.",
        control: { type: "toggle", key: "typewriter" },
      },
      {
        name: "Dimming",
        desc: "Fades everything but the sentence or paragraph you're working on.",
        control: {
          type: "dropdown",
          key: "dimming",
          options: {
            paragraph: "Paragraph",
            sentence: "Sentence",
            off: "Off",
          },
        },
      },
      {
        name: "Text size",
        desc: sizeDescription(Platform),
        control: {
          type: "slider",
          key: SIZE_CONTROL,
          min: SIZE_MIN,
          max: SIZE_MAX,
          step: 1,
          displayFormat: (value) => `${value} px`,
        },
      },
      {
        name: "Paper",
        desc: "Automatic switches between cream and night blue to match Obsidian's light or dark mode. The retro screens use a monospaced typeface.",
        control: {
          type: "dropdown",
          key: "paper",
          options: {
            auto: "Automatic",
            cream: "Warm cream",
            white: "Cool white",
            blue: "Night blue",
            grey: "Night gray",
            green: "Green screen",
            mac: "Classic Mac",
            illuminated: "Illuminated",
            "black-book": "Illuminated Black Book",
            theme: "Your theme's colors",
          },
        },
      },
      {
        name: "Typeface",
        desc: "Palatino by default. Enter any font on your device, or leave it blank to use your theme's font.",
        control: { type: "text", key: "font", placeholder: "Your theme's font" },
      },
      {
        name: "Word count",
        desc: "A prose-only word count in the corner.",
        control: { type: "toggle", key: "wordCount" },
      },
      {
        name: "Follow the system appearance",
        desc: "Automatic follows your device's light or dark mode, even if your vault is set to one theme.",
        control: { type: "toggle", key: "followSystemAppearance" },
      },
    ];
  }
}
