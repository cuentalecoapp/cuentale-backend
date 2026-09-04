const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// GET /api/negocios/:negocioId/categorias — categorías disponibles para clasificar movimientos
router.get("/:negocioId/categorias", async (req, res) => {
  const { negocioId } = req.params;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    "SELECT id, nombre, tipo, icono FROM categorias WHERE negocio_id = $1 ORDER BY nombre",
    [negocioId]
  );
  res.json(resultado.rows);
});

// GET /api/negocios/:negocioId/transacciones — lista de movimientos, más recientes primero
router.get("/:negocioId/transacciones", async (req, res) => {
  const { negocioId } = req.params;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    `SELECT t.id, t.tipo, t.monto, t.descripcion, t.fecha, c.nombre AS categoria, c.icono
     FROM transacciones t
     LEFT JOIN categorias c ON c.id = t.categoria_id
     WHERE t.negocio_id = $1
     ORDER BY t.fecha DESC, t.creado_en DESC
     LIMIT 50`,
    [negocioId]
  );
  res.json(resultado.rows);
});

// POST /api/negocios/:negocioId/transacciones — registrar un ingreso o gasto
router.post("/:negocioId/transacciones", async (req, res) => {
  const { negocioId } = req.params;
  const { tipo, monto, descripcion, categoria_id, fecha } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!["ingreso", "gasto"].includes(tipo)) {
    return res.status(400).json({ error: "El tipo debe ser 'ingreso' o 'gasto'." });
  }
  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ error: "El monto debe ser mayor a cero." });
  }
  if (!descripcion || !descripcion.trim()) {
    return res.status(400).json({ error: "La descripción es obligatoria." });
  }

  const resultado = await pool.query(
    `INSERT INTO transacciones (negocio_id, categoria_id, tipo, monto, descripcion, fecha)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE))
     RETURNING id, tipo, monto, descripcion, fecha`,
    [negocioId, categoria_id || null, tipo, monto, descripcion.trim(), fecha || null]
  );
  res.status(201).json(resultado.rows[0]);
});

// DELETE /api/negocios/:negocioId/transacciones/:id
router.delete("/:negocioId/transacciones/:id", async (req, res) => {
  const { negocioId, id } = req.params;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  await pool.query("DELETE FROM transacciones WHERE id = $1 AND negocio_id = $2", [id, negocioId]);
  res.status(204).send();
});

// GET /api/negocios/:negocioId/resumen — lo que alimenta el dashboard:
// saldo del mes, total de entradas/salidas, y desglose por categoría de gasto
router.get("/:negocioId/resumen", async (req, res) => {
  const { negocioId } = req.params;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const totales = await pool.query(
    `SELECT
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS entradas,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'gasto'), 0) AS salidas
     FROM transacciones
     WHERE negocio_id = $1 AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)`,
    [negocioId]
  );

  const porCategoria = await pool.query(
    `SELECT c.nombre AS categoria, SUM(t.monto) AS total
     FROM transacciones t
     JOIN categorias c ON c.id = t.categoria_id
     WHERE t.negocio_id = $1 AND t.tipo = 'gasto'
       AND date_trunc('month', t.fecha) = date_trunc('month', CURRENT_DATE)
     GROUP BY c.nombre
     ORDER BY total DESC`,
    [negocioId]
  );

  const { entradas, salidas } = totales.rows[0];
  res.json({
    saldo: Number(entradas) - Number(salidas),
    entradas: Number(entradas),
    salidas: Number(salidas),
    gastosPorCategoria: porCategoria.rows,
  });
});

// GET /api/negocios/:negocioId/reportes/mensual — últimos 6 meses, para la gráfica de reportes
router.get("/:negocioId/reportes/mensual", async (req, res) => {
  const { negocioId } = req.params;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    `SELECT
       to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS entradas,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'gasto'), 0) AS salidas
     FROM transacciones
     WHERE negocio_id = $1 AND fecha >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
     GROUP BY date_trunc('month', fecha)
     ORDER BY date_trunc('month', fecha)`,
    [negocioId]
  );

  res.json(
    resultado.rows.map((fila) => ({
      mes: fila.mes,
      entradas: Number(fila.entradas),
      salidas: Number(fila.salidas),
      saldo: Number(fila.entradas) - Number(fila.salidas),
    }))
  );
});

module.exports = router;
