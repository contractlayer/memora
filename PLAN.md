# V1 Implementation Plan — AI Search / Personal Knowledge Engine

## Context

Product là desktop app "Spotlight + ChatGPT" cho developer / tech worker: index local files bằng local LLM, trả lời query natural language kèm citation + mở file.

Plan gốc của user đã được phản biện. User đã trả lời từng câu hỏi để chốt scope. Document này là **final implementation plan** cho v1, dựa trên các quyết định đã chốt.

---

## 1. Summary các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Team | Solo dev, chưa Rust |
| Target vertical v1 | Developer / tech worker |
| Privacy mode | Local default, cloud LLM opt-in (v2) |
| OS | macOS + Windows song song từ v1 |
| Tech stack | Electron + TypeScript |
| Data source v1 | Local files only (Gmail/Drive/M365 → v2+) |
| File types v1 | PDF, DOCX, TXT, MD, code files (tree-sitter). **OCR + audio/video defer v1.5.** |
| Timeline | 10–12 tuần (đã cut OCR + audio/video từ scope trước) |
| Search stack | Hybrid (BM25 + vector) + cross-encoder reranker + LLM query parser + eval framework (RAGAS) |
| Context menu | Có trong v1 (mac Finder ext + Windows shell ext) + watch folders |
| Local LLM | `node-llama-cpp` default, detect Ollama nếu có |
| Embedding | BGE-M3 (multilingual, hỗ trợ tiếng Việt) |
| Vector DB | LanceDB |
| Monetization | Freemium, paid tier công bố khi ra v2 (cloud/Gmail/Drive) |
| Onboarding | Auto-scan Desktop/Downloads/Documents ngay khi mở, search được trên partial index, user add folder thêm sau vẫn search được tiếp |

---

## 2. Kiến trúc tổng

```
┌────────────────────────────────────────────────────────────┐
│  Electron Renderer (React + TS)                            │
│  — Search bar, Chat UI, Sources panel, File preview        │
└─────────────┬──────────────────────────────────────────────┘
              │ IPC
┌─────────────▼──────────────────────────────────────────────┐
│  Electron Main (Node + TS)                                 │
│  ├─ QueryOrchestrator   (planner → search → synth)         │
│  ├─ IndexerService      (queue + watchers)                 │
│  ├─ ConnectorRegistry   (LocalFS v1, Gmail/Drive v2+)      │
│  ├─ ParserRegistry      (pdf/docx/txt/md/tree-sitter)      │
│  ├─ Embedder            (BGE-M3 via onnxruntime-node)      │
│  ├─ LLMRouter           (node-llama-cpp / Ollama detect)   │
│  ├─ VectorStore         (LanceDB wrapper)                  │
│  ├─ MetadataStore       (better-sqlite3, jobs + files)     │
│  ├─ ReRanker            (BGE reranker base via ORT)        │
│  └─ Eval                (golden set runner, CLI)           │
├────────────────────────────────────────────────────────────┤
│  Platform helpers                                          │
│  ├─ macOS: Finder Sync Extension (Swift) → XPC → Electron  │
│  └─ Windows: Shell Extension (C# COM) → named pipe → Node  │
└────────────────────────────────────────────────────────────┘
```

**Principle**: All heavy work in Electron main process (không renderer), worker threads cho embedding/OCR/Whisper để không block main IPC.

---

## 3. Phase breakdown (14–18 tuần)

### Phase 0 — Scaffold & infra (Week 1)
- Electron + TS + React starter, electron-forge packaging mac arm64/x64 + win x64.
- CI: GitHub Actions build + sign both OS.
- ESLint, Prettier, Vitest.
- Decisions: bundler (Vite), state (Zustand), UI (Radix + Tailwind).

### Phase 1 — Core indexing pipeline (Week 2–5)
- `ConnectorRegistry` + `LocalFileConnector` with `chokidar` for file watching.
- `ParserRegistry`:
  - Week 2: text, md, code (utf-8 + language detect via tree-sitter).
  - Week 3: PDF (`pdfjs-dist`), DOCX (`mammoth`), XLSX (`exceljs`), PPT (`officeparser`).
- Chunker:
  - Text/MD: recursive splitter 500 tokens / 50 overlap.
  - Code: tree-sitter symbol-aware chunks (function/class granularity).
  - Tables: row-group chunking.
- Embedder: `onnxruntime-node` + BGE-M3 ONNX weights, worker thread pool (max 2).
- `IndexerService` job queue with SQLite (priority, retry, throttle CPU>70% pause).
- Dedup: SHA-256 file + SHA-256 chunk + SimHash 64-bit for near-dup.
- `VectorStore` LanceDB wrapper with hybrid search API.

### Phase 2 — Query engine + UI (Week 6–8)
- `QueryOrchestrator` flow:
  1. LLM query parser → extract entities/dates/filters (structured JSON via function calling).
  2. Hybrid search (BM25 + vector, reciprocal rank fusion).
  3. Reranker top-50 → top-5.
  4. LLM synthesis with citations.
- `LLMRouter`: detect `localhost:11434` → Ollama, else load node-llama-cpp with default model (Qwen2.5-7B-Instruct Q4).
- React UI:
  - Search bar with debounced suggestions.
  - Chat window with streaming answer.
  - Citations click → Quick Look (mac) / default app (win) + highlight snippet.
  - Sources panel: add/remove folders, view index status.
- Onboarding: auto-detect Desktop/Downloads/Documents, show progress, "search available now" state on partial index.

### Phase 3 — Context menu integration (Week 9–10)
- **macOS**:
  - Finder Sync Extension target trong Xcode project riêng, signed cùng team ID.
  - XPC service giao tiếp với main Electron app.
  - "Add to AI memory" menu item + badge icon cho indexed folders.
- **Windows**:
  - Shell extension in C# (.NET 4.8 COM) or C++. Handle `IContextMenu`.
  - Named pipe IPC to Node main process.
  - Installer registers CLSID properly (need admin elevation prompt).
- Fallback UX trong app: drag-and-drop files + "Add folder" button luôn có sẵn.

### Phase 4 — Eval, polish, security (Week 11)
- Build golden set: 100 query-answer pairs trên dataset dev thật.
- RAGAS metrics: faithfulness, answer relevance, context precision.
- Regression check trước mọi release.
- Encryption at rest:
  - LanceDB table + SQLite database encrypted với key từ OS keychain (`keytar`).
  - Electron safeStorage cho sensitive metadata.
- Code signing + notarization mac, Authenticode win.
- Crash reporting opt-in (Sentry with PII scrubbing).
- Auto-update: electron-updater + GitHub Releases.

### Phase 5 — Beta launch (Week 12)
- 20–50 private beta users (dev Twitter/HN outreach).
- Feedback loop 2 tuần.
- Fix top 5 issues → public launch.
- Landing page + Product Hunt + HN Show post.

---

## 4. Critical files / module layout

```
source/
├── apps/
│   ├── desktop/                    # Electron app
│   │   ├── main/
│   │   │   ├── index.ts            # App bootstrap
│   │   │   ├── ipc.ts              # IPC handlers
│   │   │   ├── services/
│   │   │   │   ├── indexer.ts      # IndexerService
│   │   │   │   ├── query.ts        # QueryOrchestrator
│   │   │   │   ├── embedder.ts     # BGE-M3 ORT runner
│   │   │   │   ├── reranker.ts     # BGE reranker
│   │   │   │   ├── llm-router.ts   # Ollama/node-llama-cpp
│   │   │   │   └── vector-store.ts # LanceDB wrapper
│   │   │   ├── connectors/
│   │   │   │   ├── types.ts        # DataSource interface
│   │   │   │   └── local-fs.ts
│   │   │   ├── parsers/
│   │   │   │   ├── registry.ts
│   │   │   │   ├── pdf.ts
│   │   │   │   ├── docx.ts
│   │   │   │   └── code.ts         # tree-sitter
│   │   │   │   # ocr.ts + audio.ts defer v1.5
│   │   │   ├── chunker/
│   │   │   │   ├── text.ts
│   │   │   │   └── code.ts
│   │   │   └── storage/
│   │   │       ├── metadata.ts     # better-sqlite3
│   │   │       └── lance.ts
│   │   └── renderer/
│   │       ├── App.tsx
│   │       ├── routes/
│   │       │   ├── Chat.tsx
│   │       │   ├── Sources.tsx
│   │       │   └── Settings.tsx
│   │       └── components/
│   └── context-menu/
│       ├── macos/                  # Swift Xcode project
│       │   └── FinderSyncExt/
│       └── windows/                # C# shell extension
│           └── ShellExt/
├── packages/
│   ├── eval/                       # Golden set + RAGAS runner
│   └── shared/                     # Shared types across main/renderer
└── resources/
    ├── models/                     # Placeholder — fetched at first run
    └── binaries/                   # whisper.cpp per platform
```

---

## 5. Existing libraries / utilities để reuse (không tự viết)

- **File watch**: `chokidar` (cross-platform) — không tự wrap `fs.watch`.
- **PDF**: `pdfjs-dist` — battle-tested, Mozilla.
- **DOCX**: `mammoth`.
- **Code parse**: `web-tree-sitter` + pre-built WASM grammars.
- **Embedding runtime**: `onnxruntime-node` (official Microsoft).
- **Vector DB**: `@lancedb/lancedb`.
- **SQLite**: `better-sqlite3` (sync, fast, proven in Electron).
- **LLM**: `node-llama-cpp` cho bundled; HTTP client cho Ollama detect.
- **Encryption**: Electron `safeStorage` + `keytar`.
- **Eval**: `ragas` (Python, chạy qua subprocess trong CI), hoặc implement metrics chính bằng TS nếu muốn tất cả trong-process.
- **UI**: Radix UI primitives + Tailwind (đừng build component system từ đầu).
- **IPC**: Electron built-in, không cần Comlink cho v1.

---

## 6. Risk register — những chỗ dễ trượt timeline

| Risk | Mitigation |
|---|---|
| Finder Sync Extension code-sign hell | Spike 1–2 ngày ở Week 1 để verify mac code-sign + XPC khả thi. Plan B: drag-and-drop + watch folders nếu Finder ext fail. |
| Windows shell extension trên Electron installer | Dùng WiX hoặc NSIS custom action; test trên VM sạch nhiều lần. Plan B như macOS. |
| BGE-M3 ONNX size (~2GB) + download UX | Download background sau install, có fallback small model trong lúc chờ. |
| LanceDB breaking changes | Pin version, test migration path trong eval suite. |
| Index 100GB lần đầu quá lâu | Priority queue: Desktop/Downloads/Documents trước; search khả dụng ngay; progress visible. |
| Cloud LLM cost khi mở v2 | Rate limit per user, cache kết quả, không ship Pro tier đến khi cost model validated. |

---

## 7. Security & privacy checklist (v1)

- [ ] Tất cả data at-rest encrypted (vector DB + SQLite + cache) với key từ keychain.
- [ ] Không gọi network trong local mode, enforce bằng default CSP + main process opt-in flag.
- [ ] OAuth tokens (v2+) chỉ lưu trong keychain, không trong SQLite.
- [ ] Crash report scrub file paths, content, email addresses.
- [ ] First-run disclosure rõ ràng: "Dữ liệu của bạn ở lại máy. Cloud features opt-in và sẽ được đánh dấu rõ."
- [ ] Privacy policy page công khai trước khi launch.
- [ ] User có "Reset everything" button — xóa index + models + settings.

---

## 8. Verification — cách test end-to-end

1. **Build & smoke**: `npm run build` → chạy installer trên macOS sạch + Windows VM sạch, app mở được, không crash 10 phút idle.
2. **Indexing**:
   - Bỏ 1000 PDF/DOCX thật vào folder, mở app → index chạy, search được trong <30s kể từ lúc mở.
   - Edit 1 file → thấy update trong index <10s.
   - Rename/move file → citation vẫn mở đúng file.
3. **Search quality**:
   - Run golden set 100 queries → MRR@10 ≥ 0.65, faithfulness ≥ 0.85 (RAGAS).
   - Manual test 10 queries tiếng Việt + 10 tiếng Anh, kiểm tra citation chính xác.
4. **Multi-format**:
   - PDF text-based: extract đúng, trang/bbox map để highlight.
   - DOCX table: giữ row-column structure trong chunk.
   - Code repo 10K files → search "function authenticate" trả về đúng symbol qua tree-sitter chunking.
5. **Context menu**:
   - macOS Finder: right-click file .pdf → "Add to AI memory" → file index trong 10s.
   - Windows Explorer tương tự.
6. **Privacy**:
   - Bật local-only mode → chạy app 1 tiếng, monitor bằng Little Snitch / Wireshark — không traffic ra ngoài trừ update check (nếu bật).
   - Kiểm tra encrypted db với hex viewer — không thấy plaintext.
7. **Performance**:
   - Index 10GB văn bản trên M1 16GB: hoàn tất <90 phút, RAM peak <4GB.
   - Query latency p50 <1.5s (search + LLM synthesis), p95 <4s.
8. **Eval regression**:
   - Chạy `npm run eval` trước mỗi release; fail CI nếu metrics tụt >5% so với baseline.

---

## 9. Sau v1 (defer, không phải scope hiện tại)

- **v1.5**: OCR (Apple Vision mac + PaddleOCR win) + Whisper audio/video transcription. Pro tier UI + billing (Stripe), cloud LLM opt-in.
- **v2**: Gmail connector (bắt đầu Google OAuth verification ở Week 8 của v1 để có sẵn khi v1.5 launch), Drive connector.
- **v2.5**: M365 (chỉ khi có yêu cầu enterprise thật).
- **v3**: Multi-device sync (E2E encrypted), team/shared knowledge base.

---

## 10. Những thứ KHÔNG làm trong v1 (để tránh scope creep)

- Gmail/Drive/M365 connectors.
- OCR (images, scan PDF) — defer v1.5.
- Whisper audio/video transcription — defer v1.5.
- Cloud LLM routing.
- Team/multi-user features.
- Mobile app.
- Web version.
- Plugin/extension API.
- Automatic summarization / daily digest.
- Voice input / speech to query.
- iOS Shortcuts / Alfred / Raycast integrations.

Những thứ trên có thể thú vị — nhưng để sau v1 ship thành công.
