const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// Umbrales de referencia por categoría (% del gasto total que se considera "normal"
// para un negocio pequeño). Son puntos de partida razonables, no una norma oficial —
// se pueden ir ajustando con datos reales más adelante.
const REFERENCIA_CATEGORIA = {
  Insumos: 0.45,
  Arriendo: 0.25,
  Servicios: 0.15,
};

// GET /api/negocios/:negocioId/recomendaciones
router.get("/:negocioId/recomendaciones", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const recomendaciones = [];

  // Trae el resumen del mes actual y del mes anterior para poder comparar.
  const totales = await pool.query(
    `SELECT
       date_trunc('month', fecha) AS mes,
       tipo,
       COALESCE(SUM(monto), 0) AS total
     FROM transacciones
     WHERE negocio_id = $1 AND fecha >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
     GROUP BY date_trunc('month', fecha), tipo`,
    [negocioId]
  );

  const mesActual = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const filaEntradasMes = totales.rows.find((f) => f.mes.toISOString() === mesActual && f.tipo === "ingreso");
  const filaSalidasMes = totales.rows.find((f) => f.mes.toISOString() === mesActual && f.tipo === "gasto");
  const entradas = Number(filaEntradasMes?.total || 0);
  const salidas = Number(filaSalidasMes?.total || 0);

  // Regla 1: gastando más de lo que entra.
  if (entradas > 0 && salidas > entradas) {
    recomendaciones.push({
      tipo: "alerta",
      titulo: "Este mes gastaste más de lo que entró",
      detalle: "Revisa si hay algún gasto que se pueda posponer mientras se recupera el flujo de caja.",
    });
  }

  // Regla 2: gasto por categoría fuera del rango de referencia.
  if (salidas > 0) {
    const porCategoria = await pool.query(
      `SELECT c.nombre AS categoria, SUM(t.monto) AS total
       FROM transacciones t
       JOIN categorias c ON c.id = t.categoria_id
       WHERE t.negocio_id = $1 AND t.tipo = 'gasto'
         AND date_trunc('month', t.fecha) = date_trunc('month', CURRENT_DATE)
       GROUP BY c.nombre`,
      [negocioId]
    );

    for (const fila of porCategoria.rows) {
      const referencia = REFERENCIA_CATEGORIA[fila.categoria];
      if (!referencia) continue;
      const proporcion = Number(fila.total) / salidas;
      if (proporcion > referencia + 0.1) {
        recomendaciones.push({
          tipo: "sugerencia",
          titulo: `${fila.categoria} se está llevando el ${Math.round(proporcion * 100)}% de tus gastos`,
          detalle: `Para negocios similares, lo normal ronda el ${Math.round(referencia * 100)}%. Vale la pena revisar si hay margen para negociar con proveedores.`,
        });
      }
    }
  }

  // Regla 3: facturas o cuentas vencidas (reutiliza la misma lógica de alertas).
  const vencidas = await pool.query(
    `SELECT COUNT(*)::int AS total FROM facturas
     WHERE negocio_id = $1 AND estado = 'pendiente' AND fecha_vencimiento < CURRENT_DATE`,
    [negocioId]
  );
  if (vencidas.rows[0].total > 0) {
    recomendaciones.push({
      tipo: "alerta",
      titulo: `Tienes ${vencidas.rows[0].total} factura(s) vencida(s) sin cobrar`,
      detalle: "Cobrar a tiempo es de lo que más ayuda al flujo de caja de un negocio pequeño.",
    });
  }

  // Regla 4: sin movimientos suficientes todavía para dar consejos con sentido.
  if (entradas === 0 && salidas === 0) {
    recomendaciones.push({
      tipo: "info",
      titulo: "Aún no hay suficientes movimientos este mes",
      detalle: "En cuanto registres algunos ingresos y gastos, aquí verás recomendaciones basadas en tu negocio.",
    });
  }

  res.json({ recomendaciones });
});

module.exports = router;
