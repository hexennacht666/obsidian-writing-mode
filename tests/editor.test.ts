import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { setWritingMode, writingModeExtension } from "../src/editor";

const NOTE = "---\ntitle: A\n---\nOnce upon a time.";
const PROSE = NOTE.indexOf("Once");
const on = { effects: setWritingMode.of({ dimming: "off" as const, typewriter: true }) };

function inMode(doc = NOTE, cursor = PROSE): EditorState {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: writingModeExtension() });
  return state.update(on).state;
}

test("switching the mode on moves a caret out of the front matter", () => {
  const state = EditorState.create({ doc: NOTE, extensions: writingModeExtension() });
  assert.equal(state.update(on).state.selection.main.head, PROSE);
});

test("a caret moved into the front matter goes back to the start of the prose", () => {
  const state = inMode().update({ selection: EditorSelection.cursor(0), userEvent: "select" }).state;
  assert.equal(state.selection.main.head, PROSE);
});

test("a selection reaching into the front matter stops at the prose", () => {
  const state = inMode().update({ selection: EditorSelection.range(NOTE.length, 2), userEvent: "select" }).state;
  assert.deepEqual([state.selection.main.anchor, state.selection.main.head], [NOTE.length, PROSE]);
});

test("Backspace at the start of the prose does not join it to the front matter", () => {
  const state = inMode().update({ changes: { from: PROSE - 1, to: PROSE }, userEvent: "delete.backward" }).state;
  assert.equal(state.doc.toString(), NOTE);
});

test("typing at the start of the prose goes in", () => {
  const state = inMode().update({ changes: { from: PROSE, insert: "x" }, userEvent: "input.type" }).state;
  assert.equal(state.doc.toString(), NOTE.replace("Once", "xOnce"));
});

test("an edit that is not typing may still change the front matter", () => {
  const state = inMode().update({ changes: { from: 4, to: 12, insert: "title: B" }, userEvent: "set" }).state;
  assert.equal(state.doc.toString(), NOTE.replace("title: A", "title: B"));
});

test("in a note of only front matter, typing starts a new line", () => {
  const doc = "---\ntitle: A\n---";
  const state = inMode(doc, doc.length).update({ changes: { from: doc.length, insert: "Hi" }, userEvent: "input.type" }).state;
  assert.equal(state.doc.toString(), `${doc}\nHi`);
  assert.equal(state.selection.main.head, state.doc.length);
});

test("outside the mode the front matter is left alone", () => {
  const state = EditorState.create({ doc: NOTE, extensions: writingModeExtension() });
  assert.equal(state.update({ selection: EditorSelection.cursor(0) }).state.selection.main.head, 0);
});
