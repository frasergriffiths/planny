import { parse, serialize } from 'parse5';
import postcss from 'postcss';

interface Attribute {
  name: string;
  value: string;
  prefix?: string;
  namespace?: string;
}

interface Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: Attribute[];
  childNodes: Node[];
  parentNode?: Node;
  value?: string;
}

interface Document {
  nodeName: '#document';
  childNodes: Node[];
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DEPTH = 200;
// parse5 spends super-linear time in the number of attributes it keeps, and any one
// start tag can carry as many attributes as the 4 MiB cap allows. The scan bounds both
// counts before the parser runs: 2,048 per tag, 40,000 document-wide. A real generated
// table with ~5k rows of 5 attributes (~25k total) stays well inside that, and its parse
// measures in the tens of milliseconds (see CHANGELOG).
export const MAX_ATTRIBUTES_PER_TAG = 2048;
export const MAX_ATTRIBUTES_TOTAL = 40_000;

export class SanitizeTooManyAttributesError extends Error {
  readonly code = 'too_many_attributes';

  constructor() {
    super('plan uses too many attributes');
  }
}

const isSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
const isAsciiAlpha = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

// Comments follow the tokenizer's own states, so a markup-looking run can never hide the
// way this scan ends. `<!-->` and `<!--->` are abrupt closings; `-->` and `--!>` close
// normally; anything else runs to the end of the input, exactly like the parser.
function commentEnd(html: string, at: number): number {
  if (html[at] === '>' || (html[at] === '-' && html[at + 1] === '>')) {
    return html[at] === '>' ? at + 1 : at + 2;
  }
  for (let i = at; i < html.length; i += 1) {
    if (html[i] !== '-') continue;
    if (html[i + 1] !== '-') continue;
    if (html[i + 2] === '>') return i + 3;
    if (html[i + 2] === '!' && html[i + 3] === '>') return i + 4;
  }
  return html.length;
}

const TAG_NAME = 0;
const BEFORE_ATTR = 1;
const ATTR_NAME = 2;
const BEFORE_VALUE = 3;
const VALUE_DQ = 4;
const VALUE_SQ = 5;
const VALUE_UNQUOTED = 6;
const AFTER_QUOTED = 7;
const SELF_CLOSING = 8;

// One linear pass that mirrors the tag machinery of the tokenizer state by state: tag
// name, before-attribute-name, attribute name, quoted and unquoted values, the after-value
// state where a name can follow a closing quote without whitespace, and self-closing.
// Entering an attribute name is the only thing that counts, so every attribute the real
// parse can mint is counted, whatever separator the attack omits — including the ones on
// end tags, which parse5 tokenizes (and then drops at the tree level) at the same cost.
//
// Two tokenizer details this pass must not approximate:
//   - `>` closes a tag in every state EXCEPT the quoted values, where it is value text and
//     the matching quote decides (a `<div a=">" b60000…>` scan must not stop at the `>`);
//   - `=` as the first character of an attribute name is CONSUMED as the name and mints an
//     attribute literally named `=` — both in BEFORE-ATTRIBUTE-NAME (unexpected `=` after
//     a name) and when the character is reconsumed out of AFTER-ATTRIBUTE-VALUE-QUOTED.
// Counts can only overshoot (a quote shaped like a name pulls the matcher along), never
// undershoot, while how much content is skipped is decided by the content model in
// `guardAttributes`, never here.
//
// Returns the index just after the tag's `>` (or the end of the input), the number of
// attribute entries inside the tag, and whether the tag actually self-closed (the flag
// parse5 sets, which only ever happens when the `/` is consumed in the self-closing state).
function walkTag(
  html: string,
  at: number,
  i: number,
  entryState = TAG_NAME,
): { end: number; count: number; selfClosing: boolean } {
  let state = entryState;
  let count = 0;
  let selfClosing = false;
  const countAttr = (): void => {
    count += 1;
    if (count > MAX_ATTRIBUTES_PER_TAG) throw new SanitizeTooManyAttributesError();
  };
  while (i < at) {
    const code = html.charCodeAt(i);
    const space = isSpace(code);
    switch (state) {
      case TAG_NAME:
        if (code === 62 /* > */) return { end: i + 1, count, selfClosing };
        if (space) state = BEFORE_ATTR;
        else if (code === 47) state = SELF_CLOSING;
        i += 1;
        continue;
      case SELF_CLOSING:
        if (code === 62 /* > */) {
          selfClosing = true;
          return { end: i + 1, count, selfClosing };
        }
        state = BEFORE_ATTR;
        continue; // reconsume: the slash was not a self-close after all
      case BEFORE_ATTR:
        if (code === 62 /* > */) return { end: i + 1, count, selfClosing };
        if (space) {
          i += 1;
          continue;
        }
        if (code === 47) {
          state = SELF_CLOSING;
          i += 1;
          continue;
        }
        if (code === 61 /* = */) {
          countAttr(); // parse5 mints an attribute named `=` and consumes the character
          state = ATTR_NAME;
          i += 1;
          continue;
        }
        countAttr();
        state = ATTR_NAME;
        continue; // reconsume this character in the name state
      case ATTR_NAME:
        if (code === 62 /* > */) return { end: i + 1, count, selfClosing };
        if (space) {
          state = BEFORE_ATTR;
          i += 1;
          continue;
        }
        if (code === 47) {
          state = BEFORE_ATTR;
          continue; // the slash is reconsumed, where it may close the tag
        }
        if (code === 61 /* = */) {
          state = BEFORE_VALUE;
          i += 1;
          continue;
        }
        i += 1;
        continue;
      case BEFORE_VALUE:
        if (code === 62 /* > */) return { end: i + 1, count, selfClosing };
        if (space) {
          i += 1;
          continue;
        }
        if (code === 34) {
          state = VALUE_DQ;
          i += 1; // consume the opening quote; the closing one ends the state
          continue;
        }
        if (code === 39) {
          state = VALUE_SQ;
          i += 1;
          continue;
        }
        state = VALUE_UNQUOTED;
        continue; // reconsume the first value character
      case VALUE_DQ:
        if (code === 34) state = AFTER_QUOTED;
        i += 1; // a `>` inside a quoted value is value text, not the end of the tag
        continue;
      case VALUE_SQ:
        if (code === 39) state = AFTER_QUOTED;
        i += 1;
        continue;
      case VALUE_UNQUOTED:
        if (code === 62 /* > */) return { end: i + 1, count, selfClosing };
        // whitespace ends the value; `/`, `=`, `<` and backtick are value characters
        if (space) state = BEFORE_ATTR;
        i += 1;
        continue;
      case AFTER_QUOTED:
        if (code === 62 /* > */) return { end: i + 1, count, selfClosing };
        if (space) {
          state = BEFORE_ATTR;
          i += 1;
          continue;
        }
        if (code === 47) {
          state = SELF_CLOSING;
          i += 1;
          continue;
        }
        if (code === 61 /* = */) {
          countAttr(); // reconsumed as the first character of a new attribute name
          state = ATTR_NAME;
          i += 1;
          continue;
        }
        state = BEFORE_ATTR;
        continue; // reconsume: any other character starts the next attribute
    }
  }
  return { end: at, count, selfClosing };
}

// Content-model scan. The tokenizer only falls into RCDATA/RAWTEXT/script data when the
// tree builder is processing plain HTML; the scan mirrors the contexts that change that
// decision, because skipping content that parse5 tokenizes is the only way to
// under-count, and an under-count is a bypass:
//   - inside `<svg>`/`<math>` the tokenizer never switches (SVG `<title>`/`<style>` stay
//     markup — an `<svg><style>` interior is parsed, so its attributes are real), except
//     at integration points, and comments are still comments. Nested `svg`/`math` open
//     contexts at any depth, every other minted foreign element sits on the tracked
//     stack, and only a matching end tag pops through it, like parse5's walk-up pop.
//     Start tags in the exits list (`<div>` and friends, `</p>`, `</br>`) would break
//     out only down to an HTML element or an integration point, so this scan never
//     leaves foreign content on them: staying in markup mode can only over-count;
//   - inside an open `<select>` parse5 ignores style/title/… (still data) but processes
//     script and a reprocessed textarea through their plain rules, so NO switch is made
//     and comment opens are not trusted there either. Walking everything in that zone can
//     only over-count;
//   - from the first `<frameset>` to the end of input only `<noframes>` switches.
// Plain data switches to RCDATA on `<title>`/`<textarea>`, to RAWTEXT on `<style>`,
// `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<noscript>`, and to script data on
// `<script>` (the `<!-- → <script → </script → -->` double-escape dance included). On
// `<plaintext>` everything after is text, forever.
function guardAttributes(html: string): void {
  let total = 0;
  const at = html.length;
  let i = 0;
  const foreign: string[] = []; // open `<svg>`/`<math>` contexts, innermost last
  let inSelect = false;
  let inFrameset = false; // `<frameset>` has no close that returns to markup
  while (i < at) {
    if (html.charCodeAt(i) !== 60 /* < */) {
      i += 1;
      continue;
    }
    const open = html.charCodeAt(i + 1);
    if (open === 33 /* ! */) {
      if (html.startsWith('<!--', i) && !inSelect) {
        i = commentEnd(html, i + 4);
      } else {
        // doctype, CDATA and the rest are bogus comments that end at the first `>`; in
        // foreign content parse5 may make this a CDATA text section instead, but text
        // never mints attributes, so an earlier cut only risks over-counting
        const cut = html.indexOf('>', i + 2);
        i = cut === -1 ? at : cut + 1;
      }
      continue;
    }
    if (open === 63 /* ? */) {
      // processing-instruction state is a bogus comment that ends at the first `>`
      const cut = html.indexOf('>', i + 2);
      i = cut === -1 ? at : cut + 1;
      continue;
    }
    if (open === 47 /* / */) {
      if (isAsciiAlpha(html.charCodeAt(i + 2))) {
        // an end tag carries attributes that parse5 tokenizes before dropping them,
        // so they cost real time and are counted like start-tag attributes
        let nameEnd = i + 2;
        while (nameEnd < at && isAsciiAlpha(html.charCodeAt(nameEnd))) nameEnd += 1;
        const name = html.slice(i + 2, nameEnd).toLowerCase();
        if (foreign.length > 0) {
          // parse5's foreign end tag walks down the open-element stack and pops the
          // first tag that matches, together with everything above it. Names with no
          // match, and `</p>`/`</br>` (parse5 pops to the HTML boundary first), leave
          // the context open in this scan — staying in markup mode can only
          // over-count.
          for (let k = foreign.length - 1; k >= 0; k -= 1) {
            if (foreign[k] === name) {
              foreign.length = k;
              break;
            }
          }
        }
        if (name === 'select') inSelect = false;
        const walked = walkTag(html, at, nameEnd);
        i = walked.end;
        total += walked.count;
      } else {
        // `</>` and `</3` are bogus comments that end at the first `>`
        const cut = html.indexOf('>', i + 2);
        i = cut === -1 ? at : cut + 1;
      }
      if (total > MAX_ATTRIBUTES_TOTAL) throw new SanitizeTooManyAttributesError();
      continue;
    }
    if (!isAsciiAlpha(open)) {
      // `<` followed by anything but a name character is text
      i += 1;
      continue;
    }
    let nameEnd = i + 1;
    while (nameEnd < at && isAsciiAlpha(html.charCodeAt(nameEnd))) nameEnd += 1;
    const name = html.slice(i + 1, nameEnd).toLowerCase();
    const walked = walkTag(html, at, nameEnd);
    i = walked.end;
    total += walked.count;
    if (total > MAX_ATTRIBUTES_TOTAL) throw new SanitizeTooManyAttributesError();
    if (i === at) break; // unterminated tag: parse5 emits nothing after it either
    if (!inSelect && !inFrameset) {
      if (name === 'svg' || name === 'math') {
        // nested svg/math open real foreign contexts at any depth; a self-closing
        // one is appended and closed at once, like parse5's own stack handling
        if (!walked.selfClosing) foreign.push(name);
      } else if (
        foreign.length > 0 && !HTML_FOREIGN_EXITS.has(name) && !walked.selfClosing
      ) {
        // any other start tag inside foreign content mints a foreign element that
        // sits on the open-element stack, so an end tag may pop through it. Start
        // tags in the exits list would break out only down to an HTML element or an
        // integration point; parse5 may keep the whole context either way, so this
        // scan never leaves foreign content on them and counts what follows as
        // markup — the over-count-only direction.
        foreign.push(name);
      }
      if (foreign.length === 0) {
        if (name === 'select') inSelect = true;
        else if (name === 'frameset') inFrameset = true;
      }
    }
    if (inSelect || inFrameset || foreign.length > 0) continue; // content stays markup
    // plain data only: switch the scan into the element's special content
    if (name === 'script') {
      const ended = scriptContentEnd(html, at, i);
      i = ended.end;
      total += ended.count;
      if (total > MAX_ATTRIBUTES_TOTAL) throw new SanitizeTooManyAttributesError();
      continue;
    }
    if (name === 'plaintext') break; // the rest of the document is text
    if (
      name === 'title' || name === 'textarea' || name === 'style' || name === 'xmp'
      || name === 'iframe' || name === 'noembed' || name === 'noframes' || name === 'noscript'
    ) {
      const ended = rawContentEnd(html, at, i, name);
      i = ended.end;
      total += ended.count;
      if (total > MAX_ATTRIBUTES_TOTAL) throw new SanitizeTooManyAttributesError();
      continue;
    }
  }
}

// Start tags in this set break out of foreign content in parse5 (the `causesExit`
// list) — down to the first HTML element or integration point. This scan never leaves
// foreign content on them: when an integration point blocks the break, parse5 keeps
// counting markup inside the context, and when the break reaches the boundary the
// scan can only over-count by staying in markup mode. (`<font color|size|face>`
// also breaks out in parse5; ignoring it here keeps the zone open, over-count only.)
const HTML_FOREIGN_EXITS = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em',
  'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing',
  'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike',
  'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);

// RCDATA/RAWTEXT interior: text until the FIRST `</name` (ASCII case-insensitive) that the
// special-end-tag machinery accepts — name followed by whitespace, `/` or `>`. With a
// whitespace or `/` terminator that `</name ...>` becomes an end tag token whose
// attributes parse5 tokenizes (and the tree drops), so walkTag counts them into the
// document total.
function rawContentEnd(
  html: string,
  at: number,
  from: number,
  name: string,
): { end: number; count: number } {
  let i = from;
  while (i < at) {
    const lt = html.indexOf('</', i);
    if (lt === -1) return { end: at, count: 0 };
    let j = lt + 2;
    let k = 0;
    while (j < at && k < name.length && (html.charCodeAt(j) | 32) === name.charCodeAt(k)) {
      j += 1;
      k += 1;
    }
    if (k < name.length) {
      i = lt + 1; // the `</` and what follows is text; the next match can start later
      continue;
    }
    const code = j < at ? html.charCodeAt(j) : -1;
    if (isSpace(code)) {
      const walked = walkTag(html, at, j, BEFORE_ATTR);
      return { end: walked.end, count: walked.count }; // unterminated runs to EOF like parse5
    }
    if (code === 47 /* / */) {
      const walked = walkTag(html, at, j, SELF_CLOSING);
      return { end: walked.end, count: walked.count };
    }
    if (code === 62 /* > */) return { end: j + 1, count: 0 };
    i = j; // `</titlex` and friends are text; a later `</name` may still close
  }
  return { end: at, count: 0 };
}

const SC_NONE = 0; // script data
const SC_ESCAPE_START = 1; // saw `<!`, deciding on `-`
const SC_ESCAPE_DASH = 2; // saw `<!-`, deciding on the second `-`
const SC_ESCAPED = 3; // between `<!--` and the dance exit
const SC_ESCAPED_DASH = 4;
const SC_ESCAPED_DASH_DASH = 5;
const SC_DOUBLE_ESCAPED = 6; // after `<script` inside the escaped section
const SC_DOUBLE_ESCAPED_DASH = 7;
const SC_DOUBLE_ESCAPED_DASH_DASH = 8;
const SC_DOUBLE_END = 9; // saw `</` in double-escaped, deciding on `script`

// Script data including the escape dance, mirroring the tokenizer state for state:
// `<!--` from plain script data starts the escaped text, `<script` (letters followed by
// whitespace, `/` or `>`) starts double-escaping it, and `</script` inside double-escaped
// text only steps the dance back to escaped text; the element itself ends at the first
// `</script` in plain or escaped script data, whose end tag's attributes parse5
// tokenizes and this scan walks. Every success transition also consumes the terminator
// character, exactly like parse5's consume loops, and every failure path resumes where
// parse5 "reconsumes" (at the just-read character), so the scan can only ever stop at
// the tokenizer's real close — a late exit, the only under-counting direction, cannot
// happen.
function scriptContentEnd(html: string, at: number, from: number): { end: number; count: number } {
  let mode = SC_NONE;
  let i = from;
  while (i < at) {
    const code = html.charCodeAt(i);
    switch (mode) {
      case SC_NONE: { // script data
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1); // read by the less-than state
          if (next === 47 /* / */) {
            const ended = scriptEndTag(html, at, i + 2);
            if (ended) {
              i = ended.end;
              return { end: i, count: ended.count };
            }
            i += 2; // unmatched `</x`: text, resumed at the char after `/`
            continue;
          }
          if (next === 33 /* ! */) {
            mode = SC_ESCAPE_START;
            i += 2;
            continue;
          }
          i += 1; // `<` + anything else is text, reconsumed in script data
          continue;
        }
        i += 1;
        continue;
      }
      case SC_ESCAPE_START: { // after `<!`
        if (code === 45 /* - */) {
          mode = SC_ESCAPE_DASH;
          i += 1;
        } else {
          mode = SC_NONE; // not a comment: plain script data again, reconsume
        }
        continue;
      }
      case SC_ESCAPE_DASH: { // after `<!-`
        if (code === 45 /* - */) {
          mode = SC_ESCAPED_DASH_DASH;
          i += 1;
        } else {
          mode = SC_NONE; // reconsume in plain script data
        }
        continue;
      }
      case SC_ESCAPED: {
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1);
          if (next === 47 /* / */) {
            const ended = scriptEndTag(html, at, i + 2);
            if (ended) return ended; // the element closes in escaped text too
            mode = SC_ESCAPED;
            i += 2;
            continue;
          }
          if (isAsciiAlpha(next)) {
            const matched = startsScript(html, at, i + 1);
            if (matched !== -1) {
              mode = SC_DOUBLE_ESCAPED;
              i = matched + 1; // `script` + terminator are all consumed
              continue;
            }
          }
          mode = SC_ESCAPED;
          i += 1; // not `<script`: text, the char after `<` is reconsumed
          continue;
        }
        if (code === 45 /* - */) {
          mode = SC_ESCAPED_DASH;
        }
        i += 1;
        continue;
      }
      case SC_ESCAPED_DASH: {
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1);
          if (next === 47 /* / */) {
            const ended = scriptEndTag(html, at, i + 2);
            if (ended) return ended;
            mode = SC_ESCAPED;
            i += 2;
            continue;
          }
          if (isAsciiAlpha(next)) {
            const matched = startsScript(html, at, i + 1);
            if (matched !== -1) {
              mode = SC_DOUBLE_ESCAPED;
              i = matched + 1;
              continue;
            }
          }
          mode = SC_ESCAPED;
          i += 1;
          continue;
        }
        mode = code === 45 /* - */ ? SC_ESCAPED_DASH_DASH : SC_ESCAPED;
        i += 1;
        continue;
      }
      case SC_ESCAPED_DASH_DASH: {
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1);
          if (next === 47 /* / */) {
            const ended = scriptEndTag(html, at, i + 2);
            if (ended) return ended;
            mode = SC_ESCAPED;
            i += 2;
            continue;
          }
          if (isAsciiAlpha(next)) {
            const matched = startsScript(html, at, i + 1);
            if (matched !== -1) {
              mode = SC_DOUBLE_ESCAPED;
              i = matched + 1;
              continue;
            }
          }
          mode = SC_ESCAPED;
          i += 1;
          continue;
        }
        if (code === 62 /* > */) {
          mode = SC_NONE; // `--…>` ends the escape, back to script data
        } else if (code !== 45 /* - */) {
          mode = SC_ESCAPED;
        }
        i += 1;
        continue;
      }
      case SC_DOUBLE_ESCAPED: {
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1);
          if (next === 47 /* / */) {
            mode = SC_DOUBLE_END;
            i += 2;
            continue;
          }
          mode = SC_DOUBLE_ESCAPED;
          i += 1; // `<` + not `/` is text, the char is reconsumed here
          continue;
        }
        if (code === 45 /* - */) {
          mode = SC_DOUBLE_ESCAPED_DASH;
        }
        i += 1;
        continue;
      }
      case SC_DOUBLE_ESCAPED_DASH: {
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1);
          if (next === 47 /* / */) {
            mode = SC_DOUBLE_END;
            i += 2;
            continue;
          }
          mode = SC_DOUBLE_ESCAPED;
          i += 1;
          continue;
        }
        mode = code === 45 /* - */ ? SC_DOUBLE_ESCAPED_DASH_DASH : SC_DOUBLE_ESCAPED;
        i += 1;
        continue;
      }
      case SC_DOUBLE_ESCAPED_DASH_DASH: {
        if (code === 60 /* < */) {
          const next = html.charCodeAt(i + 1);
          if (next === 47 /* / */) {
            mode = SC_DOUBLE_END;
            i += 2;
            continue;
          }
          mode = SC_DOUBLE_ESCAPED;
          i += 1;
          continue;
        }
        if (code === 62 /* > */) {
          mode = SC_NONE; // `--…>` leaves the double escape for script data
        } else if (code !== 45 /* - */) {
          mode = SC_DOUBLE_ESCAPED;
        }
        i += 1;
        continue;
      }
      case SC_DOUBLE_END: { // after `</` inside double-escaped text
        const matched = startsScript(html, at, i);
        if (matched !== -1) {
          mode = SC_ESCAPED; // the dance steps back; the element stays open
          i = matched + 1; // `script` + terminator are all consumed
          continue;
        }
        mode = SC_DOUBLE_ESCAPED; // not `</script`: reconsume this character
        continue;
      }
    }
  }
  return { end: at, count: 0 };
}

// The `</script` matcher inside plain/escaped script data. Returns the index after the
// matching end tag and the end tag's attribute count (parse5 tokenizes those attributes
// before dropping them) when the name is followed by whitespace, `/` or `>`, and null
// when the sequence is text instead.
function scriptEndTag(html: string, at: number, i: number): { end: number; count: number } | null {
  let j = i;
  let k = 0;
  while (j < at && k < 6 && (html.charCodeAt(j) | 32) === 'script'.charCodeAt(k)) {
    j += 1;
    k += 1;
  }
  if (k < 6) return null;
  const code = j < at ? html.charCodeAt(j) : -1;
  if (isSpace(code)) {
    const walked = walkTag(html, at, j, BEFORE_ATTR);
    return { end: walked.end, count: walked.count };
  }
  if (code === 47) {
    const walked = walkTag(html, at, j, SELF_CLOSING);
    return { end: walked.end, count: walked.count };
  }
  if (code === 62) return { end: j + 1, count: 0 };
  return null;
}

// `<script` (case-insensitive) whose buildout hits the double-escape terminator set.
// Returns the index after the whole `script` run, or -1.
function startsScript(html: string, at: number, i: number): number {
  let j = i;
  let k = 0;
  while (j < at && k < 6 && (html.charCodeAt(j) | 32) === 'script'.charCodeAt(k)) {
    j += 1;
    k += 1;
  }
  if (k < 6) return -1;
  const code = j < at ? html.charCodeAt(j) : -1;
  return isSpace(code) || code === 47 || code === 62 ? j : -1;
}

const ALLOWED_HTML = new Set<string>([
  'html', 'head', 'body', 'title', 'meta', 'style',
  'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'span', 'p', 'br', 'hr', 'wbr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'blockquote', 'q', 'cite', 'pre', 'code', 'kbd', 'samp', 'var',
  'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'abbr', 'time', 'address',
  'details', 'summary', 'img',
]);

const REMOVED_HTML = new Set<string>([
  'script', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'noframes', 'object', 'embed', 'applet',
  'param', 'base', 'link', 'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist',
  'output', 'dialog', 'video', 'audio', 'source', 'track', 'picture', 'canvas', 'map', 'area', 'slot',
  'portal', 'fencedframe', 'xmp', 'plaintext', 'listing',
]);

const ALLOWED_SVG = new Set<string>([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'style',
]);

const GLOBAL_ATTRS = new Set<string>(['class', 'id', 'title', 'lang', 'dir', 'role', 'style', 'width', 'height']);

const SVG_ATTRS = new Set<string>([
  'viewbox', 'preserveaspectratio', 'xmlns', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'fx', 'fy', 'pathlength',
]);

const ELEMENT_ATTRS: ReadonlyMap<string, readonly string[]> = new Map([
  ['img', ['alt', 'src']],
  ['meta', ['charset', 'name', 'content']],
  ['time', ['datetime']],
  ['details', ['open']],
  ['ol', ['start', 'reversed']],
  ['col', ['span']],
  ['colgroup', ['span']],
  ['td', ['colspan', 'rowspan', 'headers', 'abbr']],
  ['th', ['colspan', 'rowspan', 'headers', 'abbr', 'scope']],
]);

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
const DATA_IMAGE_PROBE = /^data:image\/(png|jpeg|gif|webp|avif)[;,]/;

export class SanitizeTooDeepError extends Error {
  readonly code = 'too_deep';

  constructor() {
    super('plan nests elements too deeply');
  }
}

export interface SanitizeResult {
  readonly html: string;
  readonly removed: Record<string, number>;
}

interface Walk {
  removed: Map<string, number>;
  depth: number;
}

export function sanitize(input: string): SanitizeResult {
  guardAttributes(input);
  const document = parse(input) as unknown as Document;
  const walk: Walk = { removed: new Map<string, number>(), depth: 0 };
  document.childNodes = cleanList(walk, document.childNodes);
  adopt(document as unknown as Node);
  ensureBody(document);
  return {
    html: `<!DOCTYPE html>\n${serialize(document as unknown as import('parse5').DefaultTreeAdapterMap['document'])}`,
    removed: Object.fromEntries(walk.removed),
  };
}

function note(walk: Walk, label: string): void {
  walk.removed.set(label, (walk.removed.get(label) ?? 0) + 1);
}

function cleanList(walk: Walk, nodes: Node[]): Node[] {
  walk.depth += 1;
  if (walk.depth > MAX_DEPTH) throw new SanitizeTooDeepError();
  try {
    return nodes.flatMap((node) => cleanNode(walk, node));
  } finally {
    walk.depth -= 1;
  }
}

function cleanNode(walk: Walk, node: Node): Node[] {
  if (node.nodeName === '#text') return [node];
  if (!node.tagName) return [];
  const tag = node.tagName.toLowerCase();
  if (node.namespaceURI === HTML_NS) {
    if (REMOVED_HTML.has(tag)) {
      note(walk, `<${tag}>`);
      return [];
    }
    if (!ALLOWED_HTML.has(tag)) {
      note(walk, tag === 'a' ? 'link <a>' : `<${tag}>`);
      return cleanList(walk, node.childNodes);
    }
    return keep(walk, node, tag, false);
  }
  if (node.namespaceURI === SVG_NS) {
    if (tag === 'a') {
      note(walk, 'link <a>');
      return cleanList(walk, node.childNodes);
    }
    if (!ALLOWED_SVG.has(tag)) {
      note(walk, `<svg ${tag}>`);
      return [];
    }
    return keep(walk, node, tag, true);
  }
  note(walk, `<${tag}>`);
  return [];
}

function keep(walk: Walk, node: Node, tag: string, isSvg: boolean): Node[] {
  if (!isSvg && tag === 'meta' && !metaAllowed(node)) {
    note(walk, metaLabel(node));
    return [];
  }
  node.attrs = cleanAttrs(walk, node, tag, isSvg);
  if (!isSvg && tag === 'img' && !(node.attrs ?? []).some((attr) => attr.name === 'src')) {
    note(walk, '<img> without an embedded image');
    return [];
  }
  if (tag === 'style') {
    const css = node.childNodes.map((child) => (child.nodeName === '#text' ? child.value ?? '' : '')).join('');
    const reason = checkCss(css);
    if (reason) {
      note(walk, `<style>: ${reason}`);
      return [];
    }
    node.childNodes = css ? [textNode(css, node)] : [];
    return [node];
  }
  node.childNodes = cleanList(walk, node.childNodes);
  adopt(node);
  return [node];
}

function cleanAttrs(walk: Walk, node: Node, tag: string, isSvg: boolean): Attribute[] {
  const kept: Attribute[] = [];
  for (const attr of node.attrs ?? []) {
    const name = (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name).toLowerCase();
    if (name.startsWith('on')) {
      note(walk, `event handler ${name}`);
      continue;
    }
    if (!attributeAllowed(name, tag, isSvg)) {
      note(walk, `attribute ${name}`);
      continue;
    }
    if (name === 'src') {
      if (DATA_IMAGE.test(attr.value.trim())) kept.push(attr);
      else note(walk, 'image src that is not an embedded image');
      continue;
    }
    const reason = name === 'style' ? checkCss(attr.value) : checkValue(attr.value);
    if (reason) {
      note(walk, `${name} attribute: ${reason}`);
      continue;
    }
    kept.push(attr);
  }
  return kept;
}

export function checkCss(css: string): string | null {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return 'invalid CSS';
  }
  let reason: string | null = null;
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'import') reason = 'unsafe CSS';
    else if (name === 'font-face') reason = 'URL font';
    else if (!['media', 'supports', 'keyframes', '-webkit-keyframes', 'charset', 'layer'].includes(name)) {
      reason = `unsupported @${name}`;
    }
  });
  root.walkDecls((decl) => {
    if (reason) return;
    const value = decl.value.toLowerCase();
    if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/.test(value)) reason = 'unsafe CSS';
    const urls = [...value.matchAll(/url\s*\(\s*(["']?)([^"')]*)\1\s*\)/g)];
    for (const match of urls) {
      const target = (match[2] ?? '').trim();
      if (!target.startsWith('#') && !DATA_IMAGE_PROBE.test(target)) reason = 'external URL';
    }
  });
  return reason;
}

function checkValue(value: string): string | null {
  const probe = probeOf(value);
  // Browsers drop ASCII tabs, newlines and control characters from a URL scheme, so
  // "jav\tascript:" runs as javascript:. Compare with all of them removed.
  const compact = probe.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/javascript:|vbscript:/.test(compact)) return 'script URL';
  return urlsAreFragments(probe) ? null : 'external URL';
}

function urlsAreFragments(probe: string): boolean {
  const calls = (probe.match(/url\s*\(/g) ?? []).length;
  const args = [...probe.matchAll(/url\s*\(\s*(["']?)([^"')]*)\1\s*\)/g)];
  return args.length === calls && args.every((match) => {
    const target = (match[2] ?? '').trim();
    return target.startsWith('#') || DATA_IMAGE_PROBE.test(target);
  });
}

function probeOf(text: string): string {
  return decodeCssEscapes(text).toLowerCase();
}

function decodeCssEscapes(text: string): string {
  return text
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_match, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)))
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1')
    .replace(/\\[\r\n\f]/g, '');
}

function attributeAllowed(name: string, tag: string, isSvg: boolean): boolean {
  if (name.startsWith('aria-')) return true;
  if (GLOBAL_ATTRS.has(name)) return true;
  if (isSvg) return SVG_ATTRS.has(name);
  return (ELEMENT_ATTRS.get(tag) ?? []).includes(name);
}

function metaAttrs(node: Node): Map<string, string> {
  return new Map((node.attrs ?? []).map((attr) => [attr.name.toLowerCase(), attr.value]));
}

function metaAllowed(node: Node): boolean {
  const attrs = metaAttrs(node);
  if (attrs.has('http-equiv')) return false;
  if (attrs.has('charset')) return true;
  return ['viewport', 'description', 'color-scheme'].includes((attrs.get('name') ?? '').toLowerCase())
    && attrs.has('content');
}

function metaLabel(node: Node): string {
  const attrs = metaAttrs(node);
  if (attrs.has('http-equiv')) return `meta http-equiv=${(attrs.get('http-equiv') ?? '').toLowerCase()}`;
  if (attrs.has('name')) return `meta name=${(attrs.get('name') ?? '').toLowerCase()}`;
  return '<meta>';
}

function textNode(value: string, parent: Node): Node {
  return { nodeName: '#text', value, childNodes: [], parentNode: parent };
}

function adopt(node: Node): void {
  for (const child of node.childNodes) child.parentNode = node;
}

// A document that came in as a frameset has no body. Add an empty one so a second pass leaves it alone.
function ensureBody(document: Document): void {
  const html = document.childNodes.find((node) => node.tagName === 'html');
  if (!html) return;
  if (html.childNodes.some((node) => node.tagName === 'body')) return;
  html.childNodes.push({
    nodeName: 'body',
    tagName: 'body',
    namespaceURI: HTML_NS,
    attrs: [],
    childNodes: [],
    parentNode: html,
  });
}

