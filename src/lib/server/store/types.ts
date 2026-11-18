export type Table =
  | 'spaces' | 'categories' | 'channels' | 'identities' | 'messages' | 'attachments'
  | 'import_jobs' | 'import_map' | 'access_sessions' | 'login_attempts' | 'settings' | 'page_history';

export type Row = Record<string, unknown>;
export type StorageKind = 'local' | 'postgres' | 'supabase';

export interface Filter {
  /** igualdade; valor null significa "IS NULL" */
  eq?: Row;
  in?: Record<string, unknown[]>;
  gte?: Record<string, string | number>;
  lt?: Record<string, string | number>;
}

export interface Query extends Filter {
  cols?: string;
  order?: { col: string; asc?: boolean }[];
  limit?: number;
  offset?: number;
}

/**
 * Camada de dados do ORBE. Duas implementações:
 *  - supabase: produção (Postgres + Storage)
 *  - local:    desenvolvimento/backup em disco (pasta orbe-data/)
 */
export interface Store {
  kind: StorageKind;
  select<T = Row>(table: Table, q?: Query): Promise<T[]>;
  count(table: Table, f?: Filter): Promise<number>;
  insert<T = Row>(table: Table, rows: Row[], opts?: { ignoreDuplicatesOn?: string; cols?: string }): Promise<T[]>;
  update<T = Row>(table: Table, f: Filter, patch: Row, cols?: string): Promise<T[]>;
  remove(table: Table, f: Filter): Promise<number>;
  reorder(table: 'spaces' | 'categories' | 'channels' | 'identities' | 'messages', ids: string[]): Promise<void>;
  moveChannel(channelId: string, categoryId: string | null, orderedIds: string[]): Promise<void>;
  putFile(path: string, data: Uint8Array, contentType: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  /** Acrescenta bytes ao fim de um arquivo existente (envio em partes). */
  appendFile(path: string, data: Uint8Array): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  /** Tamanho em bytes, ou null se não existe. */
  fileSize(path: string): Promise<number | null>;
  /** Resposta HTTP que entrega o arquivo (stream local ou redirecionamento assinado). */
  fileResponse(path: string, opts?: { download?: string; view?: boolean }): Promise<Response>;
}
