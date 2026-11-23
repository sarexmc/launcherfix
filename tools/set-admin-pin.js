// Define tu código de administrador (solo tú lo sabrás). Protege la carpeta de mods y la del juego.
//   node tools/set-admin-pin.js "tu código largo y secreto"
// Usa 7 o más caracteres (mejor una frase). Guarda solo una huella en config.json, nunca el código.
const crypto = require('crypto'), fs = require('fs');
const pin = process.argv[2];
if (!pin || pin.length < 7) { console.log('Uso: node tools/set-admin-pin.js "tu código de 7 o más caracteres"'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
const c = JSON.parse(fs.readFileSync('config.json', 'utf8')); c.admin = { salt, hash };
fs.writeFileSync('config.json', JSON.stringify(c, null, 2));
console.log('Listo. Código de administrador guardado (solo su huella). Vuelve a crear el instalador para que se aplique.');
