const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// GET /api/negocios/:negocioId/facturas — lista, más recientes primero
router.get("/:negocioId/facturas", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    `SELECT id, numero, cliente_nombre, estado, total, fecha, fecha_vencimiento
     FROM facturas WHERE negocio_id = $1
     ORDER BY numero DESC`,
    [negocioId]
  );
  res.json(resultado.rows);
});

// GET /api/negocios/:negocioId/facturas/:id — detalle con sus ítems
router.get("/:negocioId/facturas/:id", async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const factura = await pool.query(
    `SELECT f.*, n.nombre AS negocio_nombre, n.nit AS negocio_nit,
            n.direccion AS negocio_direccion, n.telefono AS negocio_telefono,
            n.correo AS negocio_correo, n.ciudad AS negocio_ciudad, n.logo AS negocio_logo
     FROM facturas f JOIN negocios n ON n.id = f.negocio_id
     WHERE f.id = $1 AND f.negocio_id = $2`,
    [id, negocioId]
  );
  if (factura.rows.length === 0) {
    return res.status(404).json({ error: "Factura no encontrada." });
  }

  const items = await pool.query(
    `SELECT descripcion, cantidad, precio_unitario, orden
     FROM factura_items WHERE factura_id = $1 ORDER BY orden`,
    [id]
  );

  res.json({ ...factura.rows[0], items: items.rows });
});

// POST /api/negocios/:negocioId/facturas — crear factura con sus ítems
router.post("/:negocioId/facturas", async (req, res) => {
  const { negocioId } = req.params;
  const { cliente_nombre, cliente_contacto, notas, items, fecha_vencimiento } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!cliente_nombre || !cliente_nombre.trim()) {
    return res.status(400).json({ error: "El nombre del cliente es obligatorio." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Agrega al menos un producto o servicio." });
  }
  for (const item of items) {
    if (!item.descripcion || !item.descripcion.trim()) {
      return res.status(400).json({ error: "Cada ítem necesita una descripción." });
    }
    if (!item.cantidad || Number(item.cantidad) <= 0) {
      return res.status(400).json({ error: "La cantidad debe ser mayor a cero." });
    }
    if (item.precio_unitario === undefined || Number(item.precio_unitario) < 0) {
      return res.status(400).json({ error: "El precio unitario no puede ser negativo." });
    }
  }

  const total = items.reduce(
    (suma, item) => suma + Number(item.cantidad) * Number(item.precio_unitario),
    0
  );

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const numeroResultado = await cliente.query(
      "SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM facturas WHERE negocio_id = $1",
      [negocioId]
    );
    const numero = numeroResultado.rows[0].siguiente;

    // Guarda (o actualiza) el cliente automáticamente, así queda disponible
    // para elegirlo rápido la próxima vez que factures.
    await cliente.query(
      `INSERT INTO clientes (negocio_id, nombre, contacto)
       VALUES ($1, $2, $3)
       ON CONFLICT (negocio_id, nombre) DO UPDATE SET contacto = COALESCE(EXCLUDED.contacto, clientes.contacto)`,
      [negocioId, cliente_nombre.trim(), cliente_contacto || null]
    );

    const factura = await cliente.query(
      `INSERT INTO facturas (negocio_id, numero, cliente_nombre, cliente_contacto, notas, total, fecha_vencimiento)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, numero, cliente_nombre, estado, total, fecha, fecha_vencimiento`,
      [negocioId, numero, cliente_nombre.trim(), cliente_contacto || null, notas || null, total, fecha_vencimiento || null]
    );
    const facturaId = factura.rows[0].id;

    let orden = 0;
    for (const item of items) {
      await cliente.query(
        `INSERT INTO factura_items (factura_id, descripcion, cantidad, precio_unitario, orden, producto_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [facturaId, item.descripcion.trim(), item.cantidad, item.precio_unitario, orden++, item.producto_id || null]
      );

      // Si el ítem viene de un producto del inventario, descuenta el stock vendido.
      if (item.producto_id) {
        await cliente.query(
          "UPDATE productos SET stock_actual = stock_actual - $1 WHERE id = $2 AND negocio_id = $3",
          [item.cantidad, item.producto_id, negocioId]
        );
      }
    }

    await cliente.query("COMMIT");
    res.status(201).json(factura.rows[0]);
  } catch (err) {
    await cliente.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo crear la factura." });
  } finally {
    cliente.release();
  }
});

// PATCH /api/negocios/:negocioId/facturas/:id/pagar
// Marca la factura como pagada y crea automáticamente el ingreso correspondiente.
router.patch("/:negocioId/facturas/:id/pagar", async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const factura = await cliente.query(
      "SELECT * FROM facturas WHERE id = $1 AND negocio_id = $2 FOR UPDATE",
      [id, negocioId]
    );
    if (factura.rows.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ error: "Factura no encontrada." });
    }
    if (factura.rows[0].estado === "pagada") {
      await cliente.query("ROLLBACK");
      return res.status(409).json({ error: "Esta factura ya estaba marcada como pagada." });
    }

    const categoriaVentas = await cliente.query(
      "SELECT id FROM categorias WHERE negocio_id = $1 AND nombre = 'Ventas' LIMIT 1",
      [negocioId]
    );

    const transaccion = await cliente.query(
      `INSERT INTO transacciones (negocio_id, categoria_id, tipo, monto, descripcion, fecha)
       VALUES ($1, $2, 'ingreso', $3, $4, CURRENT_DATE)
       RETURNING id`,
      [
        negocioId,
        categoriaVentas.rows[0]?.id || null,
        factura.rows[0].total,
        `Factura #${factura.rows[0].numero} — ${factura.rows[0].cliente_nombre}`,
      ]
    );

    const facturaActualizada = await cliente.query(
      `UPDATE facturas SET estado = 'pagada', transaccion_id = $1
       WHERE id = $2 RETURNING id, numero, cliente_nombre, estado, total, fecha`,
      [transaccion.rows[0].id, id]
    );

    await cliente.query("COMMIT");
    res.json(facturaActualizada.rows[0]);
  } catch (err) {
    await cliente.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo marcar la factura como pagada." });
  } finally {
    cliente.release();
  }
});

// DELETE /api/negocios/:negocioId/facturas/:id — borrar factura y devolver stock si aplica
router.delete("/:negocioId/facturas/:id", async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const factura = await cliente.query(
      "SELECT estado, transaccion_id FROM facturas WHERE id = $1 AND negocio_id = $2",
      [id, negocioId]
    );
    if (factura.rows.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ error: "Factura no encontrada." });
    }

    // Si la factura tenía ítems del inventario, devolvemos el stock que se había descontado.
    const items = await cliente.query(
      "SELECT producto_id, cantidad FROM factura_items WHERE factura_id = $1 AND producto_id IS NOT NULL",
      [id]
    );
    for (const item of items.rows) {
      await cliente.query(
        "UPDATE productos SET stock_actual = stock_actual + $1 WHERE id = $2 AND negocio_id = $3",
        [item.cantidad, item.producto_id, negocioId]
      );
    }

    // Si estaba pagada, borramos también el ingreso que había generado.
    if (factura.rows[0].transaccion_id) {
      await cliente.query("DELETE FROM transacciones WHERE id = $1", [factura.rows[0].transaccion_id]);
    }

    await cliente.query("DELETE FROM facturas WHERE id = $1 AND negocio_id = $2", [id, negocioId]);
    await cliente.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await cliente.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo borrar la factura." });
  } finally {
    cliente.release();
  }
});

module.exports = router;
