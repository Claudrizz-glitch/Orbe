// Carrega .env.local / .env para os scripts (sem dependências).
import { existsSync, readFileSync } from 'node:fs';

export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export async function connect() {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('DATABASE_URL não encontrada. Cole a connection string do Neon no .env.local.');
    process.exit(1);
  }
  const { default: postgres } = await import('postgres');
  return postgres(url, { ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require', max: 3, prepare: false, onnotice: () => {} });
}
