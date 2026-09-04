const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// GET /api/negocios/:negocioId/productos
router.get("/:negocioId/productos", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    `SELECT id, nombre, sku, precio_venta, stock_actual, stock_minimo
     FROM productos WHERE negocio_id = $1 ORDER BY nombre`,
    [negocioId]
  );
  res.json(resultado.rows);
});

// POST /api/negocios/:negocioId/productos — crear producto nuevo
router.post("/:negocioId/productos", async (req, res) => {
  const { negocioId } = req.params;
  const { nombre, sku, precio_venta, stock_actual, stock_minimo } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre del producto es obligatorio." });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO productos (negocio_id, nombre, sku, precio_venta, stock_actual, stock_minimo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, sku, precio_venta, stock_actual, stock_minimo`,
      [
        negocioId,
        nombre.trim(),
        sku || null,
        Number(precio_venta) || 0,
        Number(stock_actual) || 0,
        Number(stock_minimo) || 0,
      ]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya tienes un producto con ese nombre." });
    }
    console.error(err);
    res.status(500).json({ error: "No se pudo crear el producto." });
  }
});

// PATCH /api/negocios/:negocioId/productos/:id/ajustar-stock
// Suma o resta unidades del stock (ej. llegó mercancía, o se dañó producto).
router.patch("/:negocioId/productos/:id/ajustar-stock", async (req, res) => {
  const { negocioId, id } = req.params;
  const { cantidad } = req.body; // positivo suma, negativo resta

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (cantidad === undefined || Number(cantidad) === 0) {
    return res.status(400).json({ error: "Indica una cantidad distinta de cero." });
  }

  const resultado = await pool.query(
    `UPDATE productos SET stock_actual = stock_actual + $1
     WHERE id = $2 AND negocio_id = $3
     RETURNING id, nombre, sku, precio_venta, stock_actual, stock_minimo`,
    [Number(cantidad), id, negocioId]
  );
  if (resultado.rows.length === 0) {
    return res.status(404).json({ error: "Producto no encontrado." });
  }
  res.json(resultado.rows[0]);
});

// DELETE /api/negocios/:negocioId/productos/:id
router.delete("/:negocioId/productos/:id", async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  await pool.query("DELETE FROM productos WHERE id = $1 AND negocio_id = $2", [id, negocioId]);
  res.status(204).send();
});

module.exports = router;
