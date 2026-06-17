"""
run.py — the RAG evaluation harness (the "measure" step).

Runs the gold question set through the REAL retrieval (and optionally
generation) pipeline and reports retrieval quality + answer faithfulness. These
are the numbers behind the project's "baseline -> measure -> improve -> measure"
arc: Phase 4 set the dense baseline; Phase 5 (hybrid + reranking) has to beat it,
and --compare proves it.

Usage (run with the backend venv; the FastAPI server need NOT be running):
  python -m app.eval.run                          dense retrieval metrics (cheap)
  python -m app.eval.run --method hybrid          one method
  python -m app.eval.run --compare dense hybrid rerank   side-by-side table
  python -m app.eval.run --answers                also generate (faithfulness + abstention)
  python -m app.eval.run --json                   machine-readable (used by GET /eval)
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Make the backend package importable whether run as a module or a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.genai import errors as genai_errors

from app.eval import metrics
from app.gemini import _retry_seconds
from app.generate import answer, is_abstention
from app.search import search

GOLD_PATH = Path(__file__).resolve().parent / "gold.json"


def load_gold() -> list[dict]:
    return json.loads(GOLD_PATH.read_text(encoding="utf-8"))


def _answer_with_retry(question: str, hits: list[dict], max_retries: int = 5) -> str:
    """Generate an answer, pausing and resuming on a free-tier 429 (so a long
    --answers run survives the per-minute rate limit instead of crashing)."""
    for attempt in range(max_retries):
        try:
            return answer(question, hits)
        except genai_errors.APIError as err:
            # A DAILY quota 429 ("PerDay") won't clear in seconds — fail fast instead
            # of wasting minutes. A per-minute 429 does clear, so wait and resume.
            is_daily = "PerDay" in str(err) or "per day" in str(err).lower()
            if getattr(err, "code", None) == 429 and not is_daily and attempt < max_retries - 1:
                wait = _retry_seconds(err)
                print(f"  [eval] per-minute rate limit; waiting {wait:.0f}s then resuming ...", flush=True)
                time.sleep(wait)
                continue
            if is_daily:
                print("  [eval] daily free-tier generation quota (20/day) exhausted — stopping.", flush=True)
            raise


def evaluate(
    ks: list[int], with_answers: bool = False, pace: float = 4.0, method: str = "dense"
) -> dict:
    """Run the harness for one retrieval method. Retrieval is scoped to each gold
    item's source document so the measurement is controlled."""
    gold = load_gold()
    answerable = [g for g in gold if g.get("answerable", True)]
    unanswerable = [g for g in gold if not g.get("answerable", True)]
    max_k = max(ks)

    # ---- Retrieval (one query per answerable item) ----
    retrievals = {
        g["id"]: search(g["question"], k=max_k, sources=[g["source"]], method=method)
        for g in answerable
    }

    retrieval: dict[int, dict] = {}
    for k in ks:
        hit = sum(metrics.hit_at_k(retrievals[g["id"]], g, k) for g in answerable)
        prec = sum(metrics.precision_at_k(retrievals[g["id"]], g, k) for g in answerable)
        retrieval[k] = {"hit_rate": hit / len(answerable), "precision": prec / len(answerable)}
    mrr = sum(metrics.reciprocal_rank(retrievals[g["id"]], g) for g in answerable) / len(answerable)

    result: dict = {
        "method": method,
        "n_gold": len(gold),
        "n_answerable": len(answerable),
        "n_unanswerable": len(unanswerable),
        "k_values": ks,
        "retrieval": retrieval,
        "mrr": round(mrr, 4),
    }

    # ---- Answers (one generation per item; gated behind --answers for quota) ----
    if with_answers:
        eval_k = min(4, max_k)
        per_item, ans_correct, abst_correct = [], 0, 0
        for g in gold:
            hits = search(g["question"], k=eval_k, sources=[g["source"]], method=method)
            text = _answer_with_retry(g["question"], hits)
            abstained = is_abstention(text)
            if g.get("answerable", True):
                correct = (not abstained) and metrics.answer_is_correct(text, g)
                ans_correct += correct
            else:
                correct = abstained
                abst_correct += correct
            per_item.append(
                {"id": g["id"], "answerable": g.get("answerable", True),
                 "abstained": abstained, "correct": bool(correct)}
            )
            time.sleep(pace)
        result["answers"] = {
            "eval_k": eval_k,
            "answer_accuracy": round(ans_correct / len(answerable), 4),
            "answer_correct": ans_correct,
            "answer_total": len(answerable),
            "abstention_accuracy": round(abst_correct / max(1, len(unanswerable)), 4),
            "abstention_correct": abst_correct,
            "abstention_total": len(unanswerable),
            "per_item": per_item,
        }
    return result


def compare_methods(ks: list[int], methods: list[str]) -> dict:
    """Run retrieval-only eval for several methods (the before/after comparison)."""
    return {m: evaluate(ks, with_answers=False, method=m) for m in methods}


def print_report(r: dict) -> None:
    line = "=" * 60
    print(f"\n{line}\n  RAG EVALUATION  -  method: {r['method']}\n{line}")
    print(f"  gold items : {r['n_gold']}  ({r['n_answerable']} answerable, "
          f"{r['n_unanswerable']} out-of-doc)")
    print(f"  MRR        : {r['mrr']:.3f}   (mean reciprocal rank of first relevant chunk)\n")
    print(f"  {'k':>3} | {'hit-rate@k':>11} | {'precision@k':>12}")
    print(f"  {'-' * 3}-+-{'-' * 11}-+-{'-' * 12}")
    for k in r["k_values"]:
        m = r["retrieval"][k]
        print(f"  {k:>3} | {m['hit_rate'] * 100:>10.1f}% | {m['precision'] * 100:>11.1f}%")
    if "answers" in r:
        a = r["answers"]
        print(f"\n  answer quality (generated at top-k={a['eval_k']}):")
        print(f"    answer accuracy    : {a['answer_accuracy'] * 100:5.1f}%  "
              f"({a['answer_correct']}/{a['answer_total']} answerable)")
        print(f"    abstention accuracy: {a['abstention_accuracy'] * 100:5.1f}%  "
              f"({a['abstention_correct']}/{a['abstention_total']} out-of-doc)")
    print(f"{line}\n")


def print_comparison(results: dict, ks: list[int]) -> None:
    line = "=" * (16 + 9 + 9 * len(ks) + 9)
    print(f"\n{line}\n  RAG RETRIEVAL  -  method comparison (higher is better)\n{line}")
    header = f"  {'method':<14}| {'MRR':>6} |" + "".join(f" {'h@' + str(k):>6} |" for k in ks) + f" {'P@' + str(ks[-1]):>6}"
    print(header)
    print("  " + "-" * (len(header) - 2))
    base = None
    for method, r in results.items():
        mrr = r["mrr"]
        row = f"  {method:<14}| {mrr:>6.3f} |"
        for k in ks:
            row += f" {r['retrieval'][k]['hit_rate'] * 100:>5.1f}% |"
        row += f" {r['retrieval'][ks[-1]]['precision'] * 100:>5.1f}%"
        print(row)
        if base is None:
            base = r
    # delta of the last method vs the first (baseline)
    if len(results) > 1:
        first = next(iter(results.values()))
        last = list(results.values())[-1]
        d_mrr = (last["mrr"] - first["mrr"]) * 100
        d_h1 = (last["retrieval"][ks[0]]["hit_rate"] - first["retrieval"][ks[0]]["hit_rate"]) * 100
        print("  " + "-" * (len(header) - 2))
        print(f"  delta ({last['method']} vs {first['method']}): "
              f"MRR {d_mrr:+.1f}pts,  hit@{ks[0]} {d_h1:+.1f}pts")
    print(f"{line}\n")


def main() -> None:
    p = argparse.ArgumentParser(description="RAG evaluation harness")
    p.add_argument("--k", nargs="+", type=int, default=[1, 3, 5, 10],
                   help="top-k values to sweep (default: 1 3 5 10)")
    p.add_argument("--method", default="dense", choices=["dense", "hybrid", "rerank"],
                   help="retrieval method for a single run (default: dense)")
    p.add_argument("--compare", nargs="*", metavar="METHOD",
                   help="compare methods side by side (e.g. --compare dense hybrid rerank)")
    p.add_argument("--answers", action="store_true",
                   help="also generate answers (faithfulness + abstention; uses Gemini quota)")
    p.add_argument("--pace", type=float, default=4.0,
                   help="seconds between answer generations (rate-limit pacing)")
    p.add_argument("--json", action="store_true", help="print raw JSON instead of a table")
    args = p.parse_args()

    ks = sorted(set(args.k))

    if args.compare is not None:
        methods = args.compare or ["dense", "hybrid", "rerank"]
        results = compare_methods(ks, methods)
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            print_comparison(results, ks)
        return

    result = evaluate(ks, args.answers, args.pace, args.method)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_report(result)


if __name__ == "__main__":
    main()
