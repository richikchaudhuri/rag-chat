"""
generate.py — the "G" in RAG: turn retrieved chunks + a question into a
grounded, cited answer.

  build a STRICT prompt (chunks + "answer ONLY from these; else say you don't
  know; cite the source")  ->  Gemini writes the answer

Separate from retrieve.py so each module does one job, and so Phase 2 can stream
generation on its own.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.gemini import generate, generate_stream

# The exact sentence the model must use when the answer isn't in the context.
# Defined once so the API and the eval harness can detect a clean abstention.
NOT_FOUND = "I couldn't find that in the document."


def build_prompt(question: str, hits: list[dict]) -> str:
    """Put the retrieved chunks + strict rules into one prompt.

    These rules are the whole game: answer ONLY from the context, and admit when
    the answer isn't there. This is what stops the model from making things up.

    The NOT_FOUND sentence is reserved for a TOTAL miss (nothing in the context
    answers the question) and must be the START of the reply, so is_abstention()
    and the eval harness can detect it; it is then followed by one grounded
    sentence naming what the context DOES cover. A merely PARTIAL gap (e.g. a
    compound question where one part is answerable) is described in the model's
    own words instead — so a good answer never gets a contradictory "I couldn't
    find that" stapled onto the end.
    """
    context = "\n\n".join(
        f"[{i + 1}] (source: {h['source']} p.{h['page']})\n{h['text']}"
        for i, h in enumerate(hits)
    )
    return (
        "You are a precise assistant. Answer the QUESTION using ONLY the CONTEXT below.\n"
        "Follow these rules exactly:\n"
        "- If the CONTEXT answers the question, even partially, give that answer and cite "
        "each fact like [source p.X]. If some part of the question is not covered by the "
        "CONTEXT, add one brief clause saying so in your own words — do NOT use the exact "
        "sentence from the next rule for a merely partial gap.\n"
        f'- ONLY if the CONTEXT contains nothing that answers the question, reply with '
        f'exactly "{NOT_FOUND}" and then one short sentence naming the topics the CONTEXT '
        "does cover, so the user can rephrase.\n"
        "Never guess or use outside knowledge.\n\n"
        f"CONTEXT:\n{context}\n\n"
        f"QUESTION: {question}\n\nANSWER:"
    )


def is_abstention(answer_text: str) -> bool:
    """True when the model abstained (the answer wasn't in the document).

    Detection contract: a grounded refusal ALWAYS begins with the exact NOT_FOUND
    sentence, even when a helpful redirect sentence follows it. The eval harness
    (Phase 4) and the UI rely on this to tell 'answered' from 'abstained'."""
    return answer_text.lstrip().startswith(NOT_FOUND)


def answer(question: str, hits: list[dict]) -> str:
    """Generate the grounded answer for a question and its retrieved chunks.

    No hits at all -> nothing to ground on, so we abstain without calling the
    model (saves a request and can't hallucinate)."""
    if not hits:
        return NOT_FOUND
    return (generate(build_prompt(question, hits)) or "").strip()


def answer_stream(question: str, hits: list[dict]):
    """Streaming twin of answer(): yield the grounded answer in text deltas.

    Used by the SSE /chat endpoint so the browser renders the answer as it is
    written. Same grounding + same abstention rule; no hits -> emit the refusal
    once without calling the model."""
    if not hits:
        yield NOT_FOUND
        return
    yield from generate_stream(build_prompt(question, hits))


def build_summary_prompt(question: str, hits: list[dict], doc_label: str) -> str:
    """Prompt for SYNTHESIS (summary / study guide) — the opposite job from
    build_prompt's extractive QA.

    Extractive QA finds one fact and refuses if it's absent. Synthesis READS
    across all the supplied material and organises the most important points.
    It is still grounded — "use ONLY this material, add nothing" stops it from
    inventing facts — but it is allowed to summarise and prioritise. That is
    exactly what "what are the key points / what may come in the exam" needs,
    and exactly what strict extractive QA wrongly refuses.
    """
    material = "\n\n".join(f"[p.{h['page']}] {h['text']}" for h in hits)
    return (
        "You are a study assistant helping a student revise. Using ONLY the "
        "MATERIAL below, write a clear, well-organised summary of the most "
        "important points the student should understand — the kind most likely "
        "to be tested in an exam. Group related points under short headings, keep "
        "each point concise, and cite the page like [p.X]. Do NOT add facts that "
        "are not in the MATERIAL.\n\n"
        f"MATERIAL (from {doc_label}):\n{material}\n\n"
        f"STUDENT'S REQUEST: {question}\n\nSTUDY SUMMARY:"
    )


def summarize_stream(question: str, hits: list[dict], doc_label: str = "the document"):
    """Streaming grounded synthesis (summary / study guide).

    Unlike answer_stream, it does NOT abstain when no single chunk states the
    answer — summarising the supplied material is always possible — but it still
    uses ONLY that material, so it cannot hallucinate outside the document."""
    if not hits:
        yield NOT_FOUND
        return
    yield from generate_stream(build_summary_prompt(question, hits, doc_label))
