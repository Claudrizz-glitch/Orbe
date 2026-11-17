// Cria/atualiza as tabelas do ORBE no Postgres (Neon). Seguro para rodar várias vezes.
// Uso: npm run db:setup
import { readFileSync } from 'node:fs';
import { connect } from './_env.mjs';

const sql = await connect();
try {
  await sql.unsafe(readFileSync('db/schema.sql', 'utf8'));
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  console.log(`✓ Esquema aplicado. Tabelas: ${tables.map((t) => t.table_name).join(', ')}`);
} catch (e) {
  console.error('✗ Falha ao aplicar o esquema:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
