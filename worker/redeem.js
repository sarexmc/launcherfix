// Servidor GRATIS de canje de códigos (Cloudflare Workers). Hace que cada código sirva UNA sola vez en todo el mundo.
// Variables (Settings > Variables): SALT y CODES (de worker/codes-hashes.txt) y MODKEY (de worker/modkey.txt: la clave que abre los mods cifrados; solo se entrega a códigos válidos). KV: crea un "KV namespace" y enlázalo con el nombre USED.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const sha256 = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
// Junta CODES, CODES2, CODES3... (Cloudflare limita el tamaño de cada variable) y los parte en huellas de 64 caracteres, aunque el corte caiga en medio de una.
const codeSet = env => {
  const hex = Object.keys(env).filter(k => /^CODES\d*$/.test(k)).sort().map(k => String(env[k] || '')).join('').replace(/[^a-f0-9]/gi, '').toLowerCase();
  return new Set(hex.match(/.{64}/g) || []);
};
export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return json({ ok: false, error: 'metodo' }, 405);
    let b; try { b = await req.json(); } catch { return json({ ok: false, error: 'peticion' }, 400); }
    const code = String(b.code || ''), device = String(b.device || '');
    if (!/^\d{6}$/.test(code) || !/^[a-f0-9-]{36,64}$/.test(device)) return json({ ok: false, error: 'formato' }, 400);
    const ip = req.headers.get('CF-Connecting-IP') || 'x', fkey = 'fail:' + ip, fails = parseInt((await env.USED.get(fkey)) || '0', 10);
    if (fails >= 8) return json({ ok: false, error: 'bloqueado' }, 429);          // máx. 8 intentos fallidos por hora y por IP
    const h = await sha256(env.SALT + code);
    if (!codeSet(env).has(h)) { await env.USED.put(fkey, String(fails + 1), { expirationTtl: 3600 }); return json({ ok: false, error: 'invalido' }); }
    const key = 'used:' + h, cur = await env.USED.get(key);
    if (!cur) { await env.USED.put(key, device); return json({ ok: true, key: env.MODKEY }); }       // primer uso: queda ligado a ese equipo
    return json(cur === device ? { ok: true, key: env.MODKEY } : { ok: false, error: 'usado' });      // otro equipo: rechazado
  }
};
