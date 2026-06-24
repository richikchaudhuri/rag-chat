"""
gemini.py — the ONE place the app talks to Google Gemini.

Everything else imports these helpers and never touches the SDK directly.
If Google ever changes the SDK, we fix it here and nowhere else.

  embed_texts(texts, task_type) -> vectors  (text -> meaning-numbers)
  generate(prompt)   -> str       (the model writes an answer)
  count_tokens(text) -> int       (measure size in real Gemini tokens)
"""

import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

# This file is backend/app/gemini.py, so backend/.env is two levels up.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Lazily-created shared client. Deferring creation until first use means a missing
# GEMINI_API_KEY does NOT crash the whole app at import (e.g. on a fresh deploy
# before the secret is set) — only the first call that needs Gemini fails, with a
# clear message, while the rest of the app (UI, retrieval plumbing) still starts.
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to backend/.env locally, or as a "
                "Hugging Face Space secret named GEMINI_API_KEY."
            )
        _client = genai.Client(api_key=key)
    return _client

GEN_MODEL = "gemini-2.0-flash"      # the "brain" that writes answers
EMB_MODEL = "gemini-embedding-001"  # turns text into meaning-vectors


def _retry_seconds(err: Exception, default: float = 40.0) -> float:
    """Read the 'retry in Xs' hint Gemini sends on a 429, else use a default."""
    match = re.search(r"retry in ([0-9.]+)s", str(err))
    return float(match.group(1)) + 2 if match else default


def describe_error(err: Exception) -> str:
    """Turn a Gemini SDK exception into a short, user-facing message.

    The /chat stream uses this to surface a clean reason (instead of crashing the
    connection) when generation fails — most often a free-tier rate limit."""
    code = getattr(err, "code", None)
    if code == 429:
        if "PerDay" in str(err) or "per day" in str(err).lower():
            return (
                "Gemini's free-tier DAILY generation limit (20 requests/day on this "
                "model) is used up. It resets around midnight Pacific — or switch the "
                "generation model / add a paid API key."
            )
        wait = _retry_seconds(err)
        return (
            "Gemini's per-minute rate limit was hit. Please wait about "
            f"{int(wait)}s and try again."
        )
    if code in (500, 503):
        return "Gemini is temporarily unavailable — please try again in a moment."
    return "The model service returned an error while generating. Please try again."


def embed_texts(
    texts: list[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
    batch_size: int = 32,
    max_retries: int = 8,
) -> list[list[float]]:
    """Embed many strings (in small batches) -> one vector per input string.

    task_type tells Gemini HOW the text will be used, so it can shape the vector
    for that job. We use two values:
      RETRIEVAL_DOCUMENT — for the chunks we store (the "haystack").
      RETRIEVAL_QUERY    — for the user's question (the "needle").
    Embedding both sides with the matching task_type pulls a question and the
    passage that answers it CLOSER together than generic embeddings would, so
    top-k retrieval ranks the right chunk higher. Same model, same 3072 dims —
    only the vector's direction is tuned. (Both sides must agree, which is why
    re-ingesting after this change matters: see ingest.py.)

    The Gemini FREE TIER caps embedding requests at ~100 per minute. A big PDF
    has more chunks than that, so we (a) batch to cut per-call overhead and
    (b) catch the 429 "rate limit" error, wait the amount Gemini tells us to,
    and resume where we left off. This is the rate-limit mitigation the plan
    calls for — without it, ingesting any real document fails.
    """
    vectors: list[list[float]] = []
    total = len(texts)
    config = types.EmbedContentConfig(task_type=task_type)
    for start in range(0, total, batch_size):
        batch = texts[start : start + batch_size]
        for attempt in range(max_retries):
            try:
                resp = _get_client().models.embed_content(
                    model=EMB_MODEL, contents=batch, config=config
                )
                vectors.extend(e.values for e in resp.embeddings)
                break
            except genai_errors.APIError as err:
                if getattr(err, "code", None) == 429 and attempt < max_retries - 1:
                    wait = _retry_seconds(err)
                    print(
                        f"  [embed] free-tier rate limit at {len(vectors)}/{total} chunks; "
                        f"waiting {wait:.0f}s then resuming ...",
                        flush=True,
                    )
                    time.sleep(wait)
                    continue
                raise
    return vectors


def generate(prompt: str) -> str:
    """Send a prompt to Gemini, return the plain-text answer."""
    return _get_client().models.generate_content(model=GEN_MODEL, contents=prompt).text


def generate_stream(prompt: str):
    """Stream a Gemini answer, yielding text deltas as they are produced.

    Same prompt as generate(), but generate_content_STREAM returns an iterator of
    partial responses instead of one final blob. Streaming is what makes the chat
    feel alive: the browser shows words as the model writes them, instead of
    spinning for several seconds then dumping the whole answer at once. Some
    chunks (e.g. the trailing metadata chunk) carry no text, so we skip those.
    """
    for chunk in _get_client().models.generate_content_stream(model=GEN_MODEL, contents=prompt):
        if chunk.text:
            yield chunk.text


def count_tokens(text: str) -> int:
    """How many Gemini tokens is this text? Used to size chunks correctly."""
    return _get_client().models.count_tokens(model=GEN_MODEL, contents=text).total_tokens
