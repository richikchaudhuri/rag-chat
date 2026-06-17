/**
 * intent.ts — a tiny, dependency-free heuristic for spotting "study / synthesis"
 * questions (e.g. "what are the key exam topics?").
 *
 * Strict extractive QA is built to REFUSE these (they ask the model to organise
 * and prioritise, not to quote a fact), while Summarise mode is built to answer
 * them. We use this to nudge the user toward the right mode instead of leaving
 * them at a dead end. It's the lightweight seed of intent-aware routing (the
 * future "conversational query-rewriting" differentiator).
 */

const STUDY_RE =
  /\b(exams?|revis(?:e|ing|ion)|key points?|important (?:points?|topics?|concepts?)|summar(?:y|ise|ize|ies)|study|cheat\s?sheet|take[- ]?aways?|overview|outline)\b/i;

export function looksLikeStudyRequest(text: string | undefined): boolean {
  return !!text && STUDY_RE.test(text);
}
