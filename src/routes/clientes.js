const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// GET /api/negocios/:negocioId/clientes — lista de clientes frecuentes
router.get("/:negocioId/clientes", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    "SELECT id, nombre, contacto FROM clientes WHERE negocio_id = $1 ORDER BY nombre",
    [negocioId]
  );
  res.json(resultado.rows);
});

// POST /api/negocios/:negocioId/clientes — guardar un cliente nuevo para reusarlo después
router.post("/:negocioId/clientes", async (req, res) => {
  const { negocioId } = req.params;
  const { nombre, contacto } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre del cliente es obligatorio." });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO clientes (negocio_id, nombre, contacto)
       VALUES ($1, $2, $3)
       ON CONFLICT (negocio_id, nombre) DO UPDATE SET contacto = EXCLUDED.contacto
       RETURNING id, nombre, contacto`,
      [negocioId, nombre.trim(), contacto || null]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo guardar el cliente." });
  }
});

module.exports = router;
