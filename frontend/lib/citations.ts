/**
 * citations.ts — pure logic for turning the model's inline citation text into
 * structured, clickable segments. No React here (kept testable + framework-free).
 *
 * The backend prompts the model to cite as `[source p.X]` (QA mode) or `[p.X]`
 * (summary mode). We split an answer into TEXT and CITE segments so the renderer
 * can drop a clickable pill exactly where each citation appears.
 */

export interface TextSegment {
  type: "text";
  value: string;
}
export interface CiteSegment {
  type: "cite";
  raw: string; // the exact "[...]" matched, in case we want to show it verbatim
  source: string | null; // filename if present (QA), else null (summary's [p.X])
  page: number; // first page if a range/list was given
}
export type Segment = TextSegment | CiteSegment;

// [GeoAI.pdf p.5]  ·  [p.12]  ·  [source p. 3]  ·  [p.5-6] / [p.5, 7] (first page kept)
// The source group is non-greedy so ".pdf" (which contains a "p") doesn't get
// mistaken for the "p." marker — the engine backtracks to the real "p.<digits>".
const CITE_RE = /\[\s*([^\]]*?)p\.?\s*(\d+)(?:\s*[-–,]\s*\d+)*\s*\]/gi;

/** Strip a trailing separator/space left on a captured source label. */
function cleanSource(raw: string): string | null {
  const s = raw.replace(/[·,:;|–-]?\s*$/, "").trim();
  return s.length ? s : null;
}

export function splitCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({
      type: "cite",
      raw: m[0],
      source: cleanSource(m[1]),
      page: parseInt(m[2], 10),
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Display label without the file extension (e.g. "GeoAI_Handbook"). */
export function sourceLabel(source: string): string {
  return source.replace(/\.(pdf|txt)$/i, "");
}

/** Which retrieved chunk a citation points at — used to highlight + scroll the
 *  glass-box. Always require the page to match; match the source loosely (the
 *  model's label may be a shortened/variant form of the stored filename). */
export function citeMatchesChunk(
  cite: { source: string | null; page: number },
  chunk: { source: string; page: number },
): boolean {
  if (cite.page !== chunk.page) return false;
  if (!cite.source) return true; // page-only citation
  const a = cite.source.toLowerCase();
  const b = chunk.source.toLowerCase();
  const bLabel = sourceLabel(b);
  return b.includes(a) || a.includes(bLabel) || bLabel.includes(a);
}

/** Equality for the "currently active" citation (highlights the clicked pill). */
export function citeEquals(
  a: { source: string | null; page: number } | null,
  b: { source: string | null; page: number } | null,
): boolean {
  if (!a || !b) return false;
  return a.page === b.page && (a.source ?? "") === (b.source ?? "");
}
