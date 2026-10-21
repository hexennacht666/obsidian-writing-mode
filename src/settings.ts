// What the plugin keeps between sessions and syncs between devices. Text size
// is deliberately not here: it is per device, and lives in device.ts.

export type Dimming = "paragraph" | "sentence" | "off";
/**
 * The paper: two light papers, two dark ones, two screens from the first
 * decades of word processors (a green phosphor terminal and the 1984 Mac's
 * black on white, both in a monospace face), two illuminated manuscripts
 * (parchment, and a black book of hours), the theme's own colors, or
 * "auto", which is cream with a light theme and night blue with a dark one.
 */
export type Paper = "auto" | "cream" | "white" | "blue" | "grey" | "green" | "mac" | "illuminated" | "black-book" | "theme";
export const PAPERS: Paper[] = ["auto", "cream", "white", "blue", "grey", "green", "mac", "illuminated", "black-book", "theme"];

/** The default typeface, a word processor's serif. */
export const DEFAULT_FONT = "Palatino";

/**
 * The CSS font list for the typeface setting. The setting shows a plain name;
 * Palatino gets its stand-ins here (Windows ships it as Palatino Linotype).
 */
export function fontStack(font: string): string {
  return font.toLowerCase() === "palatino" ? "Palatino, 'Book Antiqua', 'Palatino Linotype', Georgia, serif" : font;
}

export interface WritingModeSettings {
  /** The line with the cursor holds its place on the screen as you type. */
  typewriter: boolean;
  /** What steps back around the cursor. */
  dimming: Dimming;
  /** A small static count at the foot of the page. */
  wordCount: boolean;
  /** Go light or dark with the device even in a vault pinned to one theme. */
  followSystemAppearance: boolean;
  /** The colors of the page. */
  paper: Paper;
  /** The typeface by name (see fontStack); empty means the theme's text font. */
  font: string;
}

export const DEFAULT_SETTINGS: WritingModeSettings = {
  typewriter: true,
  dimming: "off",
  wordCount: false,
  followSystemAppearance: false,
  paper: "auto",
  font: DEFAULT_FONT,
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Whatever is on disk, read as what this version expects. A data file written
 * by hand, by an older version or by a sync conflict should cost a setting, not
 * a plugin that fails to load.
 */
export function readSettings(loaded: unknown): WritingModeSettings {
  const stored = record(loaded);
  const dimming = stored.dimming;
  const paper = stored.paper;
  return {
    paper: (PAPERS as string[]).includes(paper as string) ? (paper as Paper) : DEFAULT_SETTINGS.paper,
    font: typeof stored.font === "string" ? stored.font : DEFAULT_SETTINGS.font,
    typewriter: typeof stored.typewriter === "boolean" ? stored.typewriter : DEFAULT_SETTINGS.typewriter,
    dimming:
      dimming === "paragraph" || dimming === "sentence" || dimming === "off" ? dimming : DEFAULT_SETTINGS.dimming,
    wordCount: typeof stored.wordCount === "boolean" ? stored.wordCount : DEFAULT_SETTINGS.wordCount,
    followSystemAppearance:
      typeof stored.followSystemAppearance === "boolean"
        ? stored.followSystemAppearance
        : DEFAULT_SETTINGS.followSystemAppearance,
  };
}
