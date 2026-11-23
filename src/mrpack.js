// Lector de modpacks de Modrinth (.mrpack). Sin dependencias: un .mrpack es un zip con modrinth.index.json + overrides/.
const zlib = require('zlib'), crypto = require('crypto'), path = require('path');
const MAX_ENTRIES = 20000, MAX_FILE = 400 * 1024 * 1024, MAX_TOTAL = 1500 * 1024 * 1024;
const BAD_EXT = /\.(exe|dll|bat|cmd|com|scr|ps1|vbs|msi|lnk|sh|jar\.disabled|js|jse|wsf|hta|reg)$/i;

function readZip(buf) {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Ese archivo no es un .mrpack válido (no es un zip).');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  if (n > MAX_ENTRIES) throw new Error('El .mrpack tiene demasiados archivos.');
  const entries = new Map(); let total = 0;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('El .mrpack está dañado.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nl); p += 46 + nl + el + cl;
    if (name.endsWith('/')) continue;
    if (usize > MAX_FILE) throw new Error('El .mrpack contiene un archivo demasiado grande.');
    total += usize; if (total > MAX_TOTAL) throw new Error('El .mrpack es demasiado grande.');
    entries.set(name, { method, csize, usize, off });
  }
  return { names: [...entries.keys()], read(name) {
    const m = entries.get(name); if (!m) return null;
    if (buf.readUInt32LE(m.off) !== 0x04034b50) throw new Error('El .mrpack está dañado.');
    const start = m.off + 30 + buf.readUInt16LE(m.off + 26) + buf.readUInt16LE(m.off + 28), raw = buf.subarray(start, start + m.csize);
    const out = m.method === 0 ? raw : m.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_FILE }) : null;
    if (!out) throw new Error('El .mrpack usa una compresión no soportada.');
    if (out.length !== m.usize) throw new Error('El .mrpack está dañado.');
    return out;
  } };
}

// Ruta relativa segura dentro de la carpeta del juego (nada de "..", unidades ni rutas absolutas).
function safeRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0') || /^([a-z]:|\/)/i.test(p)) return null;
  const n = path.posix.normalize(p); if (n.startsWith('../') || n === '..' || n.startsWith('/') || n !== p.replace(/\/+/g, '/')) return null;
  return n;
}

function parse(zip, { minecraft }) {
  const raw = zip.read('modrinth.index.json'); if (!raw) throw new Error('Ese .mrpack no tiene modrinth.index.json.');
  let idx; try { idx = JSON.parse(raw.toString('utf8')); } catch { throw new Error('El modrinth.index.json está dañado.'); }
  if (idx.game !== 'minecraft' || !Array.isArray(idx.files)) throw new Error('Ese .mrpack no es de Minecraft.');
  const d = idx.dependencies || {};
  if (minecraft && d.minecraft && d.minecraft !== minecraft) throw new Error(`Ese modpack es para Minecraft ${d.minecraft} y el launcher usa ${minecraft}.`);
  if (!d['fabric-loader']) throw new Error('Ese modpack no es de Fabric (el launcher solo usa Fabric).');
  const files = [];
  for (const f of idx.files) {
    if (f.env && f.env.client === 'unsupported') continue;
    const rel = safeRel(f.path); if (!rel) throw new Error('El modpack trae una ruta no permitida: ' + String(f.path).slice(0, 60));
    if (BAD_EXT.test(rel)) throw new Error('El modpack trae un archivo no permitido: ' + rel);
    if (rel.startsWith('mods/') && (!/^mods\/[^/]+\.jar$/i.test(rel))) throw new Error('Mod con nombre no permitido: ' + rel);
    const sha1 = f.hashes && String(f.hashes.sha1 || '').toLowerCase(), sha512 = f.hashes && String(f.hashes.sha512 || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha1 || '')) throw new Error('Falta la huella sha1 de ' + rel);
    if (!Array.isArray(f.downloads) || !f.downloads.length) throw new Error('Sin enlace de descarga: ' + rel);
    files.push({ rel, sha1, sha512: /^[a-f0-9]{128}$/.test(sha512 || '') ? sha512 : '', urls: f.downloads.filter(u => typeof u === 'string') });
  }
  // archivos incluidos dentro del zip (overrides y client-overrides)
  const over = [];
  for (const pre of ['overrides/', 'client-overrides/']) for (const name of zip.names) {
    if (!name.startsWith(pre)) continue;
    const rel = safeRel(name.slice(pre.length)); if (!rel) throw new Error('El modpack trae una ruta no permitida: ' + name.slice(0, 60));
    if (BAD_EXT.test(rel)) throw new Error('El modpack trae un archivo no permitido: ' + rel);
    if (rel === 'options.txt' || rel === 'servers.dat') continue; // no pisar los ajustes de la persona
    over.push({ rel, name });
  }
  return { name: String(idx.name || 'Modpack').slice(0, 60), version: String(idx.versionId || '').slice(0, 40), files, over };
}

// Descarga cada archivo (solo hosts autorizados por https), comprueba sha1/sha512 y devuelve { jars:[Buffer], others:[{rel,data}] }.
async function fetchAll(pack, zip, { okHost, fetchBuf, onProgress = () => {} }) {
  const jars = [], others = []; let i = 0;
  for (const f of pack.files) {
    onProgress(i++, pack.files.length, f.rel);
    const url = f.urls.find(okHost); if (!url) throw new Error(`${f.rel}: la descarga no viene de un sitio autorizado.`);
    const data = await fetchBuf(url);
    if (crypto.createHash('sha1').update(data).digest('hex') !== f.sha1) throw new Error(`${f.rel} llegó dañado o fue modificado (sha1).`);
    if (f.sha512 && crypto.createHash('sha512').update(data).digest('hex') !== f.sha512) throw new Error(`${f.rel} llegó dañado o fue modificado (sha512).`);
    (f.rel.startsWith('mods/') ? jars : others).push(f.rel.startsWith('mods/') ? data : { rel: f.rel, data });
  }
  for (const o of pack.over) { const data = zip.read(o.name); if (!data) continue; if (/^mods\/[^/]+\.jar$/i.test(o.rel)) jars.push(data); else others.push({ rel: o.rel, data }); }
  return { jars, others };
}

module.exports = { readZip, parse, fetchAll, safeRel };
