const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const router = express.Router();
const SALT_ROUNDS = 12;

// ===== Límite de intentos de login (protección anti fuerza bruta) =====
// Guardamos en memoria cuántos intentos fallidos lleva cada correo/IP.
// Si supera el máximo, se bloquea por unos minutos.
const intentos = new Map(); // clave: correo+ip -> { conteo, hasta }
const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 10;

function claveIntento(correo, ip) {
  return `${(correo || "").toLowerCase()}|${ip}`;
}

function estaBloqueado(clave) {
  const registro = intentos.get(clave);
  if (!registro) return false;
  if (registro.hasta && Date.now() < registro.hasta) return true;
  // Si ya pasó el tiempo de bloqueo, limpiamos
  if (registro.hasta && Date.now() >= registro.hasta) {
    intentos.delete(clave);
    return false;
  }
  return false;
}

function registrarFallo(clave) {
  const registro = intentos.get(clave) || { conteo: 0, hasta: null };
  registro.conteo += 1;
  if (registro.conteo >= MAX_INTENTOS) {
    registro.hasta = Date.now() + BLOQUEO_MINUTOS * 60 * 1000;
  }
  intentos.set(clave, registro);
}

function limpiarIntentos(clave) {
  intentos.delete(clave);
}

// ===== Registro =====
router.post("/registro", async (req, res) => {
  const { nombre, correo, password } = req.body;

  if (!nombre || !correo || !password) {
    return res.status(400).json({ error: "Nombre, correo y contraseña son obligatorios." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  }
  // Validación extra: al menos una letra y un número
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: "La contraseña debe tener al menos una letra y un número." });
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
    res.status(500).json({ error: "No se pudo crear la cuenta. Intenta de nuevo." });
  }
});

// ===== Login =====
router.post("/login", async (req, res) => {
  const { correo, password } = req.body;
  const ip = req.ip || req.headers["x-forwarded-for"] || "desconocida";
  const clave = claveIntento(correo, ip);

  if (!correo || !password) {
    return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
  }

  // ¿Está bloqueado por demasiados intentos?
  if (estaBloqueado(clave)) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${BLOQUEO_MINUTOS} minutos e intenta de nuevo.`,
    });
  }

  try {
    const resultado = await pool.query(
      "SELECT id, nombre, correo, password_hash FROM usuarios WHERE correo = $1",
      [correo]
    );
    const usuario = resultado.rows[0];

    // Mismo mensaje si el correo no existe o la contraseña es incorrecta (por seguridad).
    if (!usuario || !(await bcrypt.compare(password, usuario.password_hash))) {
      registrarFallo(clave);
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    // Login exitoso: limpiamos los intentos fallidos
    limpiarIntentos(clave);

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
