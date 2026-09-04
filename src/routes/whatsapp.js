const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");
const { parsearMensaje } = require("../utils/parsearMensajeWhatsapp");

const router = express.Router();

function respuestaTwiml(mensaje) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${mensaje}</Message></Response>`;
}

// POST /api/whatsapp/webhook — Twilio manda aquí cada mensaje entrante.
// Es una ruta pública (Twilio no tiene tu token de sesión), por eso NO lleva requireAuth.
router.post("/whatsapp/webhook", async (req, res) => {
  res.type("text/xml");

  const numeroCrudo = req.body.From || ""; // formato: "whatsapp:+573001234567"
  const numero = numeroCrudo.replace("whatsapp:", "").trim();
  const texto = (req.body.Body || "").trim();

  if (!numero || !texto) {
    return res.send(respuestaTwiml("No recibí ningún mensaje entendible."));
  }

  const vinculo = await pool.query(
    "SELECT negocio_id FROM whatsapp_numeros WHERE numero = $1",
    [numero]
  );

  if (vinculo.rows.length === 0) {
    return res.send(
      respuestaTwiml(
        "Este número todavía no está vinculado a ningún negocio. Entra a la app, ve a Equipo, y vincula este número primero."
      )
    );
  }

  const negocioId = vinculo.rows[0].negocio_id;
  const { tipo, monto, descripcion } = parsearMensaje(texto);

  if (!tipo || !monto) {
    return res.send(
      respuestaTwiml(
        'No logré entender el movimiento. Escríbelo así: "vendí 50 mil en pan" o "gasté 30000 en harina".'
      )
    );
  }

  try {
    let categoriaId = null;
    if (tipo === "ingreso") {
      const cat = await pool.query(
        "SELECT id FROM categorias WHERE negocio_id = $1 AND nombre = 'Ventas' LIMIT 1",
        [negocioId]
      );
      categoriaId = cat.rows[0]?.id || null;
    }

    await pool.query(
      `INSERT INTO transacciones (negocio_id, categoria_id, tipo, monto, descripcion, fecha)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
      [negocioId, categoriaId, tipo, monto, descripcion || (tipo === "ingreso" ? "Ingreso por WhatsApp" : "Gasto por WhatsApp")]
    );

    const formato = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
    const verbo = tipo === "ingreso" ? "Ingreso" : "Gasto";
    res.send(respuestaTwiml(`✅ ${verbo} de ${formato.format(monto)} registrado${descripcion ? ` (${descripcion})` : ""}.`));
  } catch (err) {
    console.error(err);
    res.send(respuestaTwiml("Hubo un problema al registrar el movimiento. Intenta de nuevo o hazlo desde la app."));
  }
});

// GET /api/negocios/:negocioId/whatsapp — números vinculados a este negocio
router.get("/negocios/:negocioId/whatsapp", requireAuth, async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  const resultado = await pool.query(
    "SELECT id, numero, creado_en FROM whatsapp_numeros WHERE negocio_id = $1 ORDER BY creado_en",
    [negocioId]
  );
  res.json(resultado.rows);
});

// POST /api/negocios/:negocioId/whatsapp — vincular un número nuevo
router.post("/negocios/:negocioId/whatsapp", requireAuth, async (req, res) => {
  const { negocioId } = req.params;
  const { numero } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!numero || !numero.trim()) {
    return res.status(400).json({ error: "Escribe el número de WhatsApp, con indicativo (ej. +573001234567)." });
  }

  try {
    const resultado = await pool.query(
      "INSERT INTO whatsapp_numeros (negocio_id, numero) VALUES ($1, $2) RETURNING id, numero, creado_en",
      [negocioId, numero.trim()]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese número ya está vinculado (a este negocio o a otro)." });
    }
    console.error(err);
    res.status(500).json({ error: "No se pudo vincular el número." });
  }
});

// DELETE /api/negocios/:negocioId/whatsapp/:id — desvincular un número
router.delete("/negocios/:negocioId/whatsapp/:id", requireAuth, async (req, res) => {
  const { negocioId, id } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  await pool.query("DELETE FROM whatsapp_numeros WHERE id = $1 AND negocio_id = $2", [id, negocioId]);
  res.status(204).send();
});

module.exports = router;
