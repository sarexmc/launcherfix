// Herramienta SOLO PARA TI: publica tu .mrpack para todos los jugadores (cifrado y firmado).
// Uso: arrastra tu .mrpack sobre PUBLICAR.bat   (o: node tools/publicar.js mipack.mrpack)
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const ROOT = path.join(__dirname, '..'), MRP = require('../src/mrpack'), PU = require('../src/packupdate');
const P = f => path.join(ROOT, f);
const ask = q => new Promise(r => { const i = readline.createInterface({ input: process.stdin, output: process.stdout }); i.question(q, a => { i.close(); r(a.trim()); }); });
const clean = s => String(s || '').trim().replace(/^"|"$/g, '');

async function run(o = {}) {
  const log = o.log || console.log, CFG = JSON.parse(fs.readFileSync(P('config.json'), 'utf8'));
  const repo = CFG.updates && CFG.updates.repo; if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Falta "updates.repo" en config.json.');
  if (!CFG.publicKey) throw new Error('Falta "publicKey" en config.json.');

  // 1) llave privada de firma
  const pemFile = P('sarex-private.pem'); if (!fs.existsSync(pemFile)) throw new Error('No encuentro sarex-private.pem en esta carpeta. Cópialo aquí (el de tu pendrive).');
  const pem = fs.readFileSync(pemFile, 'utf8');
  const pub = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');
  if (pub !== CFG.publicKey) throw new Error('Tu sarex-private.pem no corresponde a la publicKey de config.json.');

  // 2) clave de los mods (se crea sola la primera vez)
  let key, firstKey = false;
  if (fs.existsSync(P('mods.key'))) key = Buffer.from(fs.readFileSync(P('mods.key'), 'utf8').trim(), 'hex');
  else { key = crypto.randomBytes(32); fs.writeFileSync(P('mods.key'), key.toString('hex')); firstKey = true; }
  if (key.length !== 32) throw new Error('mods.key no es válido (deben ser 64 caracteres).');
  fs.mkdirSync(P('worker'), { recursive: true }); fs.writeFileSync(P('worker/modkey.txt'), 'MODKEY=' + key.toString('hex') + '\n');

  // 3) token de GitHub (se pide una sola vez y se guarda en admin-token.txt)
  let token = o.token || process.env.GITHUB_TOKEN || (fs.existsSync(P('admin-token.txt')) ? fs.readFileSync(P('admin-token.txt'), 'utf8').trim() : '');
  if (!token && !o.gh) {
    log('\nFalta tu token de GitHub (solo se pide esta vez).\n  GitHub > Settings > Developer settings > Fine-grained tokens > Generate new token\n  Repository access: solo ' + repo + '  |  Permissions > Contents: Read and write\n');
    token = clean(await ask('Pega el token y pulsa Enter: ')); if (!/^[\w-]{20,255}$/.test(token)) throw new Error('Ese token no parece válido.');
    fs.writeFileSync(P('admin-token.txt'), token);
  }

  // 4) el modpack
  let file = clean(o.mrpack || process.argv[2]); if (!file) file = clean(await ask('Arrastra aquí tu archivo .mrpack y pulsa Enter: '));
  if (!/\.mrpack$/i.test(file) || !fs.existsSync(file)) throw new Error('No encuentro ese archivo .mrpack: ' + file);
  const zip = MRP.readZip(fs.readFileSync(file)), pack = MRP.parse(zip, { minecraft: CFG.minecraft });
  log(`\nModpack: ${pack.name} ${pack.version}  (${pack.files.length} archivos)`);
  const hosts = CFG.allowedHosts || [];
  const okHost = u => { try { const x = new URL(u); return x.protocol === 'https:' && hosts.includes(x.hostname); } catch { return false; } };
  const fetchBuf = o.fetchBuf || (async u => { const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'SarexStudio-Publicar' } }); if (!r.ok) throw new Error(`Descarga fallida (${r.status}): ${u}`); return Buffer.from(await r.arrayBuffer()); });
  const { jars } = await MRP.fetchAll(pack, zip, { okHost, fetchBuf, onProgress: (i, n, f) => process.stdout.write(`\rDescargando ${i + 1}/${n}  ${f.slice(0, 40).padEnd(40)}`) });
  if (!jars.length) throw new Error('Ese modpack no trae mods (.jar).');
  log(`\n${jars.length} mods listos. Publicando…`);

  // 5) publicar
  const gh = o.gh || PU.github(repo, token);
  let prev = 0; try { const m = await PU.fetchMeta(`https://raw.githubusercontent.com/${repo}/${CFG.updates.branch || 'main'}/updates/`, CFG.publicKey); if (m) prev = m.version; } catch (e) { if (/firma/i.test(e.message)) throw e; }
  const out = await PU.publish({ jars, key, privPem: pem, gh, prevVersion: prev, note: `${pack.name} ${pack.version}`.trim().slice(0, 120), onProgress: (i, n) => process.stdout.write(`\rSubiendo parte ${i + 1}/${n}   `) });
  log(`\n\nLISTO: versión ${out.version} publicada. Los jugadores la reciben al abrir el launcher.`);
  if (firstKey || o.showKey) log(`\nIMPORTANTE (solo esta vez): en Cloudflare, Worker > Settings > Variables, pon MODKEY con este valor y pulsa Deploy:\n\n${key.toString('hex')}\n`);
  return out;
}
module.exports = { run };
if (require.main === module) run().catch(e => { console.error('\nERROR: ' + e.message); process.exitCode = 1; });
