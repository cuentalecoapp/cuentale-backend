const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

router.use(requireAuth);

// GET /api/negocios/:negocioId/categorias — lista las categorías del negocio
// Se puede filtrar por tipo con ?tipo=ingreso o ?tipo=gasto
router.get("/:negocioId/categorias", async (req, res) => {
  const { negocioId } = req.params;
  const { tipo } = req.query;

  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }

    let consulta = "SELECT id, nombre, tipo, icono FROM categorias WHERE negocio_id = $1";
    const params = [negocioId];
    if (tipo === "ingreso" || tipo === "gasto") {
      consulta += " AND tipo = $2";
      params.push(tipo);
    }
    consulta += " ORDER BY nombre";

    const resultado = await pool.query(consulta, params);
    res.json(resultado.rows);
  } catch (err) {
    console.error("Error al listar categorías:", err);
    res.status(500).json({ error: "No pudimos cargar las categorías." });
  }
});

// POST /api/negocios/:negocioId/categorias — crea una categoría personalizada
router.post("/:negocioId/categorias", async (req, res) => {
  const { negocioId } = req.params;
  const { nombre, tipo, icono } = req.body;

  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio." });
    }
    if (tipo !== "ingreso" && tipo !== "gasto") {
      return res.status(400).json({ error: "El tipo debe ser ingreso o gasto." });
    }

    // Evitar duplicados
    const existente = await pool.query(
      "SELECT id FROM categorias WHERE negocio_id = $1 AND nombre = $2 AND tipo = $3",
      [negocioId, nombre.trim(), tipo]
    );
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: "Ya tienes una categoría con ese nombre." });
    }

    const resultado = await pool.query(
      `INSERT INTO categorias (negocio_id, nombre, tipo, icono)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, tipo, icono`,
      [negocioId, nombre.trim(), tipo, icono || "ti-tag"]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    console.error("Error al crear categoría:", err);
    res.status(500).json({ error: "No pudimos crear la categoría." });
  }
});

// DELETE /api/negocios/:negocioId/categorias/:categoriaId — borra una categoría
router.delete("/:negocioId/categorias/:categoriaId", async (req, res) => {
  const { negocioId, categoriaId } = req.params;

  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }
    // Al borrar, las transacciones que la usaban quedan con categoria_id = null (por el ON DELETE SET NULL)
    await pool.query("DELETE FROM categorias WHERE id = $1 AND negocio_id = $2", [categoriaId, negocioId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error al borrar categoría:", err);
    res.status(500).json({ error: "No pudimos borrar la categoría." });
  }
});

module.exports = router;
