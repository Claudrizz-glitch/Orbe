import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Variável de ambiente ausente: ${name}. Veja .env.example.`);
  }
  return v.trim();
}

export const env = {
  get supabaseUrl() { return required('SUPABASE_URL'); },
  get supabaseServiceKey() { return required('SUPABASE_SERVICE_ROLE_KEY'); },
  get passwordHash() { return required('ORBE_PASSWORD_HASH'); },
  get sessionSecret() { return process.env.ORBE_SESSION_SECRET?.trim() || ''; },
  isProd: process.env.NODE_ENV === 'production',
};
