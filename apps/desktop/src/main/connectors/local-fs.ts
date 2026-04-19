import chokidar, { type FSWatcher } from 'chokidar';
import { stat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import type { DataSource, DocumentRecord, ChangeEvent } from './types';
import { isSupported, mimeFromPath } from './mime';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  'bower_components',
  '.git',
  '.svn',
  '.hg',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.cache',
  '.parcel-cache',
  '.turbo',
  'target',
  '.gradle',
  '.idea',
  '.vscode',
  '.vs',
  '.DS_Store',
  'coverage',
  '.nyc_output',
]);

// Hidden files we still want to index — config/infra that often holds
// important project context. Matched by exact basename.
const ALLOWED_HIDDEN_BASENAMES = new Set([
  '.env',
  '.env.example',
  '.env.sample',
  '.env.local',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.eslintrc',
  '.prettierrc',
  '.dockerignore',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  '.tool-versions',
]);

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB cap. Larger files skipped in v1.

export class LocalFileConnector implements DataSource {
  readonly id: string;
  private watcher: FSWatcher | null = null;

  constructor(readonly sourceId: string, private readonly roots: string[]) {
    this.id = sourceId;
  }

  async connect(): Promise<void> {
    for (const root of this.roots) {
      // stat throws for missing paths — let that propagate. Both dirs and
      // individual files are valid roots.
      await stat(root);
    }
  }

  async *listDocuments(): AsyncIterable<DocumentRecord> {
    for (const root of this.roots) {
      const rootStat = await stat(root);
      if (rootStat.isFile()) {
        const doc = await this.makeDoc(root);
        if (doc) yield doc;
        continue;
      }
      for await (const file of this.walk(root)) {
        const doc = await this.makeDoc(file);
        if (doc) yield doc;
      }
    }
  }

  private async makeDoc(file: string): Promise<DocumentRecord | null> {
    const mime = mimeFromPath(file);
    if (!mime) return null;
    const s = await stat(file);
    if (s.size > MAX_FILE_BYTES) return null;
    return {
      id: this.documentId(file),
      source: this.sourceId,
      path: file,
      title: file.split(sep).pop() ?? file,
      content: '',
      mime,
      metadata: { size: s.size, mtime: s.mtime.toISOString() },
      createdAt: s.birthtime.toISOString(),
      updatedAt: s.mtime.toISOString(),
    };
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    // id = sha1(sourceId + path). Reverse lookup not supported from id alone;
    // caller should pass a path to readFileRecord() below for direct access.
    void id;
    return null;
  }

  async readFile(path: string): Promise<{ buffer: Buffer; sha256: string; size: number; mtime: Date }> {
    const s = await stat(path);
    if (s.size > MAX_FILE_BYTES) {
      throw new Error(`File exceeds size cap: ${path} (${s.size} bytes)`);
    }
    const buffer = await readFile(path);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, sha256, size: s.size, mtime: s.mtime };
  }

  watchChanges(onEvent: (e: ChangeEvent) => void): () => void {
    // Polling mode: chokidar's fs.watch-based default opens one file descriptor
    // per watched directory and blows past macOS's soft ulimit (usually 256)
    // on large trees (Documents, source repos with node_modules etc). Polling
    // trades CPU for bounded FD usage — fine for a desktop app with low change
    // rate. The ignore list prunes the heaviest subtrees before they get polled.
    this.watcher = chokidar.watch(this.roots, {
      ignored: (path, stats) => {
        const segments = path.split(sep);
        if (segments.some((seg) => IGNORED_DIRECTORIES.has(seg))) return true;
        // Ignore unsupported files so the watcher doesn't poll binaries/images.
        // Directories pass through; files are filtered to supported types.
        if (stats?.isFile() && !isSupported(path)) return true;
        return false;
      },
      ignoreInitial: true,
      persistent: true,
      usePolling: true,
      interval: 3000,
      binaryInterval: 10000,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    this.watcher
      .on('add', (path) => {
        if (isSupported(path)) onEvent({ type: 'add', path });
      })
      .on('change', (path) => {
        if (isSupported(path)) onEvent({ type: 'change', path });
      })
      .on('unlink', (path) => {
        if (isSupported(path)) onEvent({ type: 'unlink', path });
      })
      .on('error', (err) => {
        // Keep the watcher alive on transient errors (EMFILE, permission,
        // volume ejected). Log and continue — EMFILE still happens if the
        // ignored tree is huge, but a single error no longer aborts the app.
        console.error('chokidar watch error:', err);
      });

    return () => {
      void this.watcher?.close();
      this.watcher = null;
    };
  }

  private async *walk(dir: string): AsyncIterable<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (IGNORED_DIRECTORIES.has(name)) continue;
      // Skip hidden dirs (.git, .cache, …) but keep allow-listed hidden files
      // so users still see .env/.editorconfig/etc in results.
      if (name.startsWith('.') && !ALLOWED_HIDDEN_BASENAMES.has(name)) continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        yield* this.walk(full);
      } else if (entry.isFile() && isSupported(full)) {
        yield full;
      }
    }
  }

  private documentId(path: string): string {
    return createHash('sha1').update(`${this.sourceId}:${path}`).digest('hex');
  }
}
