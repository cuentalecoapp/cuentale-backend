const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// GET /api/negocios/:negocioId/cuentas-por-pagar
router.get("/:negocioId/cuentas-por-pagar", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    `SELECT id, proveedor_nombre, concepto, monto, estado, fecha_vencimiento, creado_en
     FROM cuentas_por_pagar WHERE negocio_id = $1
     ORDER BY (estado = 'pendiente') DESC, fecha_vencimiento NULLS LAST, creado_en DESC`,
    [negocioId]
  );
  res.json(resultado.rows);
});

// POST /api/negocios/:negocioId/cuentas-por-pagar — registrar algo que debes
router.post("/:negocioId/cuentas-por-pagar", async (req, res) => {
  const { negocioId } = req.params;
  const { proveedor_nombre, concepto, monto, fecha_vencimiento } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!proveedor_nombre || !proveedor_nombre.trim()) {
    return res.status(400).json({ error: "El nombre del proveedor es obligatorio." });
  }
  if (!concepto || !concepto.trim()) {
    return res.status(400).json({ error: "Escribe de qué se trata la deuda." });
  }
  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ error: "El monto debe ser mayor a cero." });
  }

  const resultado = await pool.query(
    `INSERT INTO cuentas_por_pagar (negocio_id, proveedor_nombre, concepto, monto, fecha_vencimiento)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, proveedor_nombre, concepto, monto, estado, fecha_vencimiento`,
    [negocioId, proveedor_nombre.trim(), concepto.trim(), monto, fecha_vencimiento || null]
  );
  res.status(201).json(resultado.rows[0]);
});

// PATCH /api/negocios/:negocioId/cuentas-por-pagar/:id/pagar
// Marca como pagada y registra automáticamente el gasto correspondiente.
router.patch("/:negocioId/cuentas-por-pagar/:id/pagar", async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const cuenta = await cliente.query(
      "SELECT * FROM cuentas_por_pagar WHERE id = $1 AND negocio_id = $2 FOR UPDATE",
      [id, negocioId]
    );
    if (cuenta.rows.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ error: "Cuenta no encontrada." });
    }
    if (cuenta.rows[0].estado === "pagada") {
      await cliente.query("ROLLBACK");
      return res.status(409).json({ error: "Esta cuenta ya estaba marcada como pagada." });
    }

    const transaccion = await cliente.query(
      `INSERT INTO transacciones (negocio_id, tipo, monto, descripcion, fecha)
       VALUES ($1, 'gasto', $2, $3, CURRENT_DATE)
       RETURNING id`,
      [negocioId, cuenta.rows[0].monto, `${cuenta.rows[0].proveedor_nombre} — ${cuenta.rows[0].concepto}`]
    );

    const actualizada = await cliente.query(
      `UPDATE cuentas_por_pagar SET estado = 'pagada', transaccion_id = $1
       WHERE id = $2 RETURNING id, proveedor_nombre, concepto, monto, estado, fecha_vencimiento`,
      [transaccion.rows[0].id, id]
    );

    await cliente.query("COMMIT");
    res.json(actualizada.rows[0]);
  } catch (err) {
    await cliente.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo marcar la cuenta como pagada." });
  } finally {
    cliente.release();
  }
});

// GET /api/negocios/:negocioId/alertas — facturas y cuentas vencidas (para avisar en el dashboard)
router.get("/:negocioId/alertas", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const facturasVencidas = await pool.query(
    `SELECT id, numero, cliente_nombre, total, fecha_vencimiento
     FROM facturas
     WHERE negocio_id = $1 AND estado = 'pendiente'
       AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE
     ORDER BY fecha_vencimiento`,
    [negocioId]
  );

  const cuentasVencidas = await pool.query(
    `SELECT id, proveedor_nombre, concepto, monto, fecha_vencimiento
     FROM cuentas_por_pagar
     WHERE negocio_id = $1 AND estado = 'pendiente'
       AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE
     ORDER BY fecha_vencimiento`,
    [negocioId]
  );

  res.json({
    facturasVencidas: facturasVencidas.rows,
    cuentasVencidas: cuentasVencidas.rows,
  });
});

// DELETE /api/negocios/:negocioId/cuentas-por-pagar/:id — borrar deuda y su gasto si aplica
router.delete("/:negocioId/cuentas-por-pagar/:id", async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const cuenta = await cliente.query(
      "SELECT transaccion_id FROM cuentas_por_pagar WHERE id = $1 AND negocio_id = $2",
      [id, negocioId]
    );
    if (cuenta.rows.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ error: "Cuenta no encontrada." });
    }

    // Si estaba pagada, borramos también el gasto que había generado.
    if (cuenta.rows[0].transaccion_id) {
      await cliente.query("DELETE FROM transacciones WHERE id = $1", [cuenta.rows[0].transaccion_id]);
    }

    await cliente.query("DELETE FROM cuentas_por_pagar WHERE id = $1 AND negocio_id = $2", [id, negocioId]);
    await cliente.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await cliente.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo borrar la cuenta." });
  } finally {
    cliente.release();
  }
});

module.exports = router;
