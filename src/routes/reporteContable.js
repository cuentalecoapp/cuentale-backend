const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// GET /api/negocios/:negocioId/reporte-contable?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve movimientos, facturas y cuentas por pagar en un formato detallado
// pensado para que el contador lo trabaje. El frontend lo convierte en Excel.
router.get("/:negocioId/reporte-contable", async (req, res) => {
  const { negocioId } = req.params;
  const { desde, hasta } = req.query;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  // Rango por defecto: el mes actual completo si no mandan fechas.
  const filtroFecha = desde && hasta ? "AND t.fecha BETWEEN $2 AND $3" : "";
  const params = desde && hasta ? [negocioId, desde, hasta] : [negocioId];

  const negocio = await pool.query(
    "SELECT nombre, nit, direccion, telefono, correo, ciudad, logo FROM negocios WHERE id = $1",
    [negocioId]
  );

  const movimientos = await pool.query(
    `SELECT
       t.fecha,
       t.tipo,
       COALESCE(c.nombre, 'Sin categoría') AS categoria,
       t.descripcion,
       t.monto,
       t.creado_en
     FROM transacciones t
     LEFT JOIN categorias c ON c.id = t.categoria_id
     WHERE t.negocio_id = $1 ${filtroFecha}
     ORDER BY t.fecha, t.creado_en`,
    params
  );

  const facturas = await pool.query(
    `SELECT numero, cliente_nombre, cliente_contacto, estado, total, fecha, fecha_vencimiento
     FROM facturas
     WHERE negocio_id = $1
     ORDER BY numero`,
    [negocioId]
  );

  const cuentasPorPagar = await pool.query(
    `SELECT proveedor_nombre, concepto, monto, estado, fecha_vencimiento, creado_en
     FROM cuentas_por_pagar
     WHERE negocio_id = $1
     ORDER BY creado_en`,
    [negocioId]
  );

  res.json({
    negocio: negocio.rows[0]?.nombre || "Negocio",
    negocioInfo: negocio.rows[0] || {},
    generadoEn: new Date().toISOString(),
    rango: desde && hasta ? { desde, hasta } : null,
    movimientos: movimientos.rows,
    facturas: facturas.rows,
    cuentasPorPagar: cuentasPorPagar.rows,
  });
});

module.exports = router;
