// Gera o hash scrypt da senha de acesso do ORBE.
// Uso: npm run hash-password   (a senha é pedida sem eco no terminal)
//  ou: node scripts/hash-password.mjs "minha senha"
import { scryptSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const N = 32768, r = 8, p = 1, KEYLEN = 64;

function hash(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

function finish(pw) {
  if (!pw || pw.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }
  console.log('\nCole esta linha no .env.local (e nas variáveis da Vercel):\n');
  console.log(`ORBE_PASSWORD_HASH=${hash(pw)}\n`);
}

if (process.argv[2]) {
  finish(process.argv[2]);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes('Senha')) rl.output.write(s); };
  rl.question('Senha do ORBE: ', (pw) => { rl.close(); finish(pw); });
}
