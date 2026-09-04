const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const router = express.Router();
const SALT_ROUNDS = 12;

router.post("/registro", async (req, res) => {
  const { nombre, correo, password } = req.body;

  if (!nombre || !correo || !password) {
    return res.status(400).json({ error: "Nombre, correo y contraseña son obligatorios." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  }

  try {
    const existente = await pool.query("SELECT id FROM usuarios WHERE correo = $1", [correo]);
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, correo, password_hash)
       VALUES ($1, $2, $3) RETURNING id, nombre, correo`,
      [nombre, correo, passwordHash]
    );

    const usuario = resultado.rows[0];
    const token = jwt.sign({ usuarioId: usuario.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ usuario, token });
  } catch (err) {
    console.error(err);
    // TEMPORAL: mostramos el detalle del error para diagnosticar
    res.status(500).json({ error: "No se pudo crear la cuenta.", detalle: err.message });
  }
});

router.post("/login", async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
  }

  try {
    const resultado = await pool.query(
      "SELECT id, nombre, correo, password_hash FROM usuarios WHERE correo = $1",
      [correo]
    );
    const usuario = resultado.rows[0];

    // Mismo mensaje si el correo no existe o la contraseña es incorrecta:
    // no revelamos cuál de las dos falló, por seguridad.
    if (!usuario || !(await bcrypt.compare(password, usuario.password_hash))) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    const token = jwt.sign({ usuarioId: usuario.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({
      usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo iniciar sesión." });
  }
});

module.exports = router;
