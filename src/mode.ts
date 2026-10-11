// Entering and leaving. The mode is the window gone full screen, a set of
// classes on the workspace, one effect in one editor, a pushed keymap scope,
// and a record of what to put back. Both directions happen behind a veil that
// fades up and down, so the change reads as one movement.
// Everything it changes, it changes here, so exit is the mirror of enter.

import { MarkdownView, Notice, Platform, Scope, setIcon, type MarkdownFileInfo, type WorkspaceLeaf } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { setWritingMode, writingModeField, type WritingModeOptions } from "./editor";
import type WritingModePlugin from "./main";
import { clampSize, defaultSize, hintText, SIZE_MAX, SIZE_MIN, stepSize } from "./size";
import { fontStack } from "./settings";
import { wordCount } from "./text";

/** How the window was taken full screen, so it can be given back the same way. */
type FullScreenRoute = "window" | "document" | null;

interface Session {
  leaf: WorkspaceLeaf;
  view: MarkdownView;
  cm: EditorView;
  /** The view mode and source flag to put back on exit. */
  mode: string;
  source: boolean;
  /** Whether the body was dark before a system-appearance swap, or null if untouched. */
  wasDark: boolean | null;
  /** Stops following the system appearance, while it is followed. */
  unfollow: (() => void) | null;
  fullScreen: FullScreenRoute;
  scope: Scope;
  count: HTMLElement | null;
  countTimer: number | null;
  cleanup: (() => void)[];
}

const COUNT_SETTLE_MS = 400;
/** The veil's own fade, matching the stylesheet's transition. */
const VEIL_MS = 220;
/** Time under the veil for the window to finish going full screen. */
const FULL_SCREEN_SETTLE_MS = 500;

/** What the editor's Vim emulation says about its own state. */
interface VimState {
  insertMode?: boolean;
  visualMode?: boolean;
  inputState?: { operator?: string | null; keyBuffer?: unknown[] };
}

interface ElectronWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
}

/** Obsidian's handle on its own window: undocumented, desktop app only. */
function electronWindow(of: Window): ElectronWindow | null {
  const win = (of as unknown as { electronWindow?: Partial<ElectronWindow> }).electronWindow;
  return win && typeof win.setFullScreen === "function" && typeof win.isFullScreen === "function"
    ? (win as ElectronWindow)
    : null;
}

/** The note's CodeMirror 6 view, which Obsidian exposes but does not document. */
function editorViewOf(view: MarkdownView): EditorView | null {
  return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
}

export class WritingMode {
  private session: Session | null = null;
  /** True while a veil is up, so a second toggle mid-fade does nothing. */
  private busy = false;
  /** Counts fades, so only the latest one clears busy when it ends. */
  private transition = 0;
  private unloaded = false;
  /** The window the mode is in: a note can be in a window of its own. */
  private doc: Document = document;
  private win: Window = window;

  constructor(private readonly plugin: WritingModePlugin) {}

  get active(): boolean {
    return this.session !== null;
  }

  toggle(): void {
    if (this.session) this.exit();
    else void this.enter();
  }

  /**
   * The note to write in: the active one, or, when a sidebar panel holds the
   * focus, the note most recently worked in in the main area.
   */
  noteToEnter(): MarkdownView | null {
    const workspace = this.plugin.app.workspace;
    const active = workspace.getActiveViewOfType(MarkdownView);
    const root = active?.leaf.getRoot();
    if (active && root !== workspace.leftSplit && root !== workspace.rightSplit) return active;
    const recent = workspace.getMostRecentLeaf(workspace.rootSplit)?.view;
    return recent instanceof MarkdownView && recent.file ? recent : null;
  }

  async enter(): Promise<void> {
    if (this.session || this.busy) return;
    const view = this.noteToEnter();
    if (!view) {
      new Notice("Open a note to write in.");
      return;
    }
    const leaf = view.leaf;
    this.doc = view.containerEl.doc;
    this.win = view.containerEl.win;
    const transition = this.begin();
    this.applyLook();
    const veil = await this.raiseVeil();
    try {
      await this.open(view, leaf, veil, transition);
    } catch (error) {
      console.error("Writing mode could not open", error);
      if (this.session) this.tearDown(this.session);
      this.session = null;
      this.lowerVeil(veil, () => this.clearLook());
      this.end(transition);
      new Notice("Writing mode could not open.");
    }
  }

  /** The plugin is going: put everything back now, including a mode still opening. */
  unload(): void {
    this.unloaded = true;
    this.exit(false);
    this.doc.body.querySelectorAll(".wm-veil").forEach((veil) => veil.remove());
    this.clearLook();
  }

  private begin(): number {
    this.busy = true;
    return ++this.transition;
  }

  private end(transition: number): void {
    if (transition === this.transition) this.busy = false;
  }

  private async open(view: MarkdownView, leaf: WorkspaceLeaf, veil: HTMLElement, transition: number): Promise<void> {
    const app = this.plugin.app;
    // Prose is read in Live Preview: italics show as italics and the cursor is live.
    const viewState = leaf.getViewState();
    const stored = (viewState.state ?? {}) as { mode?: string; source?: boolean };
    const mode = stored.mode ?? "source";
    const source = stored.source ?? false;
    if (this.unloaded) return;
    if (mode !== "source" || source) {
      await leaf.setViewState(
        { ...viewState, state: { ...stored, mode: "source", source: false } },
        view.getEphemeralState(),
      );
    }
    if (this.unloaded) return;

    const cm = editorViewOf(view);
    if (!cm) {
      this.lowerVeil(veil, () => this.clearLook());
      this.end(transition);
      new Notice("This note cannot open in writing mode.");
      return;
    }

    const cleanup: (() => void)[] = [];
    const body = this.doc.body;
    const settings = this.plugin.settings;

    // A phone's drawers slide the whole workspace aside, so an open one would
    // leave the page in a sliver. They are closed, and stay closed on the way out.
    if (Platform.isMobile) {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    }

    body.classList.add("wm-on");
    body.classList.toggle("wm-typewriter", settings.typewriter);
    view.containerEl.classList.add("wm-view");
    this.applyFont(view.containerEl);
    view.containerEl.closest(".workspace-leaf")?.classList.add("wm-leaf");

    const scope = new Scope(app.scope);
    scope.register([], "Escape", (event) => {
      // With Vim key bindings, Escape first belongs to the editor: it leaves
      // insert or visual mode, cancels a pending command or the / and :
      // prompts, and only from plain normal mode leaves this one.
      const vim = (cm as unknown as { cm?: { state?: { vim?: VimState } } }).cm?.state?.vim;
      if (vim) {
        const target = event.target as Node | null;
        const inPrompt = !!target && cm.dom.contains(target) && !cm.contentDOM.contains(target);
        const pending = !!vim.inputState?.operator || (vim.inputState?.keyBuffer?.length ?? 0) > 0;
        if (vim.insertMode || vim.visualMode || inPrompt || pending) return true;
      }
      this.exit();
      return false;
    });
    // Mod + is reported as Mod =, Mod + or Mod Shift =, depending on the keyboard layout.
    for (const key of ["=", "+"]) {
      scope.register(["Mod"], key, () => {
        this.changeSize(1);
        return false;
      });
    }
    scope.register(["Mod", "Shift"], "=", () => {
      this.changeSize(1);
      return false;
    });
    scope.register(["Mod"], "-", () => {
      this.changeSize(-1);
      return false;
    });
    scope.register(["Mod"], "0", () => {
      this.changeSize(null);
      return false;
    });
    app.keymap.pushScope(scope);

    // On the phone there is no Escape; the mode's own open book, in the paper's
    // ink, closes it from the corner.
    const close = view.containerEl.createDiv({
      cls: "wm-close",
      attr: { role: "button", "aria-label": "Leave writing mode", tabindex: "0" },
    });
    setIcon(close, "book-open-text");
    close.addEventListener("click", () => this.exit());
    close.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.exit();
      }
    });
    cleanup.push(() => close.remove());

    if (!this.plugin.device.hintShown) {
      const hint = view.containerEl.createDiv({ cls: "wm-hint", text: hintText(Platform) });
      hint.addEventListener("animationend", () => hint.remove());
      cleanup.push(() => hint.remove());
      this.plugin.device.markHintShown();
    }

    this.session = {
      leaf,
      view,
      cm,
      mode,
      source,
      wasDark: null,
      unfollow: null,
      fullScreen: null,
      scope,
      count: null,
      countTimer: null,
      cleanup,
    };

    this.followSystem(this.session);
    this.session.fullScreen = this.goFullScreen(cleanup);
    this.listenForPinch(view.contentEl, cleanup);
    this.sizeChanged();
    this.applyCount();
    cm.dispatch({ effects: setWritingMode.of(this.options()) });
    view.editor.focus();

    // The window has to finish growing before the page under the veil is shown.
    // Nothing scrolls on entering: the page is where the writer left it.
    window.setTimeout(() => {
      this.lowerVeil(veil);
      this.end(transition);
    }, FULL_SCREEN_SETTLE_MS);
  }

  /**
   * Leaves, putting back what enter changed. With `fade` false, for a leaf that
   * has gone or a plugin unloading, everything is put back at once.
   */
  exit(fade = true): void {
    const session = this.session;
    if (!session) return;
    this.session = null;

    if (!fade) {
      this.tearDown(session);
      this.clearLook();
      return;
    }

    const doc = this.doc;
    const transition = this.begin();
    void this.raiseVeil().then((veil) => {
      this.tearDown(session);
      window.setTimeout(() => {
        // The veil keeps the page's color until it is gone; only then the look goes.
        this.lowerVeil(veil, () => {
          if (transition === this.transition) this.clearLook(doc);
        });
        this.end(transition);
      }, FULL_SCREEN_SETTLE_MS);
    });
  }

  /** The page's colors, as one class on the body so the veil shares them. */
  private applyLook(): void {
    const body = this.doc.body;
    this.clearLook();
    let paper = this.plugin.settings.paper;
    if (paper === "auto") paper = body.classList.contains("theme-dark") ? "blue" : "cream";
    if (paper !== "theme") body.classList.add("wm-paper", `wm-paper-${paper}`);
  }

  private clearLook(doc = this.doc): void {
    doc.body.classList.remove(
      "wm-paper",
      "wm-paper-cream",
      "wm-paper-white",
      "wm-paper-blue",
      "wm-paper-grey",
      "wm-paper-green",
      "wm-paper-mac",
    );
  }

  /** The face, on the view for the prose and on the body for anything that opens over the page. */
  private applyFont(el: HTMLElement): void {
    const font = this.plugin.settings.font.trim();
    for (const target of [el, this.doc.body]) {
      target.classList.toggle("wm-font", font.length > 0);
      target.setCssProps({ "--wm-font": fontStack(font) });
    }
  }

  private tearDown(session: Session): void {
    const app = this.plugin.app;
    const body = this.doc.body;

    app.keymap.popScope(session.scope);
    session.unfollow?.();
    if (session.countTimer !== null) window.clearTimeout(session.countTimer);
    session.count?.remove();
    for (const undo of session.cleanup) undo();

    body.classList.remove("wm-on", "wm-typewriter", "wm-font");
    body.setCssProps({ "--wm-font": "" });
    session.view.containerEl.classList.remove("wm-view", "wm-sized", "wm-font");
    session.view.containerEl.setCssProps({ "--wm-font-size": "", "--wm-font": "" });
    session.view.containerEl.closest(".workspace-leaf")?.classList.remove("wm-leaf");

    if (session.wasDark !== null) {
      body.classList.toggle("theme-dark", session.wasDark);
      body.classList.toggle("theme-light", !session.wasDark);
    }

    this.leaveFullScreen(session.fullScreen);

    try {
      session.cm.dispatch({ effects: setWritingMode.of(null) });
    } catch {
      // The editor was torn down with its leaf; there is nothing to switch off.
    }

    const changedMode = session.mode !== "source" || session.source;
    if (changedMode && session.view.containerEl.isConnected) {
      const now = session.leaf.getViewState();
      const state = now.state ?? {};
      void session.leaf.setViewState(
        { ...now, state: { ...state, mode: session.mode, source: session.source } },
        session.view.getEphemeralState(),
      );
    }
  }

  /**
   * Swaps the body's light and dark classes to the device's appearance while
   * the setting is on, and puts the vault's own back when it is turned off.
   */
  private followSystem(session: Session): void {
    const body = this.doc.body;
    const on = this.plugin.settings.followSystemAppearance;
    if (on && !session.unfollow) {
      const media = this.win.matchMedia("(prefers-color-scheme: dark)");
      const follow = (): void => {
        body.classList.toggle("theme-dark", media.matches);
        body.classList.toggle("theme-light", !media.matches);
        this.applyLook();
      };
      session.wasDark = body.classList.contains("theme-dark");
      follow();
      media.addEventListener("change", follow);
      session.unfollow = () => media.removeEventListener("change", follow);
    } else if (!on && session.unfollow) {
      session.unfollow();
      session.unfollow = null;
      if (session.wasDark !== null) {
        body.classList.toggle("theme-dark", session.wasDark);
        body.classList.toggle("theme-light", !session.wasDark);
        session.wasDark = null;
      }
      this.applyLook();
    }
  }

  /**
   * The workspace changed: the mode's tab was closed, or another tab in its
   * place was brought forward, so the note is no longer the one on screen.
   */
  layoutChanged(): void {
    const session = this.session;
    if (!session) return;
    if (!session.view.containerEl.isConnected) this.exit(false);
    else if (!session.view.containerEl.isShown()) this.exit();
  }

  /** Obsidian went light or dark (or changed theme): Automatic follows it. */
  appearanceChanged(): void {
    if (this.session) this.applyLook();
  }

  /** A note was opened; if it opened in the mode's tab, the mode carries on in it. */
  fileOpened(): void {
    const session = this.session;
    if (!session || this.busy) return;
    const cm = editorViewOf(session.view);
    if (!cm) return;
    if (cm.state.field(writingModeField, false)) return;
    session.cm = cm;
    cm.dispatch({ effects: setWritingMode.of(this.options()) });
    this.writeCount();
  }

  /** Settings changed while the mode is on: apply them without leaving. */
  applySettings(): void {
    const session = this.session;
    if (!session) return;
    this.doc.body.classList.toggle("wm-typewriter", this.plugin.settings.typewriter);
    this.followSystem(session);
    this.applyLook();
    this.applyFont(session.view.containerEl);
    session.cm.dispatch({ effects: setWritingMode.of(this.options()) });
    this.applyCount();
  }

  /** Something was typed in an editor; if it is ours, the count catches up. */
  noteChanged(info: MarkdownFileInfo | MarkdownView): void {
    const session = this.session;
    if (!session || !session.count || info !== session.view) return;
    if (session.countTimer !== null) window.clearTimeout(session.countTimer);
    session.countTimer = window.setTimeout(() => {
      session.countTimer = null;
      this.writeCount();
    }, COUNT_SETTLE_MS);
  }

  /** Steps the size up or down, or with null puts the default back. */
  private changeSize(direction: 1 | -1 | null): void {
    const device = this.plugin.device;
    device.fontSize = direction === null ? null : stepSize(this.currentSize(), direction);
    this.sizeChanged();
  }

  /** The size in use: the device's chosen one, or the default from the editor's. */
  currentSize(): number {
    return this.plugin.device.fontSize ?? defaultSize(this.themeSize(), Platform.isMobile);
  }

  private themeSize(): number {
    const raw = parseFloat(getComputedStyle(this.doc.body).getPropertyValue("--font-text-size"));
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 16;
  }


  private options(): WritingModeOptions {
    return { dimming: this.plugin.settings.dimming, typewriter: this.plugin.settings.typewriter };
  }

  /** Puts the device's size on the page; called again whenever it changes, here or in settings. */
  sizeChanged(): void {
    const session = this.session;
    if (!session) return;
    session.view.containerEl.classList.add("wm-sized");
    session.view.containerEl.setCssProps({ "--wm-font-size": `${this.currentSize()}px` });
  }

  /** Takes the window full screen, the way Obsidian's own toggle does, and says how. */
  private goFullScreen(cleanup: (() => void)[]): FullScreenRoute {
    if (!Platform.isDesktopApp) return null;
    const win = electronWindow(this.win);
    if (win) {
      try {
        if (win.isFullScreen()) return null;
        win.setFullScreen(true);
        return "window";
      } catch {
        // The window handle exists but will not take the call; the page still works.
        return null;
      }
    }
    const doc = this.doc;
    if (doc.fullscreenElement) return null;
    void doc.documentElement.requestFullscreen().catch(() => undefined);
    // Escape leaves this kind of full screen on its own; the mode follows it out.
    const onChange = (): void => {
      if (!doc.fullscreenElement && this.session) this.exit();
    };
    doc.addEventListener("fullscreenchange", onChange);
    cleanup.push(() => doc.removeEventListener("fullscreenchange", onChange));
    return "document";
  }

  private leaveFullScreen(route: FullScreenRoute): void {
    if (route === "window") {
      try {
        electronWindow(this.win)?.setFullScreen(false);
      } catch {
        // Nothing to put back.
      }
    }
    else if (route === "document" && this.doc.fullscreenElement) void this.doc.exitFullscreen().catch(() => undefined);
  }

  /** A sheet the color of the backdrop fades over everything; resolves once it is up. */
  private raiseVeil(): Promise<HTMLElement> {
    const veil = this.doc.body.createDiv({ cls: "wm-veil" });
    // A forced layout, then the class, so the transition runs from 0. A timer
    // rather than an animation frame: frames stop in a window that is covered.
    veil.getBoundingClientRect();
    veil.classList.add("wm-veil-up");
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(veil), VEIL_MS + 30);
    });
  }

  private lowerVeil(veil: HTMLElement, then?: () => void): void {
    veil.classList.remove("wm-veil-up");
    window.setTimeout(() => {
      veil.remove();
      then?.();
    }, VEIL_MS + 200);
  }

  private applyCount(): void {
    const session = this.session;
    if (!session) return;
    if (this.plugin.settings.wordCount && !session.count) {
      session.count = session.view.containerEl.createDiv({ cls: "wm-wordcount" });
      this.writeCount();
    } else if (!this.plugin.settings.wordCount && session.count) {
      session.count.remove();
      session.count = null;
    }
  }

  private writeCount(): void {
    const session = this.session;
    if (!session?.count) return;
    const words = wordCount(session.view.editor.getValue());
    session.count.setText(`${words.toLocaleString()} ${words === 1 ? "word" : "words"}`);
  }

  /**
   * Two fingers apart or together scale the text with them, on the phone,
   * a frame at a time; the size is kept, to the whole pixel, when they lift.
   */
  private listenForPinch(el: HTMLElement, cleanup: (() => void)[]): void {
    let startDistance: number | null = null;
    let startSize = 0;
    let live = 0;
    let frame = 0;
    const distance = (touches: TouchList): number =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onStart = (event: TouchEvent): void => {
      if (event.touches.length !== 2) return;
      startDistance = distance(event.touches);
      startSize = this.currentSize();
      live = startSize;
    };
    const onMove = (event: TouchEvent): void => {
      if (startDistance === null || event.touches.length !== 2) return;
      live = Math.min(SIZE_MAX, Math.max(SIZE_MIN, startSize * (distance(event.touches) / startDistance)));
      if (frame) return;
      frame = this.win.requestAnimationFrame(() => {
        frame = 0;
        this.session?.view.containerEl.setCssProps({ "--wm-font-size": `${live.toFixed(1)}px` });
      });
    };
    const onEnd = (): void => {
      if (startDistance === null) return;
      startDistance = null;
      if (frame) this.win.cancelAnimationFrame(frame);
      frame = 0;
      const kept = clampSize(live);
      if (kept !== this.currentSize()) this.plugin.device.fontSize = kept;
      this.sizeChanged();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    cleanup.push(() => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      if (frame) this.win.cancelAnimationFrame(frame);
    });
  }
}
