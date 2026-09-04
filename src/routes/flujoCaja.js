const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth").requireAuth;
const { tieneAcceso } = require("../db/acceso");

router.use(requireAuth);

// Proyección de flujo de caja en lenguaje simple.
// Responde: ¿cuánto dinero va a quedar al final del periodo que elija el usuario?
// Cruza: saldo actual (ingresos - gastos ya registrados)
//        + lo que le deben (facturas pendientes) que caben en el periodo
//        - lo que debe pagar (cuentas por pagar pendientes) que vencen en el periodo
router.get("/:negocioId/flujo-caja", async (req, res) => {
  const { negocioId } = req.params;
  // El usuario elige hasta qué fecha proyectar. Por defecto, fin del mes actual.
  const { hasta } = req.query;

  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }

    // Fecha límite de la proyección
    let fechaHasta;
    if (hasta) {
      fechaHasta = new Date(hasta);
      if (isNaN(fechaHasta.getTime())) {
        return res.status(400).json({ error: "La fecha no es válida." });
      }
    } else {
      // fin del mes actual
      const hoy = new Date();
      fechaHasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    }
    const fechaHastaStr = fechaHasta.toISOString().slice(0, 10);

    // 1. Saldo actual: todo lo que ya entró menos lo que ya salió
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

    // 2. Lo que le deben: facturas pendientes (dinero que va a entrar)
    const porCobrarQ = await pool.query(
      `SELECT COALESCE(SUM(total), 0) AS total
       FROM facturas
       WHERE negocio_id = $1 AND estado = 'pendiente'`,
      [negocioId]
    );
    const porCobrar = Number(porCobrarQ.rows[0].total);

    // 3. Lo que debe pagar hasta la fecha elegida (dinero que va a salir)
    //    Incluye las que no tienen fecha (se asumen pronto) y las que vencen dentro del periodo.
    const porPagarQ = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total
       FROM cuentas_por_pagar
       WHERE negocio_id = $1 AND estado = 'pendiente'
         AND (fecha_vencimiento IS NULL OR fecha_vencimiento <= $2)`,
      [negocioId, fechaHastaStr]
    );
    const porPagar = Number(porPagarQ.rows[0].total);

    // El número clave: cuánto quedaría
    const proyectado = saldoActual + porCobrar - porPagar;

    // Mensaje en lenguaje natural, según el resultado
    let estado, mensaje;
    if (proyectado > 0 && porPagar > 0 && proyectado < porPagar * 0.2) {
      // Le queda muy poquito margen
      estado = "ajustado";
      mensaje = "Te va a alcanzar, pero muy justo. Ojo con los gastos extra este periodo.";
    } else if (proyectado >= 0) {
      estado = "bien";
      mensaje = "Vas bien. Con lo que tienes y lo que te deben, te alcanza para cubrir tus pagos.";
    } else {
      estado = "alerta";
      const falta = Math.abs(proyectado);
      mensaje = `Ojo: te faltarían $${falta.toLocaleString("es-CO")} para cubrir todo. Trata de cobrar lo que te deben o aplaza algún gasto.`;
    }

    res.json({
      hasta: fechaHastaStr,
      saldoActual,
      porCobrar,
      porPagar,
      proyectado,
      estado,
      mensaje,
    });
  } catch (err) {
    console.error("Error en flujo de caja:", err);
    res.status(500).json({ error: "No pudimos calcular tu proyección. Intenta de nuevo." });
  }
});

module.exports = router;
