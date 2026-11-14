// =============================================================
// actualizar.js
// Un solo comando para actualizar el panel de la junta.
// Corre los pasos en orden y se detiene si uno falla:
//
//   1. descargar-sheet.js -> baja la contabilidad desde Google (si está configurado)
//   2. importar-excel.js  -> lee la contabilidad y revisa los controles
//   3. cifrar-junta.js    -> pide la contraseña de la junta y cifra los datos
//   4. validar.js         -> confirma que todo está listo para publicar
//
// Uso:  node herramientas/actualizar.js
//
// Si existe privado/credenciales-google.json, la contabilidad se descarga sola.
// Si no existe, se usa el .xlsx que tú hayas dejado en privado/ (uno solo).
// =============================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const hayCredenciales = fs.existsSync(path.join(RAIZ, 'privado', 'credenciales-google.json'));

// Cada paso: [programa, lo que hace, argumentos]
const pasos = [];
if (hayCredenciales) {
  pasos.push(['descargar-sheet.js', 'Descargando la contabilidad desde Google', []]);
  // Se le indica al importador que use justo el archivo recién descargado
  pasos.push(['importar-excel.js', 'Leyendo la contabilidad', [path.join(RAIZ, 'privado', 'contabilidad.xlsx')]]);
} else {
  console.log('Descarga automática sin configurar: se usa el .xlsx que está en privado/.');
  pasos.push(['importar-excel.js', 'Leyendo la contabilidad', []]);
}
pasos.push(['cifrar-junta.js', 'Cifrando los datos para la junta', []]);
pasos.push(['validar.js', 'Revisando que todo esté listo', []]);

pasos.forEach(function (paso, i) {
  console.log('\n===== Paso ' + (i + 1) + ' de ' + pasos.length + ': ' + paso[1] + ' =====');
  // stdio: 'inherit' deja que el paso use esta misma terminal (para escribir la contraseña)
  const resultado = spawnSync(process.execPath, [path.join(__dirname, paso[0])].concat(paso[2]), { stdio: 'inherit' });
  if (resultado.status !== 0) {
    console.error('\nSe detuvo en el paso ' + (i + 1) + ' (' + paso[0] + '). No publiques hasta corregirlo.');
    process.exit(1);
  }
});

console.log('\nListo. Revisa el panel con:  node herramientas/servidor.js');
console.log('Para publicar, en la consola:');
console.log('  git status                 (no debe aparecer nada de privado/)');
console.log('  git add docs/data/junta.cifrado.json');
console.log('  git commit -m "Actualización corte DD/MM/AAAA"');
console.log('  git push');
