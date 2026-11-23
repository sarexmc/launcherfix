const $ = id => document.getElementById(id);
const S = { account: null, busy: false, back: false, cur: null, adsOff: false, adTimer: null, loaded: false };
const TITLES = { home: 'Inicio', inst: 'SarexSafio 1', add: 'Añadir instancia', news: 'Novedades', shots: 'Capturas', mods: 'Mods', skins: 'Skins', security: 'Seguridad', settings: 'Ajustes' };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------- Navegación ----------
function show(v) {
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === 'v-' + v));
  document.body.dataset.page = v; railActive(v); closeMenu();
  $('title').textContent = TITLES[v] || '';
  if (v === 'skins') loadSkins();
  if (v === 'mods') { loadMods(); adminInfo(); }
  if (v === 'shots') loadShots();
  if (v === 'security') loadSecurity();
}
document.querySelectorAll('.nav').forEach(b => b.onclick = () => show(b.dataset.view));
document.querySelectorAll('[data-w]').forEach(b => b.onclick = () => sarex.invoke('win-ctl', b.dataset.w));
$('player').onclick = () => show('settings');

function say(t, err) { $('msg').textContent = t || ''; $('msg').classList.toggle('err', !!err); }

// ---------- Skins: dibujo ----------
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
function isSlim(img) {
  if (img.height !== 64) return false;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return x.getImageData(55, 24, 1, 1).data[3] === 0;
}
function drawFace(cv, img) {
  cv.width = cv.height = 8; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 8, 8); g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
}
function drawSkin(cv, img, slim, back, sc) {
  const g = cv.getContext('2d'); cv.width = 16 * sc; cv.height = 32 * sc; g.imageSmoothingEnabled = false;
  const old = img.height === 32, aw = slim ? 3 : 4;
  const P = (sx, sy, w, h, dx, dy, flip) => {
    g.save(); if (flip) { g.translate((2 * dx + w) * sc, 0); g.scale(-1, 1); }
    g.drawImage(img, sx, sy, w, h, dx * sc, dy * sc, w * sc, h * sc); g.restore();
  };
  if (!back) {
    P(4, 20, 4, 12, 4, 20); old ? P(4, 20, 4, 12, 8, 20, true) : P(20, 52, 4, 12, 8, 20);
    P(20, 20, 8, 12, 4, 8);
    P(44, 20, aw, 12, 4 - aw, 8); old ? P(44, 20, aw, 12, 12, 8, true) : P(36, 52, aw, 12, 12, 8);
    P(8, 8, 8, 8, 4, 0);
    if (!old) { P(4, 36, 4, 12, 4, 20); P(4, 52, 4, 12, 8, 20); P(20, 36, 8, 12, 4, 8); P(44, 36, aw, 12, 4 - aw, 8); P(52, 52, aw, 12, 12, 8); }
    P(40, 8, 8, 8, 4, 0);
  } else {
    old ? P(12, 20, 4, 12, 4, 20, true) : P(28, 52, 4, 12, 4, 20); P(12, 20, 4, 12, 8, 20);
    P(32, 20, 8, 12, 4, 8);
    old ? P(44 + aw + 4, 20, aw, 12, 4 - aw, 8, true) : P(36 + aw + 4, 52, aw, 12, 4 - aw, 8); P(44 + aw + 4, 20, aw, 12, 12, 8);
    P(24, 8, 8, 8, 4, 0);
    if (!old) { P(12, 52, 4, 12, 4, 20); P(12, 36, 4, 12, 8, 20); P(32, 36, 8, 12, 4, 8); P(52 + aw + 4, 52, aw, 12, 4 - aw, 8); P(44 + aw + 4, 36, aw, 12, 12, 8); }
    P(56, 8, 8, 8, 4, 0);
  }
}
async function showSkin(data, slim, name, src) {
  $('skerr').textContent = '';
  $('skname').textContent = name; $('sksrc').textContent = src || '';
  if (!data) { S.cur = null; $('skcan').hidden = true; $('skempty').hidden = false; return; }
  const img = await loadImg(data);
  S.cur = { img, slim: slim == null ? isSlim(img) : slim };
  $('skcan').hidden = false; $('skempty').hidden = true;
  drawSkin($('skcan'), img, S.cur.slim, S.back, 10);
}
$('fb').onclick = () => { S.back = !S.back; $('fb').textContent = S.back ? 'Ver frente' : 'Ver espalda'; if (S.cur) drawSkin($('skcan'), S.cur.img, S.cur.slim, S.back, 10); };

async function refreshMine() {
  const m = await sarex.invoke('skin-mine');
  const nm = S.account ? S.account.name : 'Tu skin';
  const label = { local: 'Skin importada por ti', premium: 'Skin de tu cuenta de Minecraft', default: 'Sin skin personalizada' }[m.source];
  await showSkin(m.data, m.slim, nm, label);
  $('skdel').hidden = m.source !== 'local'; refreshSkinMod();
  const pf = $('pface'), g = pf.getContext('2d');
  if (m.data) drawFace(pf, await loadImg(m.data)); else { pf.width = pf.height = 8; g.fillStyle = '#6b4a8c'; g.fillRect(0, 0, 8, 8); }
  { const mf = $('meFace'); mf.width = mf.height = 8; mf.getContext('2d').drawImage(pf, 0, 0); }
}
async function loadSkins() {
  if (S.loaded) return; S.loaded = true;
  await refreshMine();
  const list = await sarex.invoke('skin-gallery'), grid = $('grid'); grid.replaceChildren();
  $('gridempty').hidden = list.length > 0;
  for (const s of list) {
    const b = el('button', 'sk'), c = document.createElement('canvas');
    drawFace(c, await loadImg(s.data)); b.append(c, el('span', '', s.player));
    b.onclick = () => showSkin(s.data, null, s.player, 'Skin de la comunidad');
    grid.append(b);
  }
}
$('skimp').onclick = async () => {
  const r = await sarex.invoke('skin-import');
  if (r.ok) { await showSkin(r.data, null, S.account ? S.account.name : 'Tu skin', 'Skin importada: se verá en el juego al pulsar JUGAR'); $('skdel').hidden = false; refreshSkinMod(); }
  else if (!r.canceled) $('skerr').textContent = r.error;
};
$('skdel').onclick = async () => { await sarex.invoke('skin-remove'); refreshMine(); };
$('lkbtn').onclick = async () => {
  const n = $('lkname').value.trim(); if (!n) return;
  const r = await sarex.invoke('skin-lookup', n);
  if (r.ok) showSkin(r.data, r.slim, n, 'Skin premium de ' + n); else $('skerr').textContent = r.error;
};
$('lkname').onkeydown = e => { if (e.key === 'Enter') $('lkbtn').click(); };

// ---------- Cuenta ----------
function refreshAccount() {
  if (S.eulaPending || S.codePending) return;
  const a = S.account;
  $('pname').textContent = a ? a.name : 'Sin sesión';
  const b = $('pbadge'); b.textContent = a ? (a.type === 'ms' ? 'Premium' : 'Sin cuenta') : ''; b.className = a && a.type === 'ms' ? 'prem' : '';
  b.hidden = !a;
  $('setwho').textContent = a ? a.name : '';
  $('setkind').textContent = a ? (a.type === 'ms' ? 'Cuenta Microsoft (premium)' : 'Jugando sin cuenta') : '';
  $('play').disabled = S.busy || !a; greet();
  if (!a) openModal(false);
}
function openModal(cancel) { $('modal').hidden = false; $('mclose').hidden = !cancel; $('lerr').textContent = ''; }
function closeModal() { $('modal').hidden = true; }
async function afterLogin(acc) { S.account = acc; S.loaded = false; closeModal(); refreshAccount(); say('Todo listo.'); refreshMine(); }
$('ms').onclick = async () => {
  $('ms').disabled = true; $('lerr').textContent = 'Abriendo la ventana de Microsoft…';
  const r = await sarex.invoke('login-ms'); $('ms').disabled = false;
  if (r.ok) afterLogin({ type: 'ms', name: r.name }); else $('lerr').textContent = r.error;
};
$('offbtn').onclick = async () => {
  const r = await sarex.invoke('login-offline', $('offname').value);
  if (r.ok) afterLogin({ type: 'offline', name: r.name }); else $('lerr').textContent = r.error;
};
$('offname').onkeydown = e => { if (e.key === 'Enter') $('offbtn').click(); };
$('logout').onclick = async () => { await sarex.invoke('logout'); S.account = null; S.loaded = false; refreshAccount(); };
$('mclose').onclick = closeModal;

// ---------- Jugar / actualizar ----------
sarex.on('progress', p => { const n = Math.round(Math.min(1, p.pct || 0) * 100); $('prog').hidden = false; $('fill').style.width = n + '%'; $('pct').hidden = false; $('pct').textContent = n + '%'; say(p.text); stepFor(p.text); if (S.instUI) { S.instUI.fill.style.width = n + '%'; S.instUI.msg.textContent = p.text; } });
sarex.on('busy', b => { S.busy = b; $('play').disabled = b || !S.account; $('playLbl').textContent = b ? 'PREPARANDO…' : 'JUGAR'; $('hero').classList.toggle('busy', b); window.__fxSpeed = b ? 4 : 1; if (!b) { $('prog').hidden = true; $('pct').hidden = true; $('steps').hidden = true; } });
sarex.on('game-started', () => say('Minecraft abrió. Buen juego.'));
sarex.on('game-closed', d => { $('prog').hidden = true; $('pct').hidden = true; if (d && d.code && !d.started) say('Minecraft se cerró al iniciar. En Seguridad, pulsa «Copiar registro seguro» y mándaselo a Sarex Studio.', true); else say('Listo para jugar otra vez.'); });
async function run(a) { const r = await sarex.invoke(a); if (!r.ok) { if (r.error === 'NEED_CODE') { S.codePending = true; openCode(); say('Vuelve a escribir tu código de acceso para abrir los mods incluidos.', true); } else say(r.error, true); } }
$('play').onclick = () => run('play');
$('folder').onclick = async () => { if (await askAdmin()) sarex.invoke('admin-folder', 'game'); };
$('ram').oninput = e => { $('ramv').textContent = e.target.value + ' GB'; sarex.invoke('set-ram', +e.target.value); };

// ---------- Anuncios discretos ----------
function showAd(ads, i = 0) {
  clearTimeout(S.adTimer);
  if (!ads.length || S.adsOff) { $('ad').hidden = true; return; }
  const ad = ads[i % ads.length];
  $('ad').hidden = false; $('adtag').textContent = ad.tag || 'Patrocinado'; $('adtext').textContent = ad.text;
  $('adtext').onclick = e => { e.preventDefault(); if (ad.url) sarex.invoke('open-url', ad.url); };
  if (ads.length > 1) S.adTimer = setTimeout(() => showAd(ads, i + 1), 45000);
}
$('adclose').onclick = () => { S.adsOff = true; $('ad').hidden = true; };

// ---------- Inicio ----------
(async () => {
  const d = await sarex.invoke('init'), m = d.manifest;
  S.account = d.account; S.eulaPending = !d.eula;
  $('chipVer').textContent = 'Minecraft ' + d.cfg.minecraft;
  $('chipMods').textContent = m.mods + (m.mods === 1 ? ' mod' : ' mods');
  $('ram').value = d.ram; $('ramv').textContent = d.ram + ' GB';
  initOpts(d); applyTheme(d.theme); S.sound = d.opts.sound; $('optSound').checked = d.opts.sound; showStats(d.stats);
  $('ramhint').textContent = `Tu PC tiene ${d.sysRam} GB de memoria. Recomendado para el juego: ${Math.max(2, Math.min(8, Math.floor(d.sysRam / 2)))} GB.`;
  const nw = $('news'); nw.replaceChildren();
  for (const n of m.news) { const a = el('article'); a.append(el('h4', '', n.title), el('p', '', n.text)); nw.append(a); }
  if (!m.news.length) nw.append(el('p', 'small', 'Aún no hay novedades.'));
  startTicker(m.news); countUp($('chipMods'), m.mods);
  showAd(m.ads);
  S.codePending = !d.access; S.instances = d.cfg.instances || []; S.installed = d.installed || [];
  renderRail(); renderInstGrid(); homeState();
  if (S.eulaPending) $('eulaModal').hidden = false; else if (S.codePending) openCode();
  refreshAccount(); if (S.account && !S.eulaPending && !S.codePending) { say('Todo listo.'); refreshMine(); }
})();


// ---------- Mods ----------
const badge = (t, k) => el('span', 'badge ' + k, t);
async function loadMods() {
  const r = await sarex.invoke('mods-status'), box = $('modlist'); box.replaceChildren();
  const L = { ok: ['Verificado', 'ok'], missing: ['Falta', 'warn'], bad: ['Dañado', 'bad'] };
  for (const m of r.mods) { const row = el('div', 'mrow'); row.append(el('span', '', m.file), badge(...L[m.state])); box.append(row); }
  const good = r.mods.filter(m => m.state === 'ok').length;
  $('modsum').textContent = r.mods.length ? `${good} de ${r.mods.length} mods verificados.` + (r.extra ? ` Hay ${r.extra} mod(s) ajenos que se quitarán al jugar.` : '') + (r.bundled ? ' Además, el launcher trae mods incluidos y cifrados.' : '') + (r.offline ? ' Sin conexión con el pack.' : '') : 'Aquí aparecerán los mods de tu pack.';
}
$('modfix').onclick = async () => { $('modfix').disabled = true; $('modsum').textContent = 'Verificando…'; const r = await sarex.invoke('update'); $('modfix').disabled = false; if (!r.ok) say(r.error, true); loadMods(); };
$('modfolder').onclick = async () => { if (await askAdmin()) sarex.invoke('admin-folder', 'mods'); };

// ---------- Seguridad y privacidad ----------
async function loadSecurity() {
  const [s, m] = await Promise.all([sarex.invoke('security'), sarex.invoke('mods-status')]);
  const allOk = m.mods.length === 0 || m.mods.every(x => x.state === 'ok');
  const rows = [
    s.encrypted ? ['ok', 'Sesión cifrada en tu equipo', 'Tu sesión de Microsoft nunca queda en texto plano.'] : ['warn', 'Cifrado no disponible', 'Tu sesión no se guardará: tendrás que entrar cada vez.'],
    s.sigFail ? ['bad', 'Lista de mods NO válida', 'La firma no coincide. No se instala nada por seguridad.'] : s.signed ? ['ok', 'Lista de mods firmada', 'Nadie puede añadir mods falsos sin la llave de Sarex Studio.'] : ['warn', 'Lista de mods sin firma', 'Funciona, pero el dueño debería activar la firma.'],
    allOk ? ['ok', 'Mods verificados', 'Cada archivo coincide con su huella digital.'] : ['warn', 'Hay mods por verificar', 'Ve a Mods y pulsa Verificar y reparar.'],
    ['ok', 'Mods vigilados', 'Si se borra o cambia un mod, el launcher lo restaura solo.'],
    s.adminSet ? ['ok', 'Carpetas protegidas con código de administrador', 'Solo quien tiene el código puede abrir la carpeta de mods.'] : ['warn', 'Sin código de administrador', 'Créalo con tools/set-admin-pin.js para proteger la carpeta de mods.'],
    ['ok', 'Descargas solo de sitios autorizados', s.hosts.join(', ')],
    ['ok', 'Sin recopilación de datos', 'El launcher no envía información tuya a nadie.']
  ];
  const ul = $('checks'); ul.replaceChildren();
  for (const [k, t, d] of rows) { const li = el('li'), dot = el('span', 'dot ' + k, k === 'ok' ? '✓' : '!'), box = el('div'); const b = el('b', '', t), sm = el('small', '', d); box.append(b, sm); li.append(dot, box); ul.append(li); }
}
function note(t, err) { $('secmsg').textContent = t; $('secmsg').style.color = err ? '' : 'var(--mut)'; }
$('copylog').onclick = async () => { const r = await sarex.invoke('copy-safe-log'); note(r.ok ? 'Copiado. Ya puedes pegarlo en el chat de ayuda.' : r.error, !r.ok); };
$('cleanlogs').onclick = async () => { await sarex.invoke('clean-logs'); note('Registros y reportes borrados.'); };
let wipeArm = null;
$('wipe').onclick = async () => {
  if (!wipeArm) { $('wipe').textContent = '¿Seguro? Pulsa otra vez para borrar'; wipeArm = setTimeout(() => { wipeArm = null; $('wipe').textContent = 'Borrar mis datos de este equipo'; }, 4000); return; }
  clearTimeout(wipeArm); await sarex.invoke('wipe'); location.reload();
};
$('ms2fa').onclick = () => sarex.invoke('open-url', 'https://account.microsoft.com/security');

// ---------- Opciones ----------
function applyPrivate(on) { document.body.classList.toggle('private', on); }
function initOpts(d) {
  $('optPrivate').checked = d.opts.private; applyPrivate(d.opts.private);
  $('optClose').checked = d.opts.closeOnPlay;
  $('optDisc').checked = d.opts.discord && d.discord.ready; $('optDisc').disabled = !d.discord.ready;
  if (!d.discord.ready) $('discSmall').textContent = 'Aún no está configurado: falta el ID de la aplicación de Discord en config.json.';
  if (d.discord.invite) { $('qDiscord').hidden = false; $('qDiscord').onclick = () => sarex.invoke('open-url', d.discord.invite); }
  $('optFx').checked = d.opts.fx; applyFx(d.opts.fx);
  if (d.cfg.server) { $('joinRow').hidden = false; $('optJoin').checked = d.opts.autoJoin; $('joinSrv').textContent = d.cfg.server.name || d.cfg.server.host; $('joinSrv').classList.add('pn');
    pollServer(d.cfg.server); }
}
$('optPrivate').onchange = e => { applyPrivate(e.target.checked); sarex.invoke('set-opt', 'private', e.target.checked); };
$('optClose').onchange = e => sarex.invoke('set-opt', 'closeOnPlay', e.target.checked);
$('discTest').onclick = async () => { $('discMsg').style.color = 'var(--mut)'; $('discMsg').textContent = 'Probando…'; const r = await sarex.invoke('discord-test'); $('discMsg').style.color = r.ok ? '#6fe3a0' : ''; $('discMsg').textContent = r.ok ? 'Listo: mira tu perfil de Discord, saldrá «Jugando a SarexSafio» durante 20 segundos.' : r.error; };
$('optDisc').onchange = e => sarex.invoke('set-opt', 'discord', e.target.checked);
$('optJoin').onchange = e => sarex.invoke('set-opt', 'autoJoin', e.target.checked);

// Fondo con ligero movimiento al mover el ratón
addEventListener('mousemove', e => { document.body.style.setProperty('--px', ((e.clientX / innerWidth - .5) * -14).toFixed(1) + 'px'); document.body.style.setProperty('--py', ((e.clientY / innerHeight - .5) * -10).toFixed(1) + 'px'); });

// ---------- EULA de Minecraft ----------
const EULA = 'https://www.minecraft.net/eula', GUIDE = 'https://www.minecraft.net/usage-guidelines';
$('eulaRead').onclick = $('eulaView').onclick = () => sarex.invoke('open-url', EULA);
$('eulaGuide').onclick = () => sarex.invoke('open-url', GUIDE);
$('eulaCk').onchange = e => { $('eulaOk').disabled = !e.target.checked; };
$('eulaOk').onclick = async () => { await sarex.invoke('eula-accept'); S.eulaPending = false; $('eulaModal').hidden = true; sfx.ok(); if (S.codePending) openCode(); else { refreshAccount(); if (S.account) { say('Todo listo.'); refreshMine(); } } };
$('eulaNo').onclick = () => sarex.invoke('win-ctl', 'close');

// ---------- Extras de la portada ----------
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
function greet() {
  syncMenu();
  const h = new Date().getHours(), g = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  $('hello').replaceChildren(document.createTextNode(S.account ? g + ', ' : g), ...(S.account ? [el('b', 'pn', S.account.name)] : []));
}
function countUp(node, n) {
  const t0 = performance.now(), word = n === 1 ? ' mod' : ' mods';
  (function f(t) { const k = Math.min(1, (t - t0) / 700); node.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))) + word; if (k < 1) requestAnimationFrame(f); })(t0);
}
function startTicker(items) {
  if (!items.length) return; $('ticker').hidden = false; $('ticker').style.cursor = 'pointer'; $('ticker').onclick = () => show('news');
  let i = 0; const t = $('tkText');
  const next = () => { t.classList.add('out'); setTimeout(() => { t.textContent = items[i % items.length].title; t.classList.remove('out'); i++; }, 350); };
  next(); if (items.length > 1) setInterval(next, 6000);
}
function pollServer(srv) {
  $('srv').hidden = false; $('srvName').textContent = srv.name || srv.host;
  const tick = async () => {
    const r = await sarex.invoke('server-status'), box = $('srv');
    if (r && r.max != null) { box.className = 'srv on'; $('srvCount').textContent = `${r.online}/${r.max} en línea`; $('srvPing').textContent = r.ping + ' ms'; }
    else { box.className = 'srv off'; $('srvCount').textContent = 'Sin respuesta'; $('srvPing').textContent = ''; }
  };
  tick(); setInterval(tick, 30000);
}
async function refreshSkinMod() {
  const r = await sarex.invoke('skin-status'), n = $('skmod');
  n.className = 'small modnote ' + (r.modInstalled ? 'ok' : 'warn');
  n.textContent = r.modInstalled ? 'Mod de skins instalado ✓ Tu skin se verá en el juego.' : 'El mod de skins se instalará solo la próxima vez que pulses JUGAR.';
}
function applyFx(on) { document.body.classList.toggle('nofx', !on); }
$('optFx').onchange = e => { applyFx(e.target.checked); sarex.invoke('set-opt', 'fx', e.target.checked); };
addEventListener('mousemove', e => { const l = $('logo'); if (!l) return; l.style.transform = `rotateY(${((e.clientX / innerWidth - .5) * 10).toFixed(1)}deg) rotateX(${(-(e.clientY / innerHeight - .5) * 8).toFixed(1)}deg)`; });
$('play').addEventListener('click', e => {
  const b = $('play'), r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), sp = document.createElement('span');
  sp.className = 'ripple'; sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.append(sp); setTimeout(() => sp.remove(), 700);
});

// ---------- Sonidos suaves ----------
let ac;
function tone(f, d = .08, v = .04, t = 'sine', at = 0) {
  if (!S.sound) return;
  try { ac = ac || new AudioContext(); const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime + at;
    o.type = t; o.frequency.value = f; g.gain.setValueAtTime(0, n); g.gain.linearRampToValueAtTime(v, n + .01); g.gain.exponentialRampToValueAtTime(.0001, n + d);
    o.connect(g).connect(ac.destination); o.start(n); o.stop(n + d + .02); } catch {}
}
const sfx = { click: () => tone(520, .06, .025), ok: () => [523, 659, 784].forEach((f, i) => tone(f, .2, .05, 'sine', i * .09)), err: () => tone(180, .2, .05, 'triangle'), go: () => [392, 523, 659, 784].forEach((f, i) => tone(f, .22, .05, 'triangle', i * .07)) };
document.addEventListener('click', e => { if (e.target.closest('.nav,.th,.qk,.sk,.shot,.btn')) sfx.click(); });
$('play').addEventListener('click', () => sfx.go());
$('optSound').onchange = e => { S.sound = e.target.checked; sarex.invoke('set-opt', 'sound', e.target.checked); if (S.sound) sfx.ok(); };

// ---------- Código de acceso (6 dígitos, un solo uso) ----------
const otp = [...document.querySelectorAll('#otp input')];
const codeVal = () => otp.map(i => i.value).join('');
function updCode() { $('codeOk').disabled = codeVal().length !== 6; otp.forEach(i => i.classList.toggle('f', !!i.value)); }
otp.forEach((inp, i) => {
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(-1); if (inp.value && i < 5) otp[i + 1].focus(); updCode(); if (codeVal().length === 6) setTimeout(submitCode, 180); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !inp.value && i > 0) { otp[i - 1].focus(); otp[i - 1].value = ''; updCode(); }
    if (e.key === 'ArrowLeft' && i > 0) otp[i - 1].focus(); if (e.key === 'ArrowRight' && i < 5) otp[i + 1].focus(); if (e.key === 'Enter') submitCode();
  });
  inp.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); t.split('').forEach((c, k) => otp[k].value = c); updCode(); otp[Math.min(t.length, 5)].focus(); if (t.length === 6) setTimeout(submitCode, 180); });
});
let codeBusy = false;
async function submitCode() {
  if (codeBusy || codeVal().length !== 6) return; codeBusy = true; $('codeOk').disabled = true; $('codeErr').textContent = '';
  const r = await sarex.invoke('code-redeem', codeVal()); codeBusy = false;
  if (r.ok) { $('plus').classList.add('ok'); sfx.ok(); confetti(); setTimeout(() => { $('codeModal').hidden = true; S.codePending = false; const f = S.afterCode; S.afterCode = null; refreshAccount(); if (f) f(); if (S.account) { say('Todo listo.'); refreshMine(); } }, 1100); }
  else { $('codeErr').textContent = r.error; $('otp').classList.add('bad'); sfx.err(); setTimeout(() => { $('otp').classList.remove('bad'); otp.forEach(i => i.value = ''); updCode(); otp[0].focus(); }, 520); }
}
$('codeOk').onclick = submitCode; $('codeNo').onclick = () => sarex.invoke('win-ctl', 'close');
function openCode() { $('codeModal').hidden = false; $('plus').classList.remove('ok'); setTimeout(() => otp[0].focus(), 80); }
function confetti() {
  const cols = ['#ffc53d', '#ff6a1f', '#e0338c', '#7a2cff', '#28b5f5', '#4be08a'], r = $('plus').getBoundingClientRect();
  for (let i = 0; i < 44; i++) { const c = document.createElement('i'); c.className = 'confetti';
    c.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${cols[i % 6]};--dx:${((Math.random() - .5) * 460).toFixed(0)}px;--dy:${(-140 + Math.random() * 380).toFixed(0)}px;--r:${(Math.random() * 720).toFixed(0)}deg`;
    document.body.append(c); setTimeout(() => c.remove(), 1400); }
}

// ---------- Pasos, estadísticas, capturas y tema ----------
const STEP_KEYS = [/Java/, /Fabric/, /^Mods/, /skins/i, /Minecraft|Abriendo|Iniciando/];
function stepFor(t) {
  const i = STEP_KEYS.findIndex(r => r.test(t || '')); if (i < 0) return; $('steps').hidden = false;
  [...$('steps').children].forEach((n, k) => { n.className = k < i ? 'done' : k === i ? 'active' : ''; });
}
function showStats(st) {
  if (!st || !st.launches) { $('stats').textContent = ''; return; }
  const m = Math.round((Date.now() - st.last) / 60000), ago = m < 2 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
  $('stats').textContent = `Partidas: ${st.launches}  |  Última vez: ${ago}`;
}
async function loadShots() {
  const list = await sarex.invoke('screens'), box = $('shots'); box.replaceChildren();
  $('shotsmsg').textContent = list.length ? '' : 'Aún no hay capturas. Pulsa F2 dentro del juego para sacar una.';
  for (const s of list) { const b = el('button', 'shot'), im = new Image(); im.src = s.data; im.alt = s.name; b.append(im); b.onclick = () => sarex.invoke('screen-open', s.name); box.append(b); }
}
$('shotsFolder').onclick = () => sarex.invoke('open-shots');
function applyTheme(t) { document.body.dataset.theme = t; document.querySelectorAll('.th').forEach(b => b.classList.toggle('active', b.dataset.theme === t)); }
document.querySelectorAll('.th').forEach(b => b.onclick = () => { applyTheme(b.dataset.theme); sarex.invoke('set-theme', b.dataset.theme); });

// ---------- Código de administrador ----------
let adminResolve = null;
function askAdmin() {
  return new Promise(res => { adminResolve = res; $('adminPin').value = ''; $('adminErr').textContent = ''; $('adminModal').hidden = false; setTimeout(() => $('adminPin').focus(), 80); });
}
function closeAdmin(v) { $('adminModal').hidden = true; if (adminResolve) { adminResolve(v); adminResolve = null; } }
async function tryAdmin() {
  const r = await sarex.invoke('admin-unlock', $('adminPin').value);
  if (r.ok) { sfx.ok(); closeAdmin(true); } else { $('adminErr').textContent = r.error; sfx.err(); $('adminPin').value = ''; $('adminPin').focus(); }
}
$('adminOk').onclick = tryAdmin; $('adminNo').onclick = () => closeAdmin(false);
$('adminPin').onkeydown = e => { if (e.key === 'Enter') tryAdmin(); if (e.key === 'Escape') closeAdmin(false); };
sarex.on('mods-restored', () => say('Se restauró un mod que faltaba o había cambiado.'));

// ---------- Barra de instancias, menú de perfil y "añadir instancia" ----------
function railActive(v) {
  $('homeBtn').classList.toggle('active', v === 'home'); $('addBtn').classList.toggle('active', v === 'add');
  document.querySelectorAll('.rb.inst').forEach(b => b.classList.toggle('active', v === 'inst' && b.dataset.inst === S.cur));
  $('meBtn').classList.toggle('active', !['home', 'inst', 'add'].includes(v));
}
let packAvail = false;
function renderRail() {
  const box = $('instRail'); box.replaceChildren();
  for (const i of (S.instances || []).filter(x => S.installed.includes(x.id))) {
    const b = el('button', 'rb inst'), im = new Image(); b.dataset.inst = i.id; b.title = i.name; im.src = 'icon.png'; im.alt = i.name; b.append(im);
    if (packAvail) b.classList.add('upd'); b.onclick = () => { S.cur = i.id; show('inst'); }; box.append(b);
  }
  $('addBtn').classList.toggle('pulse', !S.installed.length); railActive(document.body.dataset.page || 'home');
}
function homeState() {
  const has = S.installed.length > 0;
  $('homePlayLbl').textContent = has ? 'JUGAR' : 'AÑADIR INSTANCIA';
  $('homeHint').textContent = has ? '' : 'Aún no tienes ninguna instancia. Pulsa el + de la izquierda para añadir SarexSafio.';
}
function renderInstGrid() {
  const g = $('instGrid'); g.replaceChildren();
  for (const i of S.instances || []) {
    const done = S.installed.includes(i.id), c = el('div', 'icard'), im = new Image(), body = el('div', 'ibody');
    im.src = 'logo.png'; im.alt = i.name; im.className = 'ilogo';
    const btn = el('button', 'btn primary', done ? 'Abrir' : 'Instalar'), prog = el('div', 'prog'), fill = el('div', 'fill'), msg = el('p', 'msg', '');
    prog.append(fill); prog.hidden = true;
    body.append(el('h3', '', i.name), el('p', 'small', i.desc), btn, prog, msg); c.append(im, body); g.append(c);
    btn.onclick = async () => {
      if (S.installed.includes(i.id)) { S.cur = i.id; show('inst'); return; }
      if (S.codePending) { S.afterCode = () => btn.click(); openCode(); return; }
      btn.disabled = true; btn.textContent = 'Instalando…'; prog.hidden = false; msg.className = 'msg'; msg.textContent = 'Preparando…'; S.instUI = { fill, msg };
      const r = await sarex.invoke('inst-install', i.id); S.instUI = null;
      if (r.ok) { S.installed.push(i.id); sfx.ok(); renderRail(); renderInstGrid(); homeState(); S.cur = i.id; show('inst'); }
      else { btn.disabled = false; btn.textContent = 'Instalar'; msg.className = 'msg err'; msg.textContent = r.error === 'NEED_CODE' ? 'Escribe tu código de acceso.' : r.error; if (r.error === 'NEED_CODE') { S.codePending = true; S.afterCode = () => btn.click(); openCode(); } }
    };
  }
}
function closeMenu() { $('meMenu').hidden = true; }
$('meBtn').onclick = e => { e.stopPropagation(); $('meMenu').hidden = !$('meMenu').hidden; };
document.addEventListener('click', e => { if (!e.target.closest('#meMenu,#meBtn')) closeMenu(); });
function syncMenu() {
  const a = S.account; $('menuName').textContent = a ? a.name : 'Sin sesión';
  const b = $('menuBadge'); b.textContent = a ? (a.type === 'ms' ? 'Premium' : 'Sin cuenta') : ''; b.className = a && a.type === 'ms' ? 'prem' : '';
}
$('homeBtn').onclick = () => show('home');
$('addBtn').onclick = () => show('add');
$('homePlay').onclick = () => { if (!S.installed.length) { show('add'); return; } S.cur = S.installed[0]; show('inst'); if (!$('play').disabled) $('play').click(); };

// ---------- Actualizaciones: mods para todos y launcher ----------
async function checkPackUI() {
  const c = await sarex.invoke('pack-check'); if (!c || !c.enabled) return;
  packAvail = !!c.available; $('packBar').hidden = !c.available;
  if (c.available) $('packTxt').textContent = `Hay una actualización de mods (versión ${c.version})` + (c.note ? `: ${c.note}` : '') + '.';
  if (c.tamper) say(c.error, true);
  document.querySelectorAll('.rb.inst').forEach(b => b.classList.toggle('upd', packAvail));
}
$('packBtn').onclick = async () => { $('packBtn').disabled = true; const r = await sarex.invoke('pack-update'); $('packBtn').disabled = false; if (!r.ok) say(r.error, true); else { sfx.ok(); say('Mods actualizados.'); } checkPackUI(); };
$('chkBtn').onclick = async () => { $('chkBtn').textContent = 'Buscando…'; await checkPackUI(); $('chkBtn').textContent = 'Buscar actualizaciones'; $('modsum').textContent = packAvail ? 'Hay una actualización disponible: pulsa «Actualizar mods» arriba.' : 'Tienes los mods al día.'; };
sarex.on('app-update', v => { $('appBar').hidden = false; $('appTxt').textContent = `Nueva versión del launcher lista (${v.version}).`; });
$('appBtn').onclick = () => sarex.invoke('app-update-install');
setTimeout(checkPackUI, 2500); setInterval(checkPackUI, 15 * 60 * 1000);

// ---------- Administrador: publicar mods ----------
async function adminInfo() {
  const a = await sarex.invoke('admin-state');
  $('adminInfo').textContent = !a.ready ? 'Falta configurar updates.repo y publicKey en config.json.' : `Repo: ${a.repo}  |  Token: ${a.hasToken ? 'guardado' : 'falta'}  |  Llave de firma: ${a.hasSign ? 'guardada' : 'falta'}  |  Versión en este PC: ${a.version}`;
}
function pubMsg(t, err) { $('pubMsg').textContent = t || ''; $('pubMsg').style.color = err ? '' : 'var(--mut)'; }
$('pubBtn').onclick = async () => {
  if (!(await askAdmin())) return; pubMsg('Elige la carpeta de mods…'); $('pubBtn').disabled = true;
  const r = await sarex.invoke('pack-publish', $('pubNote').value); $('pubBtn').disabled = false;
  if (r.ok) { pubMsg('Publicada. Los jugadores la recibirán en unos minutos.'); sfx.ok(); } else pubMsg(r.error, true); adminInfo();
};
$('keyBtn').onclick = async () => { if (!(await askAdmin())) return; const r = await sarex.invoke('admin-signkey'); if (!r.ok && !r.canceled) pubMsg(r.error, true); else if (r.ok) pubMsg('Llave de firma guardada.'); adminInfo(); };
$('tokBtn').onclick = async () => { if (!(await askAdmin())) return; $('tokIn').value = ''; $('tokErr').textContent = ''; $('tokModal').hidden = false; setTimeout(() => $('tokIn').focus(), 80); };
$('tokNo').onclick = () => { $('tokModal').hidden = true; };
async function saveTok() { const r = await sarex.invoke('admin-token', $('tokIn').value); if (r.ok) { $('tokModal').hidden = true; pubMsg('Token guardado.'); adminInfo(); } else $('tokErr').textContent = r.error; }
$('tokOk').onclick = saveTok; $('tokIn').onkeydown = e => { if (e.key === 'Enter') saveTok(); };

// ---------- Administrador: cargar .mrpack ----------
function mrMsg(t, err) { $('mrMsg').textContent = t || ''; $('mrMsg').style.color = err ? '' : 'var(--mut)'; }
async function importMr(file) {
  if (!(await askAdmin())) return; mrMsg('Procesando el modpack…'); $('mrBtn').disabled = true;
  const r = await sarex.invoke('mrpack-import', file || null); $('mrBtn').disabled = false;
  if (r.ok) { mrMsg('Modpack cargado en SarexSafio.'); sfx.ok(); } else if (r.error !== 'Cancelado.') mrMsg(r.error, true); else mrMsg(''); adminInfo();
}
$('mrBtn').onclick = () => importMr(null);
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
$('mrDrop').addEventListener('drop', e => { const f = e.dataTransfer.files[0]; const p = f && sarex.pathOf(f); if (p && /\.mrpack$/i.test(p)) importMr(p); else mrMsg('Suelta un archivo .mrpack.', true); });
sarex.on('progress', d => { if ($('mrBtn').disabled && d.text) mrMsg(d.text); });
