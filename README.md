# AI Search

Desktop app: "Spotlight + ChatGPT" for your local files. Index PDFs, DOCX, text,
markdown, and source code; ask natural-language questions; get answers with
citations that open the original file.

Built for developers and tech workers. Privacy-first: local-default, cloud opt-in.

See [PLAN.md](./PLAN.md) for the full V1 implementation plan.

## Stack

- **App**: Electron + TypeScript + React (Vite)
- **Vector DB**: LanceDB (embedded)
- **Metadata**: better-sqlite3
- **Embedding**: BGE-M3 via onnxruntime-node
- **Reranker**: BGE reranker base via onnxruntime-node
- **LLM**: node-llama-cpp (bundled) with Ollama auto-detect
- **Search**: hybrid (BM25 + vector + reciprocal rank fusion) + cross-encoder rerank
- **File watch**: chokidar

## Monorepo layout

```
apps/
  desktop/            Electron app (main + preload + renderer)
  context-menu/
    macos/            Finder Sync Extension (Swift, Xcode) — Phase 3
    windows/          Shell extension (C# COM) — Phase 3
packages/
  shared/             Types shared across workspaces
  eval/                Golden set runner + RAGAS client
services/
  ragas-eval/         Python RAGAS eval API (docker-compose)
resources/
  models/             BGE-M3 + reranker ONNX (fetched at runtime, .gitignored)
  binaries/           Platform-native binaries (built in CI, .gitignored)
```

## Prerequisites

- Node.js >= 20.11
- Docker Desktop (for dev services only — the Electron app runs natively)
- macOS or Windows 11 (Linux supported for dev only; no context-menu integration)

## Setup

```bash
# 1. Install npm deps
npm install

# 2. Start dev services (Ollama + RAGAS eval runner)
npm run services:up

# 3. Run the Electron app in dev mode
npm run dev
```

### What docker-compose runs

Docker is used **only for dev-time backing services**. The Electron app itself
runs natively (it needs display access + native OS APIs; Electron cannot run in
a container usefully).

| Service        | Port   | Purpose                                                             |
|----------------|--------|---------------------------------------------------------------------|
| `ollama`       | 11434  | Dev LLM server. App auto-detects and uses this when available.      |
| `ollama-bootstrap` | –  | One-shot container that pulls `qwen2.5:7b-instruct` + `bge-m3`.     |
| `ragas-eval`   | 7860   | Python FastAPI wrapper around RAGAS for search-quality evaluation.  |

Stop services: `npm run services:down`. Logs: `npm run services:logs`.

### Production runtime

In production, the app ships `node-llama-cpp` with a bundled Qwen2.5-7B-Instruct
Q4 model, downloaded on first launch. It still detects Ollama at
`localhost:11434` and defers to it when the user has their own Ollama running
(respects power-user setup with larger models).

## Development commands

```bash
npm run dev              # Run Electron app (main + renderer with HMR)
npm run build            # Build all workspaces
npm run typecheck        # Type-check all workspaces
npm run lint             # ESLint
npm run test             # Vitest
npm run services:up      # Start Ollama + RAGAS eval
npm run services:down    # Stop dev services
```

## Roadmap

Phase 0 (Week 1):  scaffolding  ← **you are here**
Phase 1 (Week 2–5): indexing pipeline (local FS → parser → chunker → embedder → LanceDB)
Phase 2 (Week 6–8): query engine + UI (hybrid search → rerank → LLM synthesis, chat UI, citations)
Phase 3 (Week 9–10): context-menu integration (macOS Finder Sync + Windows shell ext)
Phase 4 (Week 11): eval framework, encryption at rest, code sign, crash reporting
Phase 5 (Week 12): beta launch

See [PLAN.md](./PLAN.md) §3 for full breakdown.

## Privacy

- **Local default**: no network calls in local mode. Enforced via renderer CSP
  and main-process opt-in flag.
- **Cloud opt-in (v1.5+)**: explicit toggle with warning modal before any query
  is sent off-device.
- **Data at rest**: LanceDB + SQLite encrypted with a key stored in the OS
  keychain (macOS Keychain / Windows Credential Manager).
- **No telemetry by default**: crash reports opt-in with PII scrubbing.

See [PLAN.md](./PLAN.md) §7 for the full privacy checklist.
