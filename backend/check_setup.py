"""
check_setup.py — run this FIRST, after `pip install` finishes AND after you've
pasted your key into backend/.env:

    .venv\\Scripts\\python.exe check_setup.py

What it does:
  1) Confirms every backend library imports cleanly.
  2) Makes three tiny live calls to Gemini (count_tokens, generate, embed) to
     prove your API key works and to confirm the SDK method signatures.
If anything fails here, we fix it before building the real pipeline — much
cheaper than discovering a broken key halfway through.
"""

import importlib
import os
import sys

print("=" * 50)
print("1) Library imports")
print("=" * 50)
LIBS = [
    ("google.genai", "google-genai"),
    ("chromadb", "chromadb"),
    ("pypdf", "pypdf"),
    ("fitz", "pymupdf"),       # PyMuPDF imports as `fitz`
    ("fastapi", "fastapi"),
    ("uvicorn", "uvicorn"),
    ("pydantic", "pydantic"),
    ("dotenv", "python-dotenv"),
]
imports_ok = True
for module_name, label in LIBS:
    try:
        mod = importlib.import_module(module_name)
        print(f"  {label:<16} OK   {getattr(mod, '__version__', '')}")
    except Exception as exc:  # report ANY failure without crashing the script
        imports_ok = False
        print(f"  {label:<16} FAILED: {exc}")

print()
print("=" * 50)
print("2) Gemini API key + live calls")
print("=" * 50)

from dotenv import load_dotenv
from pathlib import Path

# Load the .env sitting next to this script, regardless of where we launch from.
load_dotenv(Path(__file__).with_name(".env"))
key = os.getenv("GEMINI_API_KEY")
if not key or key == "your_key_here":
    print("  No real GEMINI_API_KEY found in backend/.env yet.")
    print("  -> Get one free at https://aistudio.google.com/app/apikey")
    print("  -> Copy .env.example to .env, paste the key, and re-run this script.")
    sys.exit(0 if imports_ok else 1)

try:
    from google import genai

    client = genai.Client(api_key=key)
    GEN_MODEL = "gemini-3.5-flash"      # generation model (free tier)
    EMB_MODEL = "gemini-embedding-001"  # embedding model

    tokens = client.models.count_tokens(model=GEN_MODEL, contents="Hello, world!")
    print(f"  count_tokens('Hello, world!') -> {tokens.total_tokens} tokens")

    gen = client.models.generate_content(
        model=GEN_MODEL, contents="Reply with exactly these two words: setup works"
    )
    print(f"  generate -> {gen.text.strip()!r}")

    emb = client.models.embed_content(model=EMB_MODEL, contents="Hello, world!")
    dim = len(emb.embeddings[0].values)
    print(f"  embed -> vector of {dim} dimensions")

    print("\n  GEMINI OK -- ready to build the RAG pipeline.")
except Exception as exc:
    print(f"\n  GEMINI CALL FAILED: {exc}")
    print("  Check the key in backend/.env and your internet connection.")
    print("  (If a method name errors, the SDK signature may have changed -- tell me and I'll adjust.)")
    sys.exit(1)
