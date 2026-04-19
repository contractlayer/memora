// Shared types used across desktop main/renderer, eval runner, and future services.

export type FileHash = string;

export type ChunkId = string;

export type SourceKind = 'local-fs' | 'gmail' | 'gdrive' | 'o365';
