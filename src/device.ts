// What stays on this device and is never synced: the text size, because a
// phone and a desk want different sizes (Obsidian keeps its own base font size
// per device the same way), and whether the first-run hint has been shown.

import type { App } from "obsidian";
import { clampSize } from "./size";

const SIZE_KEY = "writing-mode:font-size";
const HINT_KEY = "writing-mode:hint-shown";

export class DeviceStore {
  constructor(private readonly app: App) {}

  /** The size chosen on this device, or null for the theme's own. */
  get fontSize(): number | null {
    const stored: unknown = this.app.loadLocalStorage(SIZE_KEY);
    return typeof stored === "number" && Number.isFinite(stored) ? clampSize(stored) : null;
  }

  set fontSize(size: number | null) {
    this.app.saveLocalStorage(SIZE_KEY, size);
  }

  get hintShown(): boolean {
    return this.app.loadLocalStorage(HINT_KEY) === true;
  }

  markHintShown(): void {
    this.app.saveLocalStorage(HINT_KEY, true);
  }
}
