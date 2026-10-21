import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { frontmatterLines, ornamentLines, paragraphAround, sentenceAround, wordCount } from "../src/text";

const doc = (s: string | string[]) => Text.of(Array.isArray(s) ? s : s.split("\n"));

const STORY = doc(
  [
    "---",
    "title: A Good Death",
    "---",
    "",
    "# A Good Death",
    "",
    "Most never saw the black and red robes. The eyeless sockets bore down into me: *this is all your fault.*",
    "A second line of the same paragraph.",
    "",
    "The scribe read out the sentence, “For most abominable violations.” I looked away.",
    "",
  ].join("\n"),
);

test("paragraph is the run of non-blank lines around the cursor", () => {
  const line7 = STORY.line(7);
  const line8 = STORY.line(8);
  const span = paragraphAround(STORY, line7.from + 5);
  assert.deepEqual(span, { from: line7.from, to: line8.to });
  assert.deepEqual(paragraphAround(STORY, line8.to), { from: line7.from, to: line8.to });
});

test("a blank line lights nothing until something is typed", () => {
  const line9 = STORY.line(9);
  assert.deepEqual(paragraphAround(STORY, line9.from), { from: line9.from, to: line9.from });
});

test("a heading is its own paragraph", () => {
  const line5 = STORY.line(5);
  assert.deepEqual(paragraphAround(STORY, line5.from + 2), { from: line5.from, to: line5.to });
});

test("sentence ends at a stop followed by space, closing quotes allowed", () => {
  const line10 = STORY.line(10);
  const first = sentenceAround(STORY, line10.from + 3);
  assert.equal(STORY.sliceString(first.from, first.to), "The scribe read out the sentence, “For most abominable violations.”");
  const second = sentenceAround(STORY, line10.to - 2);
  assert.equal(STORY.sliceString(second.from, second.to), "I looked away.");
});

test("sentence runs across a line break inside the paragraph", () => {
  const line7 = STORY.line(7);
  const span = sentenceAround(STORY, line7.to);
  assert.equal(STORY.sliceString(span.from, span.to), "The eyeless sockets bore down into me: *this is all your fault.*");
});

test("cursor in the space after a sentence keeps that sentence lit", () => {
  const d = doc(["Hello there. "]);
  const span = sentenceAround(d, 13);
  assert.equal(d.sliceString(span.from, span.to), "Hello there.");
  const typed = doc(["Hello there. W"]);
  const next = sentenceAround(typed, 14);
  assert.equal(typed.sliceString(next.from, next.to), "W");
});

test("an ellipsis and a question mark end sentences too", () => {
  const d = doc(["Was it so… Who could say? Nobody."]);
  assert.equal(d.sliceString(...spread(sentenceAround(d, 2))), "Was it so…");
  assert.equal(d.sliceString(...spread(sentenceAround(d, 15))), "Who could say?");
  assert.equal(d.sliceString(...spread(sentenceAround(d, 30))), "Nobody.");
});

function spread(span: { from: number; to: number }): [number, number] {
  return [span.from, span.to];
}

test("front matter lines are found, and only at the top", () => {
  assert.deepEqual(frontmatterLines(STORY), { first: 1, last: 3 });
  assert.equal(frontmatterLines(doc(["# Title", "---", "x", "---"])), null);
  assert.equal(frontmatterLines(doc(["---", "open: forever"])), null);
  assert.deepEqual(frontmatterLines(doc(["---", "a: 1", "..."])), { first: 1, last: 3 });
});

test("word count leaves out front matter, notes to yourself and bare punctuation", () => {
  assert.equal(wordCount("---\ntitle: X\n---\nOne two three."), 3);
  assert.equal(wordCount("One ==two==%%move this%% three — four."), 4);
  assert.equal(wordCount("A multi\nline %%note\nacross lines%% story"), 4);
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("—"), 0);
});

test("ornaments: the first paragraph, openings after breaks and headings, breaks, the last line", () => {
  const story = doc([
    "---",
    "title: A story",
    "---",
    "",
    "## One",
    "",
    "First paragraph.",
    "Its second line.",
    "",
    "Second paragraph.",
    "",
    "***",
    "",
    "After the break.",
    "",
    "## Two",
    "",
    "- a list item",
    "",
    "After the heading, past the list.",
    "",
    "* * *",
    "",
    "Last paragraph.",
    "",
  ]);
  assert.deepEqual(ornamentLines(story), { first: 7, openings: [14, 20, 24], breaks: [12, 22], last: 24 });
});

test("ornaments: a story with no front matter or headings, and an empty note", () => {
  assert.deepEqual(ornamentLines(doc(["Only line."])), { first: 1, openings: [], breaks: [], last: 1 });
  assert.deepEqual(ornamentLines(doc(["---", "a: 1", "---"])), { first: null, openings: [], breaks: [], last: null });
});
