const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/auth").requireAuth;
const { tieneAcceso } = require("../db/acceso");
const { calcularFlujoCaja } = require("../utils/flujoCaja");

router.use(requireAuth);

// Proyección de flujo de caja en lenguaje simple.
// Responde: ¿cuánto dinero va a quedar al final del periodo que elija el usuario?
// La lógica real vive en utils/flujoCaja.js, compartida también con WhatsApp.
router.get("/:negocioId/flujo-caja", async (req, res) => {
  const { negocioId } = req.params;
  const { hasta } = req.query;

  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }

    const resultado = await calcularFlujoCaja(negocioId, hasta);
    res.json(resultado);
  } catch (err) {
    if (err.message === "FECHA_INVALIDA") {
      return res.status(400).json({ error: "La fecha no es válida." });
    }
    console.error("Error en flujo de caja:", err);
    res.status(500).json({ error: "No pudimos calcular tu proyección. Intenta de nuevo." });
  }
});

module.exports = router;
