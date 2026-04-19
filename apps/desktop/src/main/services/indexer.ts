export type IndexJob = {
  id: string;
  path: string;
  priority: number;
  retries: number;
};

export class IndexerService {
  async enqueue(_job: Omit<IndexJob, 'id' | 'retries'>): Promise<string> {
    // TODO(Phase 1): insert into SQLite jobs table. Return job id.
    return '';
  }

  async start(): Promise<void> {
    // TODO(Phase 1): worker loop. Pull jobs, parse → chunk → embed → upsert.
    // Throttle when CPU > 70%. Cap 2 concurrent workers.
  }

  async stop(): Promise<void> {
    // TODO(Phase 1)
  }
}
