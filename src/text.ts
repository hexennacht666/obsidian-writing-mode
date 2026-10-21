// Where things are in the text: the paragraph or sentence around the cursor,
// the front matter, the word count. Pure functions over the document, so each
// has a test and none knows about the editor.

/** The part of a CodeMirror Text these functions read. */
export interface Doc {
  readonly lines: number;
  readonly length: number;
  line(n: number): { from: number; to: number; text: string; number: number };
  lineAt(pos: number): { from: number; to: number; text: string; number: number };
  sliceString(from: number, to: number): string;
}

export interface Span {
  from: number;
  to: number;
}

function blank(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * The paragraph with the cursor: the run of non-blank lines around it. On a
 * blank line the paragraph is the empty line itself, so nothing is lit until
 * the writer types, and then the new paragraph is.
 */
export function paragraphAround(doc: Doc, pos: number): Span {
  const line = doc.lineAt(pos);
  if (blank(line.text)) return { from: line.from, to: line.from };

  let first = line.number;
  while (first > 1 && !blank(doc.line(first - 1).text)) first -= 1;
  let last = line.number;
  while (last < doc.lines && !blank(doc.line(last + 1).text)) last += 1;

  return { from: doc.line(first).from, to: doc.line(last).to };
}

/**
 * A sentence ends at a full stop, question or exclamation mark, closing quotes
 * or an italic or bold closer allowed after it, followed by space.
 */
const SENTENCE_END = /[.!?\u2026]["\u201d'\u2019)\]*_]*(?=\s)/g;

/**
 * The sentence with the cursor, within its paragraph. A cursor in the space
 * after a sentence, with nothing typed yet, keeps that sentence lit rather than
 * dimming the whole page for the length of a pause.
 */
export function sentenceAround(doc: Doc, pos: number): Span {
  const paragraph = paragraphAround(doc, pos);
  if (paragraph.to === paragraph.from) return paragraph;

  const text = doc.sliceString(paragraph.from, paragraph.to);
  const rel = pos - paragraph.from;

  const ends: number[] = [];
  SENTENCE_END.lastIndex = 0;
  let match = SENTENCE_END.exec(text);
  while (match) {
    ends.push(match.index + match[0].length);
    match = SENTENCE_END.exec(text);
  }
  if (ends[ends.length - 1] !== text.length) ends.push(text.length);

  let start = 0;
  let previous: Span | null = null;
  for (const end of ends) {
    let from = start;
    while (from < end && /\s/.test(text[from])) from += 1;
    const sentence = { from: paragraph.from + from, to: paragraph.from + end };
    if (rel <= end) {
      return sentence.from === sentence.to && previous ? previous : sentence;
    }
    previous = sentence;
    start = end;
  }
  return previous ?? paragraph;
}

/** The lines of the front matter, 1-based and inclusive, or null when there is none. */
export function frontmatterLines(doc: Doc): { first: number; last: number } | null {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return null;
  for (let n = 2; n <= doc.lines; n += 1) {
    const text = doc.line(n).text.trim();
    if (text === "---" || text === "...") return { first: 1, last: n };
  }
  return null;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const COMMENT = /%%[\s\S]*?%%/g;
const WORD = /[\p{L}\p{N}]/u;

/**
 * Words in the prose: the front matter and notes to yourself (native `%%`
 * comments) are not part of the story, so they are not counted.
 */
export function wordCount(text: string): number {
  const prose = text.replace(FRONTMATTER, "").replace(COMMENT, "");
  let count = 0;
  for (const token of prose.split(/\s+/)) {
    if (WORD.test(token)) count += 1;
  }
  return count;
}

/** Where the manuscript papers put their ornaments, by line number. */
export interface Ornaments {
  /** The story's first line of prose: the initial and small capitals. */
  first: number | null;
  /** First lines of prose after a scene break or heading: small capitals. */
  openings: number[];
  /** The story's last line of prose: the tailpiece under it. */
  last: number | null;
}

const HEADING = /^#{1,6}\s/;
/** `***`, `---` or `___`; Obsidian draws these, and the papers restyle what it draws. */
const SCENE_BREAK = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/;
/** A line of `=` or `-` under a paragraph makes that paragraph a heading. */
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/** Lines that are not running prose: lists, quotes, tables, embeds, tags, footnotes. */
const NOT_PROSE = /^\s*(?:[-*+]\s|\d+[.)]\s|>|\||!\[\[|#[^\s#]|\[\^[^\]]+\]:)/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const MATH = /^\s*\$\$/;

function commentMarks(text: string): number {
  return text.split("%%").length - 1;
}

/**
 * The line numbers the manuscript papers decorate. Prose is everything that
 * is not front matter, a heading, a scene break, one of the NOT_PROSE kinds,
 * or inside a code block, a math block or a `%%` note to yourself.
 */
export function ornamentLines(doc: Doc): Ornaments {
  const frontmatter = frontmatterLines(doc);
  const result: Ornaments = { first: null, openings: [], last: null };
  let opens = true;
  let inParagraph = false;
  let paragraphStart = 0;
  let lastBeforeParagraph: number | null = null;
  let block: "fence" | "math" | "comment" | null = null;
  for (let n = frontmatter ? frontmatter.last + 1 : 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    if (block) {
      if (block === "fence" && FENCE.test(text)) block = null;
      else if (block === "math" && MATH.test(text)) block = null;
      else if (block === "comment" && commentMarks(text) % 2 === 1) block = null;
      continue;
    }
    if (FENCE.test(text) || MATH.test(text) || (text.trimStart().startsWith("%%") && commentMarks(text) % 2 === 1)) {
      block = FENCE.test(text) ? "fence" : MATH.test(text) ? "math" : "comment";
      inParagraph = false;
      continue;
    }
    if (blank(text)) {
      inParagraph = false;
      continue;
    }
    if (inParagraph && UNDERLINE.test(text)) {
      // The paragraph above was a heading after all.
      if (result.first === paragraphStart) result.first = null;
      else if (result.openings[result.openings.length - 1] === paragraphStart) result.openings.pop();
      result.last = lastBeforeParagraph;
      opens = true;
      inParagraph = false;
      continue;
    }
    if (SCENE_BREAK.test(text) || HEADING.test(text)) {
      opens = true;
      inParagraph = false;
      continue;
    }
    if (NOT_PROSE.test(text) || text.trimStart().startsWith("%%")) {
      inParagraph = false;
      continue;
    }
    if (!inParagraph) {
      paragraphStart = n;
      lastBeforeParagraph = result.last;
      if (opens) {
        if (result.first === null) result.first = n;
        else result.openings.push(n);
        opens = false;
      }
    }
    inParagraph = true;
    // A note to yourself opened mid-line runs on into the lines below.
    if (commentMarks(text) % 2 === 1) block = "comment";
    result.last = n;
  }
  return result;
}

/**
 * The tailpiece sits under the story's last line, but only while the cursor
 * is above it: writing on at the end would otherwise move it, and the page
 * with it, at every new line.
 */
export function tailpieceLine(ornaments: Ornaments, cursorLine: number): number | null {
  return ornaments.last !== null && cursorLine < ornaments.last ? ornaments.last : null;
}
