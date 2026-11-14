// =============================================================
// descargar-sheet.js
// Descarga la contabilidad (Google Sheet) como Excel, sin abrir el
// navegador. Reemplaza el paso manual "Archivo → Descargar → .xlsx".
//
// Lee:      privado/credenciales-google.json   (llave de la cuenta de servicio)
//           privado/configuracion.json         ({ "id_hoja": "..." })
// Escribe:  privado/contabilidad.xlsx
//
// Uso:  node herramientas/descargar-sheet.js
//
// Cómo funciona, en tres pasos:
//   1. Firma un "pase" con la llave privada de la cuenta de servicio.
//   2. Google cambia ese pase por un permiso temporal (dura 1 hora).
//   3. Con ese permiso se pide a Google Drive el Sheet en formato Excel.
//
// La cuenta de servicio es un "usuario robot" de Google. Solo puede ver
// lo que se comparte con ella: el Sheet, como Lector. No puede modificar nada.
// No usa paquetes: solo lo que trae Node.js.
// =============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..'); // la carpeta del proyecto
const RUTA_CREDENCIALES = path.join(RAIZ, 'privado', 'credenciales-google.json');
const RUTA_CONFIGURACION = path.join(RAIZ, 'privado', 'configuracion.json');
const DESTINO = path.join(RAIZ, 'privado', 'contabilidad.xlsx');

// Dirección de Google Drive. (La variable de entorno existe solo para las pruebas automáticas.)
const URL_DRIVE = process.env.PRUEBA_URL_DRIVE || 'https://www.googleapis.com/drive/v3/files/';
const TIPO_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function detener(mensaje) {
  console.error('\nNO SE DESCARGÓ LA CONTABILIDAD: ' + mensaje + '\n');
  process.exit(1);
}

function leerJSON(ruta, queEs) {
  if (!fs.existsSync(ruta)) detener('Falta ' + path.relative(RAIZ, ruta) + ' (' + queEs + '). Ver README.md, sección "Lectura automática".');
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (e) {
    detener(path.relative(RAIZ, ruta) + ' no es un archivo JSON válido.');
  }
}

// Convierte a "base64 para URL": el formato que piden los pases (JWT)
function base64url(dato) {
  return Buffer.from(dato).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Hace una petición web y devuelve { estado, cuerpo } con el cuerpo en bytes.
// Usa el módulo https de Node (o http, solo en las pruebas locales).
function pedir(url, opciones, cuerpo) {
  return new Promise(function (resolver, rechazar) {
    const direccion = new URL(url);
    const modulo = direccion.protocol === 'http:' ? require('http') : require('https');
    const peticion = modulo.request(direccion, opciones, function (respuesta) {
      const partes = [];
      respuesta.on('data', function (parte) { partes.push(parte); });
      respuesta.on('end', function () { resolver({ estado: respuesta.statusCode, cuerpo: Buffer.concat(partes) }); });
    });
    peticion.on('error', rechazar);
    peticion.setTimeout(30000, function () { peticion.destroy(new Error('Google no respondió en 30 segundos.')); });
    if (cuerpo) peticion.write(cuerpo);
    peticion.end();
  });
}

// Intenta leer el mensaje de error que manda Google (viene en JSON)
function mensajeDeGoogle(cuerpo) {
  try {
    const j = JSON.parse(cuerpo.toString('utf8'));
    return (j.error && (j.error.message || j.error_description || j.error)) || j.error_description || '';
  } catch (e) {
    return '';
  }
}

async function principal() {
  const credenciales = leerJSON(RUTA_CREDENCIALES, 'la llave de la cuenta de servicio');
  const configuracion = leerJSON(RUTA_CONFIGURACION, 'el identificador del Sheet');
  if (!credenciales.client_email || !credenciales.private_key || !credenciales.token_uri) {
    detener('credenciales-google.json no parece la llave de una cuenta de servicio (faltan client_email, private_key o token_uri).');
  }
  if (!configuracion.id_hoja) detener('configuracion.json no tiene "id_hoja".');

  // ---------- 1. Firmar el pase ----------
  const ahora = Math.floor(Date.now() / 1000);
  const encabezado = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const contenido = base64url(JSON.stringify({
    iss: credenciales.client_email,                              // quién pide: la cuenta de servicio
    scope: 'https://www.googleapis.com/auth/drive.readonly',    // para qué: SOLO LEER
    aud: credenciales.token_uri,
    iat: ahora,
    exp: ahora + 3600
  }));
  let firma;
  try {
    firma = crypto.createSign('RSA-SHA256').update(encabezado + '.' + contenido).sign(credenciales.private_key);
  } catch (e) {
    detener('La llave privada de credenciales-google.json no es válida. Descarga una llave nueva.');
  }
  const pase = encabezado + '.' + contenido + '.' + base64url(firma);

  // ---------- 2. Cambiar el pase por un permiso temporal ----------
  const formulario = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + pase;
  const respuestaPermiso = await pedir(credenciales.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(formulario) }
  }, formulario);
  if (respuestaPermiso.estado !== 200) {
    detener('Google rechazó la llave (' + respuestaPermiso.estado + ' ' + mensajeDeGoogle(respuestaPermiso.cuerpo) +
      '). Revisa que la hora de la computadora sea correcta y que la llave no se haya borrado en Google Cloud.');
  }
  const permiso = JSON.parse(respuestaPermiso.cuerpo.toString('utf8')).access_token;

  // ---------- 3. Pedir el Sheet como Excel ----------
  const url = URL_DRIVE + encodeURIComponent(configuracion.id_hoja) + '/export?mimeType=' + encodeURIComponent(TIPO_EXCEL);
  const respuesta = await pedir(url, { method: 'GET', headers: { Authorization: 'Bearer ' + permiso } });

  if (respuesta.estado === 404) {
    detener('La cuenta de servicio no ve el Sheet. Compártelo, como Lector, con: ' + credenciales.client_email +
      '  (y revisa el "id_hoja" de configuracion.json).');
  }
  if (respuesta.estado === 403) {
    detener('Google no permitió la descarga (' + mensajeDeGoogle(respuesta.cuerpo) + '). ' +
      'Lo más común: falta activar "Google Drive API" en el proyecto de Google Cloud, o el Sheet no está compartido con ' + credenciales.client_email + '.');
  }
  if (respuesta.estado !== 200) {
    detener('Google respondió ' + respuesta.estado + ' ' + mensajeDeGoogle(respuesta.cuerpo));
  }
  // Un .xlsx es un archivo comprimido: siempre empieza con las letras "PK"
  if (respuesta.cuerpo.length < 4 || respuesta.cuerpo.toString('latin1', 0, 2) !== 'PK') {
    detener('Lo que devolvió Google no es un archivo de Excel.');
  }

  fs.writeFileSync(DESTINO, respuesta.cuerpo);
  console.log('Contabilidad descargada: privado/contabilidad.xlsx (' + Math.round(respuesta.cuerpo.length / 1024) + ' KB)');
}

principal().catch(function (error) {
  detener('No se pudo conectar con Google (' + error.message + '). Revisa la conexión a internet.');
});
