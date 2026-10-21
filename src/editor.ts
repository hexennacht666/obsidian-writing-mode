// The two things the mode does inside the editor: dim what the cursor is not
// in, and hold the cursor's line where it is on the screen. Both are CodeMirror view
// plugins that do nothing until the mode is switched on in that editor, so the
// extension can sit in every editor and act in one.

import { EditorSelection, EditorState, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import type { Dimming } from "./settings";
import { frontmatterLines, paragraphAround, sentenceAround, type Span } from "./text";

export interface WritingModeOptions {
  dimming: Dimming;
  typewriter: boolean;
}

/** Switches the mode on in one editor, with its options, or off with null. */
export const setWritingMode = StateEffect.define<WritingModeOptions | null>();

/** Dimming lifted because the lit passage was scrolled out of view. */
const liftDimming = StateEffect.define<boolean>();

export const writingModeField = StateField.define<WritingModeOptions | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setWritingMode)) return effect.value;
    }
    return value;
  },
});

/** True from a scroll-away until the cursor is placed or something is typed. */
const liftedField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(liftDimming)) return effect.value;
      if (effect.is(setWritingMode)) return false;
    }
    if (transaction.selection || transaction.docChanged) return false;
    return value;
  },
});

/**
 * The front matter is hidden, so nothing may happen inside it unseen: the
 * caret and the ends of a selection are kept at or after the start of the
 * prose (the Up arrow from the first line, Cmd-Home, a newly opened note), and
 * typing or deleting that would reach into it (Backspace at the start of the
 * prose) is refused. In a note that is only front matter, typing starts a new
 * line after it.
 */
const guardFrontmatter = EditorState.transactionFilter.of((transaction) => {
  const switchedOn = transaction.effects.some((effect) => effect.is(setWritingMode) && effect.value !== null);
  if (!switchedOn && !transaction.startState.field(writingModeField, false)) return transaction;
  const start = transaction.startState.doc;
  const frontmatter = frontmatterLines(start);
  if (!frontmatter) return transaction;
  const end = start.line(frontmatter.last).to;
  const prose = end < start.length ? end + 1 : end;

  if (transaction.docChanged) {
    if (!transaction.isUserEvent("input") && !transaction.isUserEvent("delete")) return transaction;
    let reaches = false;
    let insertedAtEnd: string | null = null;
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA < prose) reaches = true;
      else if (fromA === start.length && toA === fromA && prose === end) insertedAtEnd = inserted.toString();
    });
    if (reaches) return [];
    if (insertedAtEnd === null) return transaction;
    const text = `\n${insertedAtEnd as string}`;
    return {
      changes: { from: end, insert: text },
      selection: EditorSelection.cursor(end + text.length),
      userEvent: "input",
    };
  }

  if (!switchedOn && !transaction.selection) return transaction;
  const selection = transaction.newSelection;
  if (selection.ranges.every((range) => range.from >= prose)) return transaction;
  const clamped = EditorSelection.create(
    selection.ranges.map((range) =>
      EditorSelection.range(Math.max(range.anchor, prose), Math.max(range.head, prose)),
    ),
    selection.mainIndex,
  );
  return [transaction, { selection: clamped, sequential: true }];
});

function litSpan(view: EditorView, dimming: Dimming): Span | null {
  if (dimming === "off") return null;
  const head = view.state.selection.main.head;
  return dimming === "sentence"
    ? sentenceAround(view.state.doc, head)
    : paragraphAround(view.state.doc, head);
}

const dimMark = Decoration.mark({ class: "wm-dim" });
const frontmatterLine = Decoration.line({ class: "wm-frontmatter" });

function buildMarks(view: EditorView): DecorationSet {
  const options = view.state.field(writingModeField);
  if (!options) return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;

  const frontmatter = frontmatterLines(doc);
  if (frontmatter) {
    for (let n = frontmatter.first; n <= frontmatter.last; n += 1) {
      ranges.push(frontmatterLine.range(doc.line(n).from));
    }
  }

  const lit = view.state.field(liftedField) ? null : litSpan(view, options.dimming);
  if (lit) {
    for (const { from, to } of view.visibleRanges) {
      const beforeEnd = Math.min(lit.from, to);
      if (beforeEnd > from) ranges.push(dimMark.range(from, beforeEnd));
      const afterStart = Math.max(lit.to, from);
      if (to > afterStart) ranges.push(dimMark.range(afterStart, to));
    }
  }

  return Decoration.set(ranges, true);
}

/** How long after the last scroll event the lit passage is checked for. */
const SCROLL_SETTLE_MS = 150;

class Marks implements PluginValue {
  decorations: DecorationSet;
  private settle: number | null = null;

  constructor(private readonly view: EditorView) {
    this.decorations = buildMarks(view);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
  }

  update(update: ViewUpdate): void {
    const now = update.state.field(writingModeField);
    const before = update.startState.field(writingModeField);
    if (!now && !before) return;
    if (
      now !== before ||
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.state.field(liftedField) !== update.startState.field(liftedField)
    ) {
      this.decorations = buildMarks(update.view);
    }
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    if (this.settle !== null) window.clearTimeout(this.settle);
  }

  /**
   * A read-through by scrolling never leaves the whole screen dimmed: once the
   * lit passage has been scrolled out of view and the scrolling has settled,
   * the dimming lifts until the cursor is placed again.
   */
  private readonly onScroll = (): void => {
    if (this.settle !== null) window.clearTimeout(this.settle);
    this.settle = window.setTimeout(() => {
      this.settle = null;
      const options = this.view.state.field(writingModeField);
      if (!options || options.dimming === "off" || this.view.state.field(liftedField)) return;
      const lit = litSpan(this.view, options.dimming);
      if (!lit) return;
      const top = this.view.coordsAtPos(lit.from);
      const bottom = this.view.coordsAtPos(lit.to, -1);
      const rect = this.view.scrollDOM.getBoundingClientRect();
      const visible = top && bottom && bottom.bottom > rect.top && top.top < rect.bottom;
      if (!visible) this.view.dispatch({ effects: liftDimming.of(true) });
    }, SCROLL_SETTLE_MS);
  };
}

const marksPlugin = ViewPlugin.fromClass(Marks, { decorations: (value) => value.decorations });

/**
 * Typewriter scrolling as Scrivener does it: the line being typed on stays
 * exactly where it is on the screen, and the paragraphs above and below move
 * past it. Nothing is ever moved to the center. A click or an
 * arrow key places the caret and nothing scrolls; entering the mode scrolls
 * nothing. Only a keystroke that carries the caret onto a new line, by Return
 * or by wrapping, moves the page, and then by exactly the height the caret
 * would otherwise have dropped, so it is held where it was.
 *
 * The hold rides inside the editor's own scroll step: every typing
 * transaction is given a scroll target that puts the caret's line back at
 * the held height, replacing the editor's default "bring it into view".
 * A second scroll a frame later would make the page bounce.
 */

/** Where a caret found out of view is held, as fractions of the editor's height. */
const HELD_MIN = 0.25;
const HELD_MAX = 0.6;

/** The caret's height, from the top of the editor, to hold while typing. */
const setHeldTop = StateEffect.define<number | null>();

const heldTopField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setHeldTop)) return effect.value;
      if (effect.is(setWritingMode)) return null;
    }
    return value;
  },
});

const holdLine = EditorState.transactionExtender.of((transaction) => {
  // Typing, and anything else that asks to bring the caret into view, is held;
  // a sync or another plugin changing the note leaves the page where it is.
  if (!transaction.docChanged || transaction.isUserEvent("set")) return null;
  if (!transaction.selection && !transaction.scrollIntoView) return null;
  const options = transaction.startState.field(writingModeField, false);
  const held = transaction.startState.field(heldTopField, false);
  if (!options?.typewriter || held === null || held === undefined) return null;
  return {
    effects: EditorView.scrollIntoView(transaction.newSelection.main.head, { y: "start", yMargin: held }),
  };
});

class Typewriter implements PluginValue {
  /** True for the rest of the task in which the note was edited. */
  private justEdited = false;

  constructor(private readonly view: EditorView) {
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  update(update: ViewUpdate): void {
    const options = update.state.field(writingModeField);
    if (!options?.typewriter) return;
    const started = !update.startState.field(writingModeField)?.typewriter;
    // Typing is held by the extender. A placed caret sets the height to hold,
    // and so does the page laying out again under it without typing (the
    // mode's text size arriving after it opens, a pinch, a rotated phone).
    // Settings applied while the mode is on clear the held height, so it is
    // measured again.
    const reset = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setWritingMode)));
    const placed = update.selectionSet || update.geometryChanged || reset;
    if (update.docChanged) {
      this.justEdited = true;
      window.setTimeout(() => (this.justEdited = false), 0);
    } else if (update.selectionSet && this.justEdited) {
      // An edit that sets its caret separately, as an accepted suggestion
      // does, is still typing: the caret goes back to the held height.
      this.hold();
    } else if (started || placed) {
      this.remember();
    }
  }

  destroy(): void {
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
  }

  /** The caret was placed: measure its height and hold it from here on. */
  private remember(): void {
    window.setTimeout(() => {
      const view = this.view;
      if (!view.dom.isConnected || !view.state.field(writingModeField)?.typewriter) return;
      const coords = view.coordsAtPos(view.state.selection.main.head);
      if (!coords) return;
      const height = view.scrollDOM.clientHeight;
      let top = coords.top - view.scrollDOM.getBoundingClientRect().top;
      // The caret scrolled out of view when the page laid out again (a
      // setting switched, a resize): typing brings it back into the page,
      // not to the edge it went past.
      if (top < 0 || coords.bottom - coords.top + top > height) {
        top = Math.min(Math.max(top, height * HELD_MIN), height * HELD_MAX);
      }
      const held = view.state.field(heldTopField);
      if (held !== null && Math.abs(held - top) < 1) return;
      view.dispatch({ effects: setHeldTop.of(top) });
    }, 0);
  }

  private hold(): void {
    window.setTimeout(() => {
      const view = this.view;
      const held = view.state.field(heldTopField);
      if (!view.dom.isConnected || held === null) return;
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "start", yMargin: held }),
      });
    }, 0);
  }

  /** On the phone the held height moves with the keyboard. */
  private readonly onViewportResize = (): void => {
    this.remember();
  };
}

const typewriterPlugin = ViewPlugin.fromClass(Typewriter);

export function writingModeExtension(): Extension {
  return [writingModeField, liftedField, heldTopField, holdLine, guardFrontmatter, marksPlugin, typewriterPlugin];
}
