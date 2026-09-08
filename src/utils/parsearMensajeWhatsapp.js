// Interpreta mensajes en lenguaje natural como "vendí 50 mil en pan" o
// "gasté 30000 en harina" y los convierte en un movimiento financiero.
// Es un intérprete basado en reglas simples, no inteligencia artificial —
// funciona bien para frases cortas y directas, como las que la gente
// realmente escribe en WhatsApp.

const PALABRAS_INGRESO = /(vend|ingres|cobr[eé]|entr[oó]|gan[eé])/i;
const PALABRAS_GASTO = /(gast[eé]|compr[eé]|pagu[eé]|sali[oó])/i;

function parsearMensaje(textoOriginal) {
  const texto = textoOriginal.toLowerCase().trim();

  let tipo = null;
  if (PALABRAS_GASTO.test(texto)) tipo = "gasto";
  else if (PALABRAS_INGRESO.test(texto)) tipo = "ingreso";

  let monto = null;
  const coincidenciaMil = texto.match(/(\d+(?:[.,]\d+)?)\s*mil/);
  if (coincidenciaMil) {
    monto = parseFloat(coincidenciaMil[1].replace(",", ".")) * 1000;
  } else {
    // Primero probamos un número con puntos/comas de miles (ej. "20.000"),
    // y si no hay, aceptamos cualquier cantidad de dígitos seguidos (ej. "20000")
    // — antes esto se quedaba solo con los primeros 3 dígitos y perdía el resto.
    const coincidenciaNumero = texto.match(/\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?/);
    if (coincidenciaNumero) {
      monto = Number(coincidenciaNumero[0].replace(/\./g, "").replace(",", "."));
    }
  }

  let descripcion = null;
  const coincidenciaDescripcion = texto.match(/(?:en|de|por)\s+(.+)$/);
  if (coincidenciaDescripcion) {
    descripcion = coincidenciaDescripcion[1].trim();
  }

  return { tipo, monto, descripcion };
}

module.exports = { parsearMensaje };
