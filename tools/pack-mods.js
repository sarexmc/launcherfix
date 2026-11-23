// Mete TUS mods dentro del launcher en UN solo archivo cifrado (src/modpack.dat, AES-256-GCM).
// El índice también va cifrado: sin la clave no se ve ni cuántos mods hay, ni sus nombres, ni sus tamaños.
//   1) Copia tus .jar en bundle/mods/
//   2) node tools/pack-mods.js            -> crea src/modpack.dat, mods.key y worker/modkey.txt
//      node tools/pack-mods.js --embed    -> además guarda la clave dentro del launcher (menos seguro, sin servidor)
// bundle/ y mods.key son PRIVADOS: no los subas a GitHub.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = 'bundle/mods';
if (!fs.existsSync(SRC)) { fs.mkdirSync(SRC, { recursive: true }); console.log('Copia tus .jar en bundle/mods y vuelve a ejecutar.'); process.exit(0); }
const jars = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith('.jar'));
if (!jars.length) { console.log('No hay .jar en bundle/mods.'); process.exit(1); }
let key; if (fs.existsSync('mods.key')) key = Buffer.from(fs.readFileSync('mods.key', 'utf8').trim(), 'hex'); else { key = crypto.randomBytes(32); fs.writeFileSync('mods.key', key.toString('hex'), { mode: 0o600 }); }
const seal = data => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(data), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]); };
let off = 0; const blobs = [], index = [];
for (const f of jars) { const data = fs.readFileSync(path.join(SRC, f)), b = seal(data); index.push({ o: off, l: b.length, s: crypto.createHash('sha1').update(data).digest('hex') }); blobs.push(b); off += b.length; }
const idx = seal(Buffer.from(JSON.stringify(index))), head = Buffer.alloc(8); head.write('SXP1', 0, 'latin1'); head.writeUInt32LE(idx.length, 4);
fs.writeFileSync('src/modpack.dat', Buffer.concat([head, idx, ...blobs]));
process.argv.includes('--embed') ? fs.writeFileSync('src/modkey.json', JSON.stringify({ key: key.toString('hex') })) : fs.rmSync('src/modkey.json', { force: true });
fs.mkdirSync('worker', { recursive: true }); fs.writeFileSync('worker/modkey.txt', `MODKEY=${key.toString('hex')}\n`);
console.log(`Listo: ${jars.length} mods cifrados en src/modpack.dat.` + (process.argv.includes('--embed') ? ' Clave dentro del launcher (modo --embed).' : ' Pon MODKEY en el servidor (worker/modkey.txt).'));
