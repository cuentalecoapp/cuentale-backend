const pool = require("../db/pool");

// Todo el cálculo de "¿Cómo vas para fin de mes?" vive aquí, en un solo lugar,
// para que tanto la app web como WhatsApp usen exactamente la misma lógica
// y nunca puedan mostrar números distintos por accidente.

function finDeMesActual() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
}

// Encuentra la cuenta por pagar pendiente que más "pesa" en el resultado
// (la de mayor monto), para poder explicar el porqué en una frase simple.
async function mayorCuentaPorPagar(negocioId, fechaHastaStr) {
  const resultado = await pool.query(
    `SELECT proveedor_nombre, concepto, monto, fecha_vencimiento
     FROM cuentas_por_pagar
     WHERE negocio_id = $1 AND estado = 'pendiente'
       AND (fecha_vencimiento IS NULL OR fecha_vencimiento <= $2)
     ORDER BY monto DESC
     LIMIT 1`,
    [negocioId, fechaHastaStr]
  );
  return resultado.rows[0] || null;
}

// Compara el dinero neto (ingresos - gastos) del mes actual, hasta hoy,
// contra el mismo tramo de días del mes anterior — para que la comparación
// sea justa (no todo el mes pasado contra solo unos días de este mes).
async function compararConMesAnterior(negocioId) {
  const hoy = new Date();
  const diaDeHoy = hoy.getDate();

  const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const inicioMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  // Mismo día del mes pasado (si el mes pasado tiene menos días, usa el último día disponible)
  const ultimoDiaMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0).getDate();
  const finMesAnteriorComparable = new Date(
    hoy.getFullYear(),
    hoy.getMonth() - 1,
    Math.min(diaDeHoy, ultimoDiaMesAnterior)
  );

  const fmt = (d) => d.toISOString().slice(0, 10);

  const resultado = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN fecha >= $2 AND tipo = 'ingreso' THEN monto ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN fecha >= $2 AND tipo = 'gasto' THEN monto ELSE 0 END), 0) AS neto_actual,
       COALESCE(SUM(CASE WHEN fecha BETWEEN $3 AND $4 AND tipo = 'ingreso' THEN monto ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN fecha BETWEEN $3 AND $4 AND tipo = 'gasto' THEN monto ELSE 0 END), 0) AS neto_mes_anterior
     FROM transacciones
     WHERE negocio_id = $1`,
    [negocioId, fmt(inicioMesActual), fmt(inicioMesAnterior), fmt(finMesAnteriorComparable)]
  );

  const netoActual = Number(resultado.rows[0].neto_actual);
  const netoMesAnterior = Number(resultado.rows[0].neto_mes_anterior);
  const diferencia = netoActual - netoMesAnterior;

  let comparacion;
  if (Math.abs(diferencia) < 1000) {
    comparacion = "Vas prácticamente igual que el mes pasado a estas alturas.";
  } else if (diferencia > 0) {
    comparacion = `Vas $${diferencia.toLocaleString("es-CO")} mejor que el mes pasado a estas alturas del mes. 📈`;
  } else {
    comparacion = `Vas $${Math.abs(diferencia).toLocaleString("es-CO")} más flojo que el mes pasado a estas alturas del mes.`;
  }

  return { netoActual, netoMesAnterior, diferencia, comparacion };
}

async function calcularFlujoCaja(negocioId, hasta) {
  let fechaHasta;
  if (hasta) {
    fechaHasta = new Date(hasta);
    if (isNaN(fechaHasta.getTime())) {
      throw new Error("FECHA_INVALIDA");
    }
  } else {
    fechaHasta = finDeMesActual();
  }
  const fechaHastaStr = fechaHasta.toISOString().slice(0, 10);

  const saldoQ = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
       COALESCE(SUM(CASE WHEN tipo = 'gasto' THEN monto ELSE 0 END), 0) AS gastos
     FROM transacciones WHERE negocio_id = $1`,
    [negocioId]
  );
  const ingresos = Number(saldoQ.rows[0].ingresos);
  const gastos = Number(saldoQ.rows[0].gastos);
  const saldoActual = ingresos - gastos;

  const porCobrarQ = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS total FROM facturas WHERE negocio_id = $1 AND estado = 'pendiente'`,
    [negocioId]
  );
  const porCobrar = Number(porCobrarQ.rows[0].total);

  const porPagarQ = await pool.query(
    `SELECT COALESCE(SUM(monto), 0) AS total
     FROM cuentas_por_pagar
     WHERE negocio_id = $1 AND estado = 'pendiente'
       AND (fecha_vencimiento IS NULL OR fecha_vencimiento <= $2)`,
    [negocioId, fechaHastaStr]
  );
  const porPagar = Number(porPagarQ.rows[0].total);

  const proyectado = saldoActual + porCobrar - porPagar;

  // estado + semáforo: mismo significado, dos formas de mostrarlo
  // (palabra para el mensaje escrito, color para el vistazo rápido)
  let estado, semaforo, mensaje;
  if (proyectado > 0 && porPagar > 0 && proyectado < porPagar * 0.2) {
    estado = "ajustado";
    semaforo = "amarillo";
    mensaje = "Te va a alcanzar, pero muy justo. Ojo con los gastos extra este periodo.";
  } else if (proyectado >= 0) {
    estado = "bien";
    semaforo = "verde";
    mensaje = "Vas bien. Con lo que tienes y lo que te deben, te alcanza para cubrir tus pagos.";
  } else {
    estado = "alerta";
    semaforo = "rojo";
    const falta = Math.abs(proyectado);
    mensaje = `Ojo: te faltarían $${falta.toLocaleString("es-CO")} para cubrir todo. Trata de cobrar lo que te deben o aplaza algún gasto.`;
  }

  // El "porqué" en una frase: si hay una cuenta por pagar que pesa mucho, la nombramos.
  let porque = null;
  if (porPagar > 0) {
    const cuenta = await mayorCuentaPorPagar(negocioId, fechaHastaStr);
    if (cuenta) {
      const cuandoTexto = cuenta.fecha_vencimiento
        ? ` el ${new Date(cuenta.fecha_vencimiento).toLocaleDateString("es-CO", { day: "numeric", month: "long" })}`
        : " pronto";
      porque = `Buena parte es porque${cuandoTexto} debes pagar ${cuenta.concepto} (${cuenta.proveedor_nombre}) por $${Number(cuenta.monto).toLocaleString("es-CO")}.`;
    }
  }

  const { comparacion } = await compararConMesAnterior(negocioId);

  return {
    hasta: fechaHastaStr,
    saldoActual,
    porCobrar,
    porPagar,
    proyectado,
    estado,
    semaforo,
    mensaje,
    porque,
    comparacion,
  };
}

module.exports = { calcularFlujoCaja };
