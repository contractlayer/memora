import * as lancedb from '@lancedb/lancedb';
import { Field, Float32, FixedSizeList, Utf8, Schema, Int32 } from 'apache-arrow';

export type VectorRecord = {
  id: string;
  fileId: string;
  ordinal: number;
  text: string;
  vector: Float32Array;
};

export type VectorSearchHit = {
  chunkId: string;
  fileId: string;
  text: string;
  ordinal: number;
  distance: number;
};

export class LanceVectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly dimensions: number,
  ) {}

  async init(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();
    if (tables.includes('chunks')) {
      this.table = await this.db.openTable('chunks');
      return;
    }

    const schema = new Schema([
      new Field('id', new Utf8(), false),
      new Field('file_id', new Utf8(), false),
      new Field('ordinal', new Int32(), false),
      new Field('text', new Utf8(), false),
      new Field(
        'vector',
        new FixedSizeList(this.dimensions, new Field('item', new Float32(), true)),
        false,
      ),
    ]);
    this.table = await this.db.createEmptyTable('chunks', schema);
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0 || !this.table) return;

    // LanceDB merge-insert on id: replace existing rows with same id.
    await this.table
      .mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(
        records.map((r) => ({
          id: r.id,
          file_id: r.fileId,
          ordinal: r.ordinal,
          text: r.text,
          vector: Array.from(r.vector),
        })),
      );
  }

  async deleteByFileId(fileId: string): Promise<void> {
    if (!this.table) return;
    // LanceDB's delete only accepts SQL predicate strings — no parameter
    // binding. fileId always originates from crypto.randomUUID(), so a
    // strict format check is safer than string escaping.
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) {
      throw new Error(`Invalid fileId for vector delete: ${fileId}`);
    }
    await this.table.delete(`file_id = '${fileId}'`);
  }

  async searchVector(query: Float32Array, topK: number): Promise<VectorSearchHit[]> {
    if (!this.table) return [];
    const results = await this.table
      .search(Array.from(query))
      .limit(topK)
      .toArray();
    return results.map((r: Record<string, unknown>) => ({
      chunkId: r['id'] as string,
      fileId: r['file_id'] as string,
      text: r['text'] as string,
      ordinal: r['ordinal'] as number,
      distance: r['_distance'] as number,
    }));
  }

  async count(): Promise<number> {
    if (!this.table) return 0;
    return this.table.countRows();
  }
}
