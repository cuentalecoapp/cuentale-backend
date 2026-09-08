const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");
const pool = require("../db/pool");

const router = express.Router();
const SALT_ROUNDS = 12;
const resend = new Resend(process.env.RESEND_API_KEY);

// El código de recuperación vale por 1 hora, para que no se pueda usar días después
const MINUTOS_VALIDEZ_CODIGO = 60;
// De dónde salen los enlaces: la página del frontend donde el usuario pone su clave nueva
const URL_FRONTEND = process.env.URL_FRONTEND || "https://cuentale-cof.onrender.com";

// Convierte el código en texto plano en su versión "encriptada" para guardarla en la base de datos.
// Así, ni siquiera nosotros vemos el código real si alguien mirara la base de datos.
function hashearCodigo(codigoPlano) {
  return crypto.createHash("sha256").update(codigoPlano).digest("hex");
}


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

// ===== Paso 1: "Olvidé mi contraseña" — el usuario escribe su correo =====
router.post("/olvide-password", async (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).json({ error: "Escribe tu correo." });
  }

  // Mensaje genérico SIEMPRE, exista o no ese correo — así nadie puede usar este
  // formulario para adivinar qué correos están registrados en Cuéntale.
  const mensajeGenerico = {
    mensaje: "Si ese correo está registrado, te enviamos un enlace para recuperar tu contraseña.",
  };

  try {
    const resultado = await pool.query("SELECT id, nombre, correo FROM usuarios WHERE correo = $1", [correo]);
    const usuario = resultado.rows[0];

    if (!usuario) {
      return res.json(mensajeGenerico);
    }

    // Generamos un código secreto al azar (imposible de adivinar) y guardamos solo su huella
    const codigoPlano = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashearCodigo(codigoPlano);
    const expiraEn = new Date(Date.now() + MINUTOS_VALIDEZ_CODIGO * 60 * 1000);

    await pool.query(
      `INSERT INTO codigos_recuperacion (usuario_id, token_hash, expira_en)
       VALUES ($1, $2, $3)`,
      [usuario.id, tokenHash, expiraEn]
    );

    const enlace = `${URL_FRONTEND}/?resetToken=${codigoPlano}`;

    await resend.emails.send({
      from: process.env.CORREO_ENVIO || "Cuéntale <onboarding@resend.dev>",
      to: usuario.correo,
      subject: "Recupera tu contraseña de Cuéntale",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color:#128C6E;">¿Cómo vas, ${usuario.nombre}?</h2>
          <p>Recibimos una solicitud para restablecer tu contraseña de Cuéntale.</p>
          <p>
            <a href="${enlace}" style="background:#FF6A2B; color:#fff; padding:12px 24px; border-radius:999px; text-decoration:none; font-weight:bold; display:inline-block;">
              Crear nueva contraseña
            </a>
          </p>
          <p style="color:#888; font-size:13px;">Este enlace vale por 1 hora. Si tú no pediste esto, ignora el correo — tu contraseña sigue igual.</p>
        </div>
      `,
    });

    res.json(mensajeGenerico);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo procesar la solicitud. Intenta de nuevo." });
  }
});

// ===== Paso 2: el usuario hace clic en el enlace y pone su contraseña nueva =====
router.post("/restablecer-password", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: "Faltan datos para restablecer la contraseña." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: "La contraseña debe tener al menos una letra y un número." });
  }

  try {
    const tokenHash = hashearCodigo(token);
    const resultado = await pool.query(
      `SELECT id, usuario_id, expira_en, usado FROM codigos_recuperacion WHERE token_hash = $1`,
      [tokenHash]
    );
    const codigo = resultado.rows[0];

    if (!codigo || codigo.usado || new Date(codigo.expira_en) < new Date()) {
      return res.status(400).json({ error: "Este enlace ya no es válido. Pide uno nuevo." });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [passwordHash, codigo.usuario_id]);
    // Marcamos el código como usado para que nadie lo vuelva a usar (ni siquiera dos veces el mismo usuario)
    await pool.query("UPDATE codigos_recuperacion SET usado = TRUE WHERE id = $1", [codigo.id]);

    res.json({ mensaje: "Tu contraseña fue actualizada. Ya puedes iniciar sesión." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo restablecer la contraseña." });
  }
});

module.exports = router;
