// Actualizaciones de los mods para TODOS los jugadores sin reinstalar el launcher.
// El administrador publica un paquete cifrado y FIRMADO en GitHub; los launchers lo detectan, verifican la firma y lo instalan.
const crypto = require('crypto');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const seal = (data, key) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([c.update(data), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]); };
function buildContainer(jars, key) { // mismo formato que tools/pack-mods.js (SXP1)
  let off = 0; const blobs = [], index = [];
  for (const d of jars) { const b = seal(d, key); index.push({ o: off, l: b.length, s: crypto.createHash('sha1').update(d).digest('hex') }); blobs.push(b); off += b.length; }
  const idx = seal(Buffer.from(JSON.stringify(index)), key), head = Buffer.alloc(8); head.write('SXP1', 0, 'latin1'); head.writeUInt32LE(idx.length, 4);
  return Buffer.concat([head, idx, ...blobs]);
}
const split = (buf, size) => { const out = []; for (let o = 0; o < buf.length; o += size) out.push(buf.subarray(o, Math.min(o + size, buf.length))); return out; };
const sign = (bytes, privPem) => crypto.sign(null, bytes, crypto.createPrivateKey(privPem)).toString('base64');
function verify(bytes, sigB64, pubB64) {
  try { return crypto.verify(null, bytes, crypto.createPublicKey({ key: Buffer.from(pubB64, 'base64'), format: 'der', type: 'spki' }), Buffer.from(String(sigB64).trim(), 'base64')); } catch { return false; }
}
function github(repo, token, api = 'https://api.github.com') {
  const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'SarexStudio-Launcher', 'X-GitHub-Api-Version': '2022-11-28' };
  const url = p => `${api}/repos/${repo}/contents/${p}`;
  const g = {
    async get(p) { const r = await fetch(url(p), { headers: H }); if (r.status === 404) return null; if (r.status === 401 || r.status === 403) throw new Error('GitHub rechazó el token (revisa sus permisos).'); if (!r.ok) throw new Error('GitHub ' + r.status); return r.json(); },
    async put(p, buf, msg) {
      const cur = await g.get(p), body = { message: msg, content: buf.toString('base64'), ...(cur && cur.sha ? { sha: cur.sha } : {}) };
      const r = await fetch(url(p), { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`GitHub ${r.status} al subir ${p}`);
    },
    async del(p, sha, msg) { const r = await fetch(url(p), { method: 'DELETE', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ message: msg, sha }) }); if (!r.ok && r.status !== 404) throw new Error('GitHub ' + r.status); },
    async list(p) { const r = await g.get(p); return Array.isArray(r) ? r : []; }
  };
  return g;
}
async function publish({ jars, key, privPem, gh, prevVersion = 0, note = '', onProgress = () => {}, partSize = 30 * 1024 * 1024 }) {
  const container = buildContainer(jars, key), parts = split(container, partSize), version = prevVersion + 1, mp = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress(i, parts.length); const n = `v${version}/p${String(i + 1).padStart(3, '0')}`;
    await gh.put(`updates/${n}`, parts[i], `Mods v${version} (${i + 1}/${parts.length})`); mp.push({ n, h: sha256(parts[i]), z: parts[i].length });
  }
  const meta = Buffer.from(JSON.stringify({ version, note, time: new Date().toISOString(), parts: mp, total: container.length, sha256: sha256(container) }));
  await gh.put('updates/pack.json', meta, `Publicar mods v${version}`);
  await gh.put('updates/pack.json.sig', Buffer.from(sign(meta, privPem)), `Firma v${version}`);
  if (version > 1) for (const f of await gh.list(`updates/v${version - 1}`)) await gh.del(f.path, f.sha, 'Limpiar versión anterior').catch(() => {});
  return { version, parts: parts.length, container };
}
async function fetchMeta(rawBase, pubB64) {
  const [mr, sr] = await Promise.all([fetch(rawBase + 'pack.json', { cache: 'no-store' }), fetch(rawBase + 'pack.json.sig', { cache: 'no-store' })]);
  if (!mr.ok || !sr.ok) return null;
  const mb = Buffer.from(await mr.arrayBuffer());
  if (!verify(mb, await sr.text(), pubB64)) throw new Error('La firma de la actualización no es válida. No se instaló nada.');
  return JSON.parse(mb.toString('utf8'));
}
async function downloadPack(rawBase, meta, onProgress = () => {}) {
  const bufs = [];
  for (let i = 0; i < meta.parts.length; i++) {
    const p = meta.parts[i]; if (!/^v\d+\/p\d{3}$/.test(p.n)) throw new Error('Actualización con partes no válidas.');
    const r = await fetch(rawBase + p.n, { cache: 'no-store' }); if (!r.ok) throw new Error('No se pudo descargar la actualización (' + r.status + ').');
    const b = Buffer.from(await r.arrayBuffer()); if (sha256(b) !== p.h) throw new Error('Una parte de la actualización llegó dañada.');
    bufs.push(b); onProgress(i + 1, meta.parts.length);
  }
  const all = Buffer.concat(bufs); if (sha256(all) !== meta.sha256) throw new Error('La actualización llegó dañada.');
  return all;
}
module.exports = { buildContainer, split, sign, verify, github, publish, fetchMeta, downloadPack, sha256 };
