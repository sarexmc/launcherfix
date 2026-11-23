// Genera códigos de acceso de 6 dígitos (de un solo uso).
//   node tools/make-codes.js 150
// Crea: codigos_acceso.txt (PRIVADO, repártelos a mano), src/codes.json (solo huellas) y worker/codes-hashes.txt (para el servidor).
const crypto = require('crypto'), fs = require('fs');
const n = parseInt(process.argv[2] || '150', 10);
const weak = c => /^(\d)\1{5}$/.test(c) || '0123456789012345'.includes(c) || '9876543210987654'.includes(c);
const codes = new Set();
while (codes.size < n) { const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); if (!weak(c)) codes.add(c); }
const salt = crypto.randomBytes(16).toString('hex');
const hashes = [...codes].map(c => crypto.createHash('sha256').update(salt + c).digest('hex'));
fs.writeFileSync('codigos_acceso.txt', 'CÓDIGOS DE ACCESO (un solo uso). Guarda este archivo en privado.\n\n' + [...codes].map((c, i) => `${String(i + 1).padStart(3, '0')}  ${c}`).join('\n') + '\n');
fs.writeFileSync('src/codes.json', JSON.stringify({ salt, hashes }));
fs.writeFileSync('worker/codes-hashes.txt', `SALT=${salt}\nCODES=${hashes.join(',')}\n`);
console.log(`Listo: ${n} códigos. NO subas codigos_acceso.txt ni worker/codes-hashes.txt a GitHub.`);
