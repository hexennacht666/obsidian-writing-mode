// Text size is the one control. These are its bounds and its words.

export const SIZE_MIN = 12;
export const SIZE_MAX = 48;
/** What one press of the shortcut moves the size by. */
const SIZE_STEP = 1;
/**
 * On a desktop, writing mode opens larger than the editor. A phone is already
 * held close, so there it opens only a little larger. Either is the default
 * until the writer changes the size on that device.
 */
const DEFAULT_SCALE = 1.5;
const PHONE_SCALE = 1.125;

export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return SIZE_MIN;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(size)));
}

export function stepSize(current: number, direction: 1 | -1): number {
  return clampSize(current + direction * SIZE_STEP);
}

/** The size the mode opens at when this device has not chosen one. */
export function defaultSize(editorSize: number, mobile = false): number {
  return clampSize(editorSize * (mobile ? PHONE_SCALE : DEFAULT_SCALE));
}

interface PlatformLike {
  isMacOS: boolean;
  isMobile: boolean;
}

/** The one line that fades in and out the first time the mode opens. */
export function hintText(platform: PlatformLike): string {
  if (platform.isMobile) return "Pinch to change the text size";
  const mod = platform.isMacOS ? "⌘" : "Ctrl";
  return `${mod} + and ${mod} − change the text size · Esc leaves`;
}

/** The words under the text-size slider, which is per device. */
export function sizeDescription(platform: PlatformLike): string {
  if (platform.isMobile) return "Pinch to resize while you write.";
  const mod = platform.isMacOS ? "⌘" : "Ctrl";
  return `Resize with ${mod} + and ${mod} − while you write, and ${mod} 0 to reset.`;
}
