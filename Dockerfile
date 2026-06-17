# DocLens: one container that builds the Next.js frontend into static files and
# serves them from the FastAPI backend (single origin, no CORS). Runs the full
# app, including the cross-encoder reranker. Targets Hugging Face Spaces (Docker).

# ---- Stage 1: build the frontend into a static ./out folder ----
FROM node:20-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Empty base => the app calls the API on its own origin (the backend serves it).
ENV NEXT_PUBLIC_API_BASE=""
RUN npm run build

# ---- Stage 2: FastAPI backend that also serves the static frontend ----
FROM python:3.11-slim AS app

# Hugging Face Spaces run the container as UID 1000; give it a writable home.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    HF_HOME=/home/user/.cache/huggingface \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

# CPU build of torch first (from PyTorch's CPU index) so pip skips the huge CUDA wheel.
RUN pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu
COPY --chown=user backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --user -r requirements.txt

# Pre-cache the cross-encoder so the first request isn't slow (best-effort).
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')" || true

# App code + the built frontend.
COPY --chown=user backend/ ./backend/
COPY --chown=user --from=frontend /fe/out ./frontend_out

EXPOSE 7860
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "7860"]
