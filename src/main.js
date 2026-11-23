const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, session, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), os = require('os'), net = require('net');
const { execFileSync } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { Presence } = require('./discord');
const PU = require('./packupdate');
const MRP = require('./mrpack');
let autoUpdater = null; try { autoUpdater = require('electron-updater').autoUpdater; } catch {}

app.enableSandbox();
app.setAppUserModelId('studio.sarex.launcher');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// Solo la ventana del launcher puede hablar con el proceso principal.
const trusted = e => { try { return e.senderFrame.url.startsWith('file://') && /\/src\/index\.html$/.test(e.senderFrame.url.split('?')[0]); } catch { return false; } };
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => trusted(e) ? fn(e, ...a) : Promise.reject(new Error('No autorizado')));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const ROOT = path.join(app.getPath('appData'), '.sarexstudio');
const SETTINGS = path.join(ROOT, 'launcher.json');
const SKIN_DIR = path.join(ROOT, 'skins');
const CSL_DIR = path.join(ROOT, 'CustomSkinLoader', 'LocalSkin', 'skins');
const MCACHE = path.join(ROOT, 'manifest.cache.json');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const EULA_VER = '2026-11';
let LOCAL_CODES = { salt: '', hashes: [] }; try { LOCAL_CODES = JSON.parse(fs.readFileSync(path.join(__dirname, 'codes.json'), 'utf8')); } catch {}
let win, splash, tray, retry = null, presence = null, hiddenToTray = false, busy = false, manifest = null, memToken = null;

// ---------- Utilidades de seguridad ----------
const okUrl = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const okHost = u => okUrl(u) && (CFG.allowedHosts || []).includes(new URL(u).hostname);
const okPlayer = n => /^[A-Za-z0-9_]{3,16}$/.test(n || '');
const okJar = f => typeof f === 'string' && f === path.basename(f) && /^[\w.+\-() \[\]]+\.jar$/i.test(f);
const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const sha1b = b => crypto.createHash('sha1').update(b).digest('hex');
const dataUrl = b => 'data:image/png;base64,' + b.toString('base64');
const validSkin = b => b.length > 24 && b.length < 200 * 1024 && b.readUInt32BE(0) === 0x89504e47 &&
  b.readUInt32BE(16) === 64 && (b.readUInt32BE(20) === 64 || b.readUInt32BE(20) === 32);

// La sesión de Microsoft nunca se guarda en texto plano: se cifra con el sistema (DPAPI en Windows).
const enc = t => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t).toString('base64') : null;
const dec = e => safeStorage.decryptString(Buffer.from(e, 'base64'));

function saveSettings(s) { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); }
function readSettings() {
  let s; try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { s = { ram: 4 }; }
  if (s.account && s.account.token) { // migrar versiones anteriores que guardaban el token sin cifrar
    const e = enc(s.account.token); delete s.account.token;
    if (e) s.account.enc = e; else delete s.account;
    saveSettings(s);
  }
  return s;
}
const send = (ch, d) => win && !win.isDestroyed() && win.webContents.send(ch, d);
const status = (text, pct) => send('progress', { text, pct });

async function download(url, dest, onBytes) {
  if (!okUrl(url)) throw new Error('Enlace no seguro (debe ser https): ' + url);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`No se pudo descargar (${r.status}): ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const total = +r.headers.get('content-length') || 0; let got = 0;
  const ws = fs.createWriteStream(dest), rd = r.body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; ws.write(value); got += value.length; onBytes && onBytes(got, total); }
  await new Promise(res => ws.end(res));
}

function verifySig(buf, sig) {
  try { return crypto.verify(null, buf, crypto.createPublicKey({ key: Buffer.from(CFG.publicKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(String(sig).trim(), 'base64')); }
  catch { return false; }
}
async function loadManifest() {
  const signed = !!CFG.publicKey;
  try {
    const r = await fetch(CFG.manifestUrl, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const buf = Buffer.from(await r.arrayBuffer()); let sig = '';
    if (signed) {
      const rs = await fetch(CFG.manifestUrl + '.sig', { cache: 'no-store' }); sig = rs.ok ? await rs.text() : '';
      if (!verifySig(buf, sig)) { manifest = { mods: [], news: [], ads: [], skins: [], _sigFail: true, _signed: true }; return manifest; }
    }
    manifest = JSON.parse(buf.toString('utf8')); manifest._signed = signed;
    fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(MCACHE, JSON.stringify({ text: buf.toString('base64'), sig }));
  } catch {
    try {
      const c = JSON.parse(fs.readFileSync(MCACHE, 'utf8')), buf = Buffer.from(c.text, 'base64');
      if (signed && !verifySig(buf, c.sig)) throw 0;
      manifest = JSON.parse(buf.toString('utf8')); manifest._signed = signed; manifest._offline = true; manifest._cached = true;
    } catch {
      manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.local.json'), 'utf8')); manifest._offline = true;
    }
  }
  return manifest;
}

// ---------- Java 21 (con verificación SHA-256) ----------
function findJava(dir) {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const f = walk(p); if (f) return f; }
    else if (e.name === exe && path.basename(d) === 'bin') return p; } };
  return fs.existsSync(dir) ? walk(dir) : null;
}
async function ensureJava() {
  const dir = path.join(ROOT, 'runtime');
  let j = findJava(dir); if (j) return j;
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const meta = await (await fetch(`https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`)).json();
  const pkg = meta[0].binary.package;
  const file = path.join(ROOT, pkg.name);
  await download(pkg.link, file, (g, t) => status('Descargando Java 21', t ? g / t * 0.4 : 0));
  const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (h !== pkg.checksum) { fs.unlinkSync(file); throw new Error('La descarga de Java llegó dañada. Inténtalo de nuevo.'); }
  status('Instalando Java 21', 0.4); fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xf', file, '-C', dir]); fs.unlinkSync(file);
  j = findJava(dir); if (!j) throw new Error('No se pudo instalar Java 21.');
  if (process.platform !== 'win32') fs.chmodSync(j, 0o755);
  return j;
}

// ---------- Fabric ----------
const mavenPath = n => { const [g, a, v] = n.split(':'); return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}.jar`; };
async function ensureFabric() {
  const s = readSettings(); let profile;
  try {
    const list = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${CFG.minecraft}`)).json();
    const loader = (list.find(l => l.loader.stable) || list[0]).loader.version;
    profile = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${CFG.minecraft}/${loader}/profile/json`)).json();
  } catch (e) {
    if (s.fabricId && fs.existsSync(path.join(ROOT, 'versions', s.fabricId, s.fabricId + '.json'))) return s.fabricId;
    throw new Error('No hay conexión para descargar Fabric.');
  }
  const id = profile.id, vdir = path.join(ROOT, 'versions', id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, id + '.json'), JSON.stringify(profile, null, 2));
  const libs = profile.libraries.filter(l => l.url);
  for (let i = 0; i < libs.length; i++) {
    const L = libs[i], rel = mavenPath(L.name), dest = path.join(ROOT, 'libraries', rel);
    status('Instalando Fabric', i / libs.length);
    if (!fs.existsSync(dest) || (L.sha1 && sha1(dest) !== L.sha1)) {
      await download(L.url.replace(/\/?$/, '/') + rel, dest);
      if (L.sha1 && sha1(dest) !== L.sha1) { fs.unlinkSync(dest); throw new Error(`La librería ${L.name} llegó dañada.`); }
    }
  }
  saveSettings({ ...readSettings(), fabricId: id });
  return id;
}

// ---------- Mods automáticos (mod de skins + Fabric API, desde Modrinth con huella verificada) ----------
const AUTO_CACHE = path.join(ROOT, 'auto-mods.json'); let autoList = [];
const MR = 'https://api.modrinth.com/v2', UA = { 'User-Agent': 'SarexStudio-Launcher/4.2' };
async function mrVersion(id) {
  const q = `${MR}/project/${id}/version?game_versions=${encodeURIComponent(JSON.stringify([CFG.minecraft]))}&loaders=${encodeURIComponent(JSON.stringify(['fabric']))}`;
  const r = await fetch(q, { headers: UA, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error('Modrinth ' + r.status);
  const l = await r.json(); return l.find(v => v.version_type === 'release') || l[0];
}
async function resolveAuto() {
  const out = new Map(), seen = new Set();
  const visit = async (id, d) => {
    if (seen.has(id) || d > 2) return; seen.add(id);
    const v = await mrVersion(id); if (!v) return;
    const f = v.files.find(x => x.primary) || v.files[0];
    if (f && okJar(f.filename) && /^[a-f0-9]{40}$/i.test(f.hashes.sha1) && okHost(f.url)) out.set(f.filename, { file: f.filename, url: f.url, sha1: f.hashes.sha1, auto: true });
    for (const dep of v.dependencies || []) if (dep.dependency_type === 'required' && dep.project_id) await visit(dep.project_id, d + 1);
  };
  for (const id of ['customskinloader', 'fabric-api']) await visit(id, 0);
  return [...out.values()];
}
async function autoMods(mods) {
  try { autoList = await resolveAuto(); fs.writeFileSync(AUTO_CACHE, JSON.stringify(autoList)); }
  catch { try { autoList = JSON.parse(fs.readFileSync(AUTO_CACHE, 'utf8')); } catch { autoList = []; } }
  const have = f => mods.some(m => m.file.toLowerCase().includes(f));
  autoList = autoList.filter(m => okJar(m.file) && okHost(m.url) && /^[a-f0-9]{40}$/i.test(m.sha1) &&
    !(have('customskinloader') && /customskinloader/i.test(m.file)) && !(have('fabric-api') && /^fabric-api/i.test(m.file)));
  return autoList;
}

// ---------- Mods (nombre válido, https y sha1 obligatorios) ----------
async function syncMods(quiet) {
  const dir = path.join(ROOT, 'mods'); fs.mkdirSync(dir, { recursive: true });
  const mods = manifest.mods || [];
  for (const m of mods) if (!okJar(m.file) || !okHost(m.url) || !/^[a-f0-9]{40}$/i.test(m.sha1 || ''))
    throw new Error(`Mod rechazado (${m.file}): debe ser .jar, venir de un sitio autorizado por https y tener sha1.`);
  const all = [...mods, ...(CFG.autoMods === false ? [] : await autoMods(mods))];
  for (let i = 0; i < all.length; i++) {
    const m = all[i], dest = path.join(dir, m.file);
    if (!quiet) status(`Mods ${i + 1}/${all.length}: ${m.file}`, i / Math.max(all.length, 1));
    if (fs.existsSync(dest) && sha1(dest) === m.sha1.toLowerCase()) continue;
    await download(m.url, dest, (g, t) => t && !quiet && status(`Mods ${i + 1}/${all.length}: ${m.file}`, (i + g / t) / all.length));
    if (sha1(dest) !== m.sha1.toLowerCase()) { fs.unlinkSync(dest); throw new Error(`El mod ${m.file} llegó dañado o fue modificado.`); }
  }
  if (manifest.strict) {
    const keep = new Set(all.map(m => m.file));
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jar') && !keep.has(f) && !BUNDLED_RE.test(f)) fs.unlinkSync(path.join(dir, f));
  }
}

// ---------- Skins (premium y no premium) ----------
async function premiumSkin(name) {
  if (!okPlayer(name)) throw new Error('Nombre no válido.');
  const p = await fetch(`https://api.mojang.com/users/profiles/minecraft/${name}`);
  if (p.status === 204 || p.status === 404) throw new Error('Ese jugador premium no existe.');
  if (!p.ok) throw new Error('Mojang no respondió. Prueba en un momento.');
  const { id } = await p.json();
  const s = await (await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`)).json();
  const tex = JSON.parse(Buffer.from(s.properties.find(x => x.name === 'textures').value, 'base64').toString());
  const sk = tex.textures && tex.textures.SKIN;
  if (!sk || !sk.url.startsWith('https://textures.minecraft.net/')) throw new Error('Ese jugador no tiene skin propia.');
  const b = Buffer.from(await (await fetch(sk.url)).arrayBuffer());
  if (!validSkin(b)) throw new Error('Skin no compatible.');
  return { data: dataUrl(b), slim: !!(sk.metadata && sk.metadata.model === 'slim') };
}
async function fetchPng(url) {
  if (!okHost(url)) throw new Error('Enlace no autorizado');
  const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(r.status);
  const b = Buffer.from(await r.arrayBuffer()); if (!validSkin(b)) throw new Error('Skin no válida');
  return b;
}
async function syncSkins(name) { // deja las skins de todos los amigos donde CustomSkinLoader las lee
  fs.mkdirSync(CSL_DIR, { recursive: true });
  for (const s of (manifest.skins || []).slice(0, 60)) {
    if (!okPlayer(s.player)) continue;
    try { fs.writeFileSync(path.join(CSL_DIR, s.player + '.png'), await fetchPng(s.url)); } catch {}
  }
  const mine = path.join(SKIN_DIR, 'mine.png');
  if (okPlayer(name) && fs.existsSync(mine)) fs.copyFileSync(mine, path.join(CSL_DIR, name + '.png'));
}

// ---------- Códigos de acceso (6 dígitos, un solo uso) ----------
const codeUrl = () => CFG.codes && okUrl(CFG.codes.url) ? CFG.codes.url : '';
const accessRequired = () => !!(CFG.codes && CFG.codes.required !== false && (codeUrl() || LOCAL_CODES.hashes.length));
let sessionAccess = false; // el acceso vale solo mientras el launcher está abierto: hay que escribir el código cada vez que se entra
const accessOk = () => !accessRequired() || sessionAccess;
// Identificador del PC: sale del MachineGuid de Windows (no se puede "copiar" copiando settings.json a otro PC).
function machineId(s) {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const m = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(out);
    if (m) return crypto.createHash('sha256').update('sarex-device:' + m[1].toLowerCase()).digest('hex');
  } catch {}
  return crypto.createHash('sha256').update('sarex-fallback:' + os.hostname() + os.userInfo().username + (os.cpus()[0] || {}).model + os.totalmem()).digest('hex');
}
handle('code-redeem', async (_e, code) => {
  code = String(code || '').trim(); if (!/^\d{6}$/.test(code)) return { ok: false, error: 'El código tiene 6 números.' };
  const s = readSettings(), device = machineId(s), now = Date.now();
  if ((s.codeLock || 0) > now) return { ok: false, error: 'Demasiados intentos. Prueba en unos minutos.' };
  let good = false, newKey = null;
  if (codeUrl()) {
    try {
      const r = await fetch(codeUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, device }), signal: AbortSignal.timeout(9000) });
      if (r.status === 429) return { ok: false, error: 'Demasiados intentos. Prueba en una hora.' };
      const j = await r.json(); if (j.ok) { good = true; if (/^[a-f0-9]{64}$/.test(j.key || '') && safeStorage.isEncryptionAvailable()) newKey = enc(j.key); } else return { ok: false, error: j.error === 'usado' ? 'Este código ya fue usado.' : 'Código no válido.' };
    } catch { return { ok: false, error: 'No se pudo verificar el código. Revisa tu conexión.' }; }
  } else good = LOCAL_CODES.hashes.includes(crypto.createHash('sha256').update(LOCAL_CODES.salt + code).digest('hex'));
  if (!good) { const f = (s.codeFails || 0) + 1; saveSettings({ ...s, deviceId: device, codeFails: f >= 8 ? 0 : f, codeLock: f >= 8 ? now + 10 * 60 * 1000 : 0 }); return { ok: false, error: 'Código no válido.' }; }
  saveSettings({ ...s, deviceId: device, codeFails: 0, codeLock: 0, ...(newKey ? { modKey: newKey } : {}), access: undefined }); sessionAccess = true; return { ok: true };
});

// ---------- Estado de Discord ----------
const activity = () => ({ details: `Jugando SarexSafio ${CFG.edition || '1'}`, state: `Minecraft ${CFG.minecraft} con Fabric`, timestamps: { start: Date.now() },
  assets: { large_image: 'logo', large_text: 'Sarex Studio' },
  ...(okUrl(CFG.discord.invite) ? { buttons: [{ label: 'Unirse al Discord', url: CFG.discord.invite }] } : {}) });
async function startPresence() {
  const rpc = new Presence(CFG.discord.clientId);
  if (!(await rpc.connect())) { rpc.close(); return false; }
  rpc.set(activity()); presence = rpc; return true;
}
const WHY = { id: 'Falta el ID de la aplicación de Discord en config.json.', cerrado: 'No encuentro Discord abierto en este PC. Abre la app de Discord (no el navegador) y reintenta.', sinrespuesta: 'Discord no respondió. Ciérralo por completo y ábrelo otra vez.' };
handle('discord-test', async () => {
  if (!CFG.discord || !CFG.discord.clientId) return { ok: false, error: WHY.id };
  if (readSettings().discord === false) return { ok: false, error: 'Tienes el estado apagado en Ajustes.' };
  const rpc = new Presence(CFG.discord.clientId);
  if (!(await rpc.connect())) { const r = rpc.reason; rpc.close(); return { ok: false, error: WHY[r] || 'No se pudo conectar con Discord.' }; }
  rpc.set(activity()); setTimeout(() => rpc.close(), 20000); return { ok: true };
});

// ---------- Cuenta ----------
async function getAuth() {
  const s = readSettings(), a = s.account;
  if (a && a.type === 'ms') {
    const token = memToken || (a.enc ? dec(a.enc) : null);
    if (!token) throw new Error('Vuelve a iniciar sesión con Microsoft.');
    const mc = await (await new Auth('select_account').refresh(token)).getMinecraft();
    return mc.mclc();
  }
  if (a && a.type === 'offline') return Authenticator.getAuth(a.name);
  throw new Error('Inicia sesión primero.');
}

function ensurePack() { // logo "Sarex Studio" en la pantalla de carga (requiere el mod Puzzle)
  const dir = path.join(ROOT, 'resourcepacks'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SarexStudio-Pack.zip'), fs.readFileSync(path.join(__dirname, '..', 'assets', 'SarexStudio-Pack.zip')));
  const f = path.join(ROOT, 'options.txt'); let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch {}
  const entry = 'file/SarexStudio-Pack.zip', m = t.match(/^resourcePacks:(\[.*\])\s*$/m);
  if (m) { try { const arr = JSON.parse(m[1]); if (!arr.includes(entry)) { arr.push(entry); t = t.replace(m[0], 'resourcePacks:' + JSON.stringify(arr)); } } catch {} }
  else t += (t && !t.endsWith('\n') ? '\n' : '') + `resourcePacks:["vanilla","${entry}"]\n`;
  fs.writeFileSync(f, t);
}
// ---------- Mods incluidos en el launcher (un solo archivo cifrado; solo se abren al jugar) ----------
const PACK_BUNDLED = path.join(__dirname, 'modpack.dat'), PACK_DL = path.join(ROOT, 'pack', 'modpack.dat'), BUNDLED_RE = /^sx-[a-f0-9]{12}\.jar$/;
const packFile = () => fs.existsSync(PACK_DL) ? PACK_DL : PACK_BUNDLED;   // la descargada (más nueva) manda sobre la del instalador
const hasBundle = () => { try { return fs.statSync(packFile()).size > 64; } catch { return false; } };
function modKey() {
  try { const s = readSettings(); if (s.modKey && safeStorage.isEncryptionAvailable()) return Buffer.from(dec(s.modKey), 'hex'); } catch {}
  try { return Buffer.from(JSON.parse(fs.readFileSync(path.join(__dirname, 'modkey.json'), 'utf8')).key, 'hex'); } catch {}
  return null;
}
function decryptMod(buf, key) { const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([d.update(buf.subarray(28)), d.final()]); }
function prepareBundled() {
  if (!hasBundle()) return;
  const key = modKey(); if (!key) throw new Error('NEED_CODE');
  const buf = fs.readFileSync(packFile()); let idx, base;
  try { if (buf.toString('latin1', 0, 4) !== 'SXP1') throw 0; const il = buf.readUInt32LE(4); idx = JSON.parse(decryptMod(buf.subarray(8, 8 + il), key).toString()); base = 8 + il; } catch { throw new Error('NEED_CODE'); }
  const dir = path.join(ROOT, 'mods'); fs.mkdirSync(dir, { recursive: true });
  for (const m of idx) {
    const dest = path.join(dir, `sx-${m.s.slice(0, 12)}.jar`); if (fs.existsSync(dest) && sha1(dest) === m.s) continue;
    let plain; try { plain = decryptMod(buf.subarray(base + m.o, base + m.o + m.l), key); } catch { throw new Error('NEED_CODE'); }
    if (sha1b(plain) !== m.s) throw new Error('Los mods incluidos no pasaron la verificación.');
    try { fs.unlinkSync(dest); } catch {} fs.writeFileSync(dest, plain);
    if (process.platform === 'win32') try { execFileSync('attrib', ['+H', dest]); } catch {}
  }
}
function cleanBundled() { try { for (const f of fs.readdirSync(path.join(ROOT, 'mods'))) if (BUNDLED_RE.test(f)) try { fs.unlinkSync(path.join(ROOT, 'mods', f)); } catch {} } catch {} }

// ---------- Actualización de mods para todos (paquete cifrado y FIRMADO en GitHub) ----------
const rawBase = () => CFG.updates && /^[\w.-]+\/[\w.-]+$/.test(CFG.updates.repo || '') ? `https://raw.githubusercontent.com/${CFG.updates.repo}/${CFG.updates.branch || 'main'}/updates/` : '';
const updatesOn = () => !!(rawBase() && CFG.publicKey);
let remoteMeta = null;
async function checkPack() {
  if (!updatesOn()) return { enabled: false };
  try {
    const m = await PU.fetchMeta(rawBase(), CFG.publicKey); if (!m) return { enabled: true, available: false };
    remoteMeta = m; const cur = readSettings().packVersion || 0;
    return { enabled: true, available: m.version > cur, version: m.version, note: m.note || '', current: cur };
  } catch (e) { return { enabled: true, available: false, error: e.message, tamper: /firma/i.test(e.message) }; }
}
async function applyPack() {
  const m = remoteMeta || await PU.fetchMeta(rawBase(), CFG.publicKey); if (!m) throw new Error('No hay actualización disponible.');
  const all = await PU.downloadPack(rawBase(), m, (i, n) => status(`Actualizando mods ${i}/${n}`, i / n));
  fs.mkdirSync(path.dirname(PACK_DL), { recursive: true }); fs.writeFileSync(PACK_DL + '.tmp', all); fs.renameSync(PACK_DL + '.tmp', PACK_DL);
  cleanBundled(); saveSettings({ ...readSettings(), packVersion: m.version });
}
handle('pack-check', () => checkPack());
handle('pack-update', () => guard(async () => { const c = await checkPack(); if (c.tamper) throw new Error(c.error); await applyPack(); status('Mods al día', 1); }));
handle('admin-state', () => { const s = readSettings(); return { hasToken: !!s.ghToken, hasSign: !!s.signKey, version: s.packVersion || 0, repo: (CFG.updates && CFG.updates.repo) || '', ready: updatesOn() }; });
handle('admin-token', (_e, tok) => {
  if (adminUntil < Date.now()) return { ok: false, error: 'Desbloquea el modo administrador primero.' };
  tok = String(tok || '').trim(); if (!/^[\w-]{20,255}$/.test(tok)) return { ok: false, error: 'Ese token no parece válido.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Este equipo no puede guardar secretos cifrados.' };
  saveSettings({ ...readSettings(), ghToken: enc(tok) }); return { ok: true };
});
handle('admin-signkey', async () => {
  if (adminUntil < Date.now()) return { ok: false, error: 'Desbloquea el modo administrador primero.' };
  const r = await dialog.showOpenDialog(win, { title: 'Elige tu sarex-private.pem', filters: [{ name: 'Llave', extensions: ['pem'] }], properties: ['openFile'] });
  if (r.canceled) return { ok: false, canceled: true };
  let pem; try { pem = fs.readFileSync(r.filePaths[0], 'utf8'); const pub = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');
    if (CFG.publicKey && pub !== CFG.publicKey) return { ok: false, error: 'Esa llave no coincide con la publicKey de config.json.' }; } catch { return { ok: false, error: 'Ese archivo no es una llave válida.' }; }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Este equipo no puede guardar secretos cifrados.' };
  saveSettings({ ...readSettings(), signKey: enc(pem) }); return { ok: true };
});
handle('pack-publish', (_e, note) => guard(async () => {
  if (adminUntil < Date.now()) throw new Error('Desbloquea el modo administrador primero.');
  const s = readSettings(); if (!s.ghToken || !s.signKey) throw new Error('Falta guardar el token de GitHub y la llave de firma (botones de abajo).');
  if (!updatesOn()) throw new Error('Falta updates.repo y publicKey en config.json.');
  const key = modKey(); if (!key) throw new Error('Falta la clave de los mods. Cierra el launcher, ábrelo y escribe un código de acceso (el servidor debe tener MODKEY).');
  const r = await dialog.showOpenDialog(win, { title: 'Elige la carpeta con tus mods (.jar)', properties: ['openDirectory'] }); if (r.canceled) throw new Error('Publicación cancelada.');
  const files = fs.readdirSync(r.filePaths[0]).filter(f => f.toLowerCase().endsWith('.jar')); if (!files.length) throw new Error('Esa carpeta no tiene archivos .jar.');
  const jars = files.map(f => fs.readFileSync(path.join(r.filePaths[0], f)));
  let prev = s.packVersion || 0; try { const m = await PU.fetchMeta(rawBase(), CFG.publicKey); if (m) prev = Math.max(prev, m.version); } catch {}
  const out = await PU.publish({ jars, key, privPem: dec(s.signKey), gh: PU.github(CFG.updates.repo, dec(s.ghToken)), prevVersion: prev, note: String(note || '').slice(0, 120), onProgress: (i, n) => status(`Publicando ${i + 1}/${n}`, i / n) });
  fs.mkdirSync(path.dirname(PACK_DL), { recursive: true }); fs.writeFileSync(PACK_DL, out.container); cleanBundled();
  saveSettings({ ...readSettings(), packVersion: out.version }); status(`Versión ${out.version} publicada. Los jugadores la recibirán en unos minutos.`, 1);
}));
// ---------- Cargar un .mrpack en SarexSafio (y publicarlo para todos si ya está configurado) ----------
async function fetchBuf(url) {
  if (!okUrl(url)) throw new Error('Enlace no seguro (debe ser https): ' + url);
  const r = await fetch(url, { redirect: 'follow', headers: UA }); if (!r.ok) throw new Error(`No se pudo descargar (${r.status}): ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
handle('mrpack-import', (_e, dropped) => guard(async () => {
  if (adminUntil < Date.now()) throw new Error('Desbloquea el modo administrador primero.');
  const key = modKey(); if (!key) throw new Error('Falta la clave de los mods. Cierra el launcher, ábrelo y escribe un código de acceso (el servidor debe tener MODKEY).');
  let file = typeof dropped === 'string' && path.isAbsolute(dropped) && /\.mrpack$/i.test(dropped) && fs.existsSync(dropped) ? dropped : null;
  if (!file) { const r = await dialog.showOpenDialog(win, { title: 'Elige tu modpack (.mrpack)', filters: [{ name: 'Modpack de Modrinth', extensions: ['mrpack'] }], properties: ['openFile'] }); if (r.canceled) throw new Error('Cancelado.'); file = r.filePaths[0]; }
  status('Leyendo el modpack…', 0.02);
  const zip = MRP.readZip(fs.readFileSync(file)), pack = MRP.parse(zip, { minecraft: CFG.minecraft });
  const { jars, others } = await MRP.fetchAll(pack, zip, { okHost, fetchBuf, onProgress: (i, n, f) => status(`Descargando ${i + 1}/${n}: ${f.replace(/^mods\//, '')}`, 0.05 + 0.8 * i / Math.max(n, 1)) });
  if (!jars.length) throw new Error('Ese modpack no trae mods (.jar).');
  status('Guardando en SarexSafio…', 0.9);
  for (const o of others) { const dest = path.join(ROOT, ...o.rel.split('/')); if (!dest.startsWith(ROOT + path.sep)) continue; fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, o.data); }
  const s = readSettings(), canPublish = !!(s.ghToken && s.signKey && updatesOn());
  fs.mkdirSync(path.dirname(PACK_DL), { recursive: true });
  let publish = false;
  if (canPublish) { const c = await dialog.showMessageBox(win, { type: 'question', buttons: ['Publicar para todos', 'Solo en este PC'], defaultId: 0, cancelId: 1, title: 'Cargar modpack', message: `${pack.name}: ${jars.length} mods listos.`, detail: '¿Quieres que todos los jugadores reciban esta actualización?' }); publish = c.response === 0; }
  if (publish) {
    let prev = s.packVersion || 0; try { const m = await PU.fetchMeta(rawBase(), CFG.publicKey); if (m) prev = Math.max(prev, m.version); } catch {}
    const out = await PU.publish({ jars, key, privPem: dec(s.signKey), gh: PU.github(CFG.updates.repo, dec(s.ghToken)), prevVersion: prev, note: `${pack.name} ${pack.version}`.trim().slice(0, 120), onProgress: (i, n) => status(`Publicando ${i + 1}/${n}`, 0.9 + 0.1 * i / n) });
    fs.writeFileSync(PACK_DL, out.container); saveSettings({ ...readSettings(), packVersion: out.version });
    status(`Listo: ${jars.length} mods en SarexSafio y publicados para todos (versión ${out.version}).`, 1);
  } else {
    fs.writeFileSync(PACK_DL, PU.buildContainer(jars, key));
    status(`Listo: ${jars.length} mods cargados en SarexSafio` + (canPublish ? ' (solo en este PC).' : '. Para publicarlos a todos falta guardar el token de GitHub y la llave de firma.'), 1);
  }
  cleanBundled();
}));
// ---------- Actualización del propio launcher (GitHub Releases) ----------
function initUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', i => send('app-update', { version: i.version })); autoUpdater.on('error', () => {});
  const chk = () => autoUpdater.checkForUpdates().catch(() => {}); chk(); setInterval(chk, 30 * 60 * 1000);
}
handle('app-update-install', () => { if (autoUpdater) autoUpdater.quitAndInstall(); return true; });

// ---------- Vigilancia de mods: si se borra o cambia uno, se restaura solo ----------
let modWatcher = null, modTimer = null;
function watchMods() {
  if (modWatcher) return;
  try { modWatcher = fs.watch(path.join(ROOT, 'mods'), () => { clearTimeout(modTimer); modTimer = setTimeout(async () => {
    if (busy || !manifest || manifest._sigFail || (manifest._offline && !manifest._cached)) return;
    try { await syncMods(true); send('mods-restored'); } catch {} }, 2500); }); } catch {}
}
// ---------- Código de administrador (carpeta de mods y del juego) ----------
let adminUntil = 0;
const adminSet = () => !!(CFG.admin && /^[a-f0-9]{32}$/.test(CFG.admin.salt || '') && /^[a-f0-9]{64}$/.test(CFG.admin.hash || ''));
handle('admin-unlock', (_e, code) => {
  if (!adminSet()) return { ok: false, error: 'Aún no hay código de administrador. Créalo con tools/set-admin-pin.js.' };
  const s = readSettings(), now = Date.now();
  if ((s.adminLock || 0) > now) return { ok: false, error: 'Demasiados intentos. Prueba en unos minutos.' };
  let ok = false;
  try { const h = crypto.scryptSync(String(code || ''), Buffer.from(CFG.admin.salt, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    ok = crypto.timingSafeEqual(h, Buffer.from(CFG.admin.hash, 'hex')); } catch {}
  if (!ok) { const f = (s.adminFails || 0) + 1; saveSettings({ ...s, adminFails: f >= 5 ? 0 : f, adminLock: f >= 5 ? now + 15 * 60 * 1000 : 0 }); return { ok: false, error: 'Código incorrecto.' }; }
  adminUntil = now + 10 * 60 * 1000; saveSettings({ ...s, adminFails: 0, adminLock: 0 }); return { ok: true };
});
handle('admin-folder', (_e, which) => {
  if (adminUntil < Date.now()) return { ok: false };
  shell.openPath(which === 'game' ? ROOT : path.join(ROOT, 'mods')); return { ok: true };
});
handle('open-shots', () => { const d = path.join(ROOT, 'screenshots'); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return true; });
async function install() {
  if (!accessOk()) throw new Error('NEED_CODE');
  if (manifest._sigFail) throw new Error('La lista de mods no tiene una firma válida. Por seguridad no se instaló nada. Avisa a Sarex Studio.');
  const java = await ensureJava();
  const fabric = await ensureFabric();
  if (!(manifest._offline && !manifest._cached)) { await syncMods(); watchMods(); } // sin conexión ni caché: no se toca nada
  ensurePack();
  return { java, fabric };
}
async function guard(fn) {
  if (busy) return { ok: false, error: 'Ya hay una tarea en curso.' };
  busy = true; send('busy', true);
  try { await fn(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { busy = false; send('busy', false); }
}

handle('init', async () => {
  const m = await loadManifest(), s = readSettings(), a = s.account;
  const usable = a && (a.type === 'offline' || memToken || a.enc);
  return { cfg: { instances: CFG.instances || [], edition: CFG.edition || '1', minecraft: CFG.minecraft, server: CFG.server && CFG.server.host ? CFG.server : null },
    manifest: { packName: m.packName, news: m.news || [], ads: m.ads || [], mods: (m.mods || []).length, offline: !!m._offline, sigFail: !!m._sigFail },
    ram: s.ram || 4, opts: { private: !!s.private, closeOnPlay: s.closeOnPlay !== false, autoJoin: s.autoJoin !== false, discord: s.discord !== false, fx: s.fx !== false, sound: s.sound !== false },
    discord: { ready: !!(CFG.discord && CFG.discord.clientId), invite: okUrl(CFG.discord && CFG.discord.invite) ? CFG.discord.invite : '' },
    installed: s.installed || [],
    eula: !!(s.eula && s.eula.version === EULA_VER), access: accessOk(), theme: s.theme === 'black' ? 'black' : 'dark', stats: s.stats || { launches: 0, last: 0 },
    ram: s.ram || 4, sysRam: Math.round(os.totalmem() / 1073741824),
    account: usable ? { type: a.type, name: a.name } : null };
});
handle('eula-accept', () => { saveSettings({ ...readSettings(), eula: { version: EULA_VER, at: new Date().toISOString() } }); return true; });
handle('set-theme', (_e, t) => { if (!['dark', 'black'].includes(t)) return false; saveSettings({ ...readSettings(), theme: t }); return true; });
handle('login-ms', async () => {
  try {
    const xbox = await new Auth('select_account').launch('electron'), mc = await xbox.getMinecraft();
    const token = xbox.save(), name = mc.profile.name; memToken = token;
    saveSettings({ ...readSettings(), account: { type: 'ms', name, enc: enc(token) || undefined } });
    return { ok: true, name };
  } catch { return { ok: false, error: 'No se pudo iniciar sesión con Microsoft.' }; }
});
handle('login-offline', (_e, name) => {
  name = String(name || '').trim();
  if (!okPlayer(name)) return { ok: false, error: 'Usa 3 a 16 letras, números o guion bajo.' };
  memToken = null; saveSettings({ ...readSettings(), account: { type: 'offline', name } }); return { ok: true, name };
});
handle('logout', () => { memToken = null; const s = readSettings(); delete s.account; saveSettings(s); return true; });
handle('set-ram', (_e, gb) => { gb = Math.min(16, Math.max(2, parseInt(gb) || 4)); saveSettings({ ...readSettings(), ram: gb }); return true; });
handle('open-url', (_e, u) => okUrl(u) && shell.openExternal(u));

handle('skin-mine', async () => {
  const s = readSettings(), mine = path.join(SKIN_DIR, 'mine.png');
  if (fs.existsSync(mine)) return { data: dataUrl(fs.readFileSync(mine)), source: 'local' };
  if (s.account && s.account.type === 'ms') { try { const r = await premiumSkin(s.account.name); return { ...r, source: 'premium' }; } catch {} }
  return { data: null, source: 'default' };
});
handle('skin-lookup', async (_e, name) => { try { return { ok: true, ...(await premiumSkin(String(name).trim())) }; } catch (e) { return { ok: false, error: e.message }; } });
handle('skin-import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elige tu skin (.png)', filters: [{ name: 'Skin PNG', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled) return { ok: false, canceled: true };
  const f = r.filePaths[0];
  if (fs.statSync(f).size > 200 * 1024) return { ok: false, error: 'La skin pesa demasiado.' };
  const b = fs.readFileSync(f);
  if (!validSkin(b)) return { ok: false, error: 'La skin debe ser un PNG de 64x64 o 64x32.' };
  fs.mkdirSync(SKIN_DIR, { recursive: true }); fs.writeFileSync(path.join(SKIN_DIR, 'mine.png'), b);
  const acc = readSettings().account; if (acc && okPlayer(acc.name)) { fs.mkdirSync(CSL_DIR, { recursive: true }); fs.writeFileSync(path.join(CSL_DIR, acc.name + '.png'), b); }
  return { ok: true, data: dataUrl(b) };
});
handle('skin-status', () => { let ok = false; try { ok = fs.readdirSync(path.join(ROOT, 'mods')).some(f => /customskinloader/i.test(f)); } catch {} return { modInstalled: ok }; });
const varint = n => { const b = []; do { let t = n & 0x7f; n >>>= 7; if (n) t |= 0x80; b.push(t); } while (n); return Buffer.from(b); };
function pingServer(host, port) { // protocolo oficial "Server List Ping" de Minecraft
  return new Promise(res => {
    const t0 = Date.now(), s = net.createConnection({ host, port }); let buf = Buffer.alloc(0), done = false;
    const fin = v => { if (done) return; done = true; try { s.destroy(); } catch {} res(v); };
    s.setTimeout(4000, () => fin(null)); s.on('error', () => fin(null));
    s.on('connect', () => { const h = Buffer.from(host, 'utf8'), body = Buffer.concat([varint(0), varint(767), varint(h.length), h, Buffer.from([port >> 8, port & 255]), varint(1)]);
      s.write(Buffer.concat([varint(body.length), body])); s.write(Buffer.from([1, 0])); });
    s.on('data', d => { buf = Buffer.concat([buf, d]); try {
      let o = 0; const rv = () => { let r = 0, sh = 0, b; do { if (o >= buf.length) throw 0; b = buf[o++]; r |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80); return r; };
      const len = rv(); if (buf.length < o + len) return; rv(); const sl = rv(); if (buf.length < o + sl) return;
      const j = JSON.parse(buf.slice(o, o + sl).toString('utf8')); fin({ online: j.players && j.players.online, max: j.players && j.players.max, ping: Date.now() - t0 });
    } catch {} });
  });
}
handle('server-status', () => CFG.server && CFG.server.host ? pingServer(CFG.server.host, +CFG.server.port || 25565) : null);
handle('screens', () => {
  const d = path.join(ROOT, 'screenshots'); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => /\.png$/i.test(f)).map(f => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 24)
    .map(x => { try { return { name: x.f, t: x.t, data: nativeImage.createFromPath(path.join(d, x.f)).resize({ width: 360 }).toDataURL() }; } catch { return null; } }).filter(Boolean);
});
handle('screen-open', (_e, name) => { if (/^[\w .\-:+()\[\]]+\.png$/i.test(name || '') && name === path.basename(name)) shell.showItemInFolder(path.join(ROOT, 'screenshots', name)); return true; });
handle('skin-remove', () => {
  const a = readSettings().account;
  try { fs.unlinkSync(path.join(SKIN_DIR, 'mine.png')); } catch {}
  if (a && okPlayer(a.name)) try { fs.unlinkSync(path.join(CSL_DIR, a.name + '.png')); } catch {}
  return true;
});
handle('skin-gallery', async () => {
  const list = (manifest && manifest.skins || []).filter(s => okPlayer(s.player)).slice(0, 40);
  const res = await Promise.allSettled(list.map(async s => ({ player: s.player, data: dataUrl(await fetchPng(s.url)) })));
  return res.filter(r => r.status === 'fulfilled').map(r => r.value);
});

handle('set-opt', (_e, k, v) => { if (!['private', 'closeOnPlay', 'autoJoin', 'discord', 'fx', 'sound'].includes(k)) return false; saveSettings({ ...readSettings(), [k]: !!v }); return true; });
handle('security', () => ({
  adminSet: adminSet(), encrypted: safeStorage.isEncryptionAvailable(), signed: !!CFG.publicKey, sigFail: !!(manifest && manifest._sigFail),
  offline: !!(manifest && manifest._offline), strict: !!(manifest && manifest.strict), hosts: CFG.allowedHosts || [] }));
handle('mods-status', () => {
  const dir = path.join(ROOT, 'mods'); if (!autoList.length) { try { autoList = JSON.parse(fs.readFileSync(AUTO_CACHE, 'utf8')); } catch {} }
  const list = (manifest && manifest.mods || []).filter(m => okJar(m.file)).concat(autoList.filter(m => okJar(m.file)));
  const mods = list.map(m => { const p = path.join(dir, m.file); let st = 'missing';
    if (fs.existsSync(p)) st = m.sha1 && sha1(p) === String(m.sha1).toLowerCase() ? 'ok' : 'bad'; return { file: m.file, state: st }; });
  const known = new Set(list.map(m => m.file));
  const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jar') && !known.has(f)).length : 0;
  return { mods, extra, bundled: hasBundle(), offline: !!(manifest && manifest._offline) };
});
function redact(t) { // quita datos personales de un registro antes de compartirlo
  const a = readSettings().account;
  for (const w of [os.userInfo().username, os.hostname(), a && a.name]) if (w && w.length >= 3) t = t.split(w).join('[oculto]');
  return t
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[token]')
    .replace(/(--(?:accessToken|uuid|xuid|clientId)\s+)\S+/gi, '$1[oculto]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g, '[ip]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}\b/gi, '[id]');
}
handle('copy-safe-log', () => {
  const p = path.join(ROOT, 'logs', 'latest.log');
  if (!fs.existsSync(p)) return { ok: false, error: 'Aún no hay registros. Juega una vez primero.' };
  clipboard.writeText(redact(fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(-400).join('\n'))); return { ok: true };
});
const rm = p => fs.rmSync(p, { recursive: true, force: true });
handle('clean-logs', () => { rm(path.join(ROOT, 'logs')); rm(path.join(ROOT, 'crash-reports')); return true; });
handle('wipe', () => { // borra todo rastro personal de este equipo (no toca el juego ni los mods)
  memToken = null; const keep = readSettings(); for (const p of [SETTINGS, SKIN_DIR, path.join(ROOT, 'CustomSkinLoader'), path.join(ROOT, 'logs'), path.join(ROOT, 'crash-reports')]) rm(p);
  saveSettings({ eula: keep.eula, deviceId: keep.deviceId }); // el EULA se conserva; el código se pide cada vez que se abre el launcher
  return true;
});
handle('inst-install', (_e, id) => guard(async () => {
  if (!accessOk()) throw new Error('NEED_CODE');
  const ea = readSettings().eula; if (!ea || ea.version !== EULA_VER) throw new Error('Primero debes aceptar el EULA de Minecraft.');
  if (!(CFG.instances || []).some(i => i.id === id)) throw new Error('Instancia desconocida.');
  await loadManifest(); await install();
  const st = readSettings(); saveSettings({ ...st, installed: [...new Set([...(st.installed || []), id])] }); status('Instancia lista', 1);
}));
handle('update', () => guard(async () => { await loadManifest(); await install(); status('Todo al día', 1); }));
handle('play', () => guard(async () => {
  const ea = readSettings().eula; if (!ea || ea.version !== EULA_VER) throw new Error('Primero debes aceptar el EULA de Minecraft.');
  if (!accessOk()) throw new Error('NEED_CODE');
  const auth = await getAuth(); await loadManifest();
  const { java, fabric } = await install();
  if (updatesOn()) { const c = await checkPack(); if (c.tamper) throw new Error(c.error); if (c.available) await applyPack(); }
  status('Preparando mods incluidos', 1); prepareBundled();
  status('Preparando skins', 1); await syncSkins(readSettings().account.name);
  const ram = readSettings().ram || 4, mc = new Client();
  let started = false;
  const opened = async () => { // el juego ya abrió: estado de Discord y despedida del launcher
    if (started) return; started = true; send('game-started');
    const st = readSettings(), closing = st.closeOnPlay !== false;
    const wants = st.discord !== false && CFG.discord && CFG.discord.clientId;
    if (wants) {
      const tryConnect = async () => { const r = await startPresence(); return r; };
      if (!(await tryConnect())) retry = setInterval(async () => { if (!presence && await tryConnect()) { clearInterval(retry); retry = null; } }, 10000); // Discord puede abrirse más tarde
    }
    if (!closing) { win.minimize(); return; }
    if (wants || hasBundle()) {   // se queda en la bandeja para limpiar los mods al cerrar el juego // se queda en segundo plano (bandeja) para mantener el estado mientras juegas
      hiddenToTray = true; win.hide();
      tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })); tray.setToolTip('Sarex Studio Launcher: jugando SarexSafio ' + (CFG.edition || '1'));
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Mostrar launcher', click: () => { win.show(); } }, { label: 'Salir', click: () => app.quit() }]));
    } else setTimeout(() => app.quit(), 1800);
  };
  mc.on('progress', e => e.total && status('Descargando Minecraft', e.task / e.total));
  mc.on('data', d => { if (/Setting user:|LWJGL version|Backend library/.test(String(d))) opened(); });
  mc.on('close', code => {
    cleanBundled();
    if (retry) { clearInterval(retry); retry = null; }
    if (presence) { presence.close(); presence = null; }
    if (hiddenToTray) { app.quit(); return; }
    send('game-closed', { code, started }); if (win && !win.isDestroyed()) win.show();
  });
  // No se reenvían los registros del lanzamiento: contienen el token de acceso.
  status('Abriendo Minecraft…', 1);
  const proc = await mc.launch({
    authorization: auth, root: ROOT, javaPath: java,
    version: { number: CFG.minecraft, type: 'release', custom: fabric },
    memory: { max: `${ram}G`, min: '2G' },
    overrides: { detached: true },
    ...(readSettings().autoJoin !== false && CFG.server && CFG.server.host ? { // JUGAR entra directo al servidor (argumento nuevo y el antiguo por compatibilidad)
      server: { host: CFG.server.host, port: String(CFG.server.port || 25565) },
      customLaunchArgs: ['--quickPlayMultiplayer', `${CFG.server.host}:${CFG.server.port || 25565}`] } : {})
  });
  if (!proc) throw new Error('Minecraft no pudo arrancar.');
  const st0 = readSettings(); saveSettings({ ...st0, stats: { launches: ((st0.stats || {}).launches || 0) + 1, last: Date.now() } });
  setTimeout(() => { if (proc.exitCode === null) opened(); }, 40000); // respaldo si no detectamos la línea de inicio
}));
handle('win-ctl', (_e, a) => { if (a === 'min') win.minimize(); if (a === 'close') win.close(); });

// ---------- Ventanas ----------
const secure = extra => ({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged, ...extra });
function lock(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
}
app.whenReady().then(() => {
  if (!gotLock) return;
  cleanBundled(); // la carpeta de mods queda vacía mientras no juegas
  setTimeout(initUpdater, 4000);
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  splash = new BrowserWindow({ width: 640, height: 380, frame: false, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#0b0610', icon: ICON, webPreferences: secure() });
  lock(splash); splash.loadFile(path.join(__dirname, 'splash.html')); splash.once('ready-to-show', () => splash.show());

  win = new BrowserWindow({ width: 1120, height: 700, minWidth: 960, minHeight: 620, frame: false, show: false, backgroundColor: '#12081a', icon: ICON,
    webPreferences: secure({ preload: path.join(__dirname, 'preload.js') }) });
  lock(win); win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  const t0 = Date.now(), fade = (w, from, to, ms, done) => { let i = 0; const n = 12, t = setInterval(() => { i++; try { w.setOpacity(from + (to - from) * i / n); } catch {} if (i >= n) { clearInterval(t); done && done(); } }, ms / n); };
  win.once('ready-to-show', () => setTimeout(() => {
    fade(splash, 1, 0, 380, () => { if (!splash.isDestroyed()) splash.destroy(); win.setOpacity(0); win.show(); fade(win, 0, 1, 350); });
  }, Math.max(0, 3300 - (Date.now() - t0))));
});
app.on('before-quit', () => { if (presence) presence.close(); cleanBundled(); });
app.on('window-all-closed', () => { if (!hiddenToTray) app.quit(); });
