const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { tieneAcceso } = require("../db/acceso");

const router = express.Router();
router.use(requireAuth);

// Categorías por defecto que se crean automáticamente con cada negocio nuevo,
// para que el usuario no empiece con la pantalla vacía.
const CATEGORIAS_DEFECTO = [
  { nombre: "Ventas", tipo: "ingreso", icono: "ti-shopping-bag" },
  { nombre: "Otros ingresos", tipo: "ingreso", icono: "ti-plus" },
  { nombre: "Insumos", tipo: "gasto", icono: "ti-shopping-cart" },
  { nombre: "Arriendo", tipo: "gasto", icono: "ti-home" },
  { nombre: "Servicios", tipo: "gasto", icono: "ti-bolt" },
  { nombre: "Otros gastos", tipo: "gasto", icono: "ti-dots" },
];

// GET /api/negocios — negocios a los que el usuario pertenece (dueño o invitado)
router.get("/", async (req, res) => {
  const resultado = await pool.query(
    `SELECT n.id, n.nombre, n.color_marca, n.iniciales, n.creado_en, nu.rol
     FROM negocios n
     JOIN negocio_usuarios nu ON nu.negocio_id = n.id
     WHERE nu.usuario_id = $1
     ORDER BY n.creado_en`,
    [req.usuarioId]
  );
  res.json(resultado.rows);
});

router.post("/", async (req, res) => {
  const { nombre, color_marca } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre del negocio es obligatorio." });
  }

  const iniciales = nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((palabra) => palabra[0].toUpperCase())
    .join("");

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const negocio = await cliente.query(
      `INSERT INTO negocios (usuario_id, nombre, color_marca, iniciales)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, color_marca, iniciales`,
      [req.usuarioId, nombre.trim(), color_marca || "#7F77DD", iniciales]
    );
    const negocioId = negocio.rows[0].id;

    await cliente.query(
      "INSERT INTO negocio_usuarios (negocio_id, usuario_id, rol) VALUES ($1, $2, 'dueño')",
      [negocioId, req.usuarioId]
    );

    for (const cat of CATEGORIAS_DEFECTO) {
      await cliente.query(
        "INSERT INTO categorias (negocio_id, nombre, tipo, icono) VALUES ($1, $2, $3, $4)",
        [negocioId, cat.nombre, cat.tipo, cat.icono]
      );
    }

    await cliente.query("COMMIT");
    res.status(201).json({ ...negocio.rows[0], rol: "dueño" });
  } catch (err) {
    await cliente.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "No se pudo crear el negocio." });
  } finally {
    cliente.release();
  }
});

// GET /api/negocios/:negocioId/miembros — quién tiene acceso a este negocio
router.get("/:negocioId/miembros", async (req, res) => {
  const { negocioId } = req.params;
  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }

  const resultado = await pool.query(
    `SELECT u.id, u.nombre, u.correo, nu.rol, nu.agregado_en
     FROM negocio_usuarios nu
     JOIN usuarios u ON u.id = nu.usuario_id
     WHERE nu.negocio_id = $1
     ORDER BY nu.agregado_en`,
    [negocioId]
  );
  res.json(resultado.rows);
});

// POST /api/negocios/:negocioId/miembros — agregar a alguien que YA tiene cuenta
router.post("/:negocioId/miembros", async (req, res) => {
  const { negocioId } = req.params;
  const { correo } = req.body;

  if (!(await tieneAcceso(negocioId, req.usuarioId))) {
    return res.status(404).json({ error: "Negocio no encontrado." });
  }
  if (!correo || !correo.trim()) {
    return res.status(400).json({ error: "Escribe el correo de la persona a invitar." });
  }

  const usuario = await pool.query("SELECT id, nombre FROM usuarios WHERE correo = $1", [
    correo.trim(),
  ]);
  if (usuario.rows.length === 0) {
    return res.status(404).json({
      error: "No hay ninguna cuenta con ese correo. Pídele que se registre primero en la app.",
    });
  }

  const yaEsMiembro = await pool.query(
    "SELECT 1 FROM negocio_usuarios WHERE negocio_id = $1 AND usuario_id = $2",
    [negocioId, usuario.rows[0].id]
  );
  if (yaEsMiembro.rows.length > 0) {
    return res.status(409).json({ error: "Esa persona ya tiene acceso a este negocio." });
  }

  await pool.query(
    "INSERT INTO negocio_usuarios (negocio_id, usuario_id, rol) VALUES ($1, $2, 'miembro')",
    [negocioId, usuario.rows[0].id]
  );

  res.status(201).json({ id: usuario.rows[0].id, nombre: usuario.rows[0].nombre, rol: "miembro" });
});

// GET /api/negocios/:negocioId/perfil — datos completos del negocio (para Configuración)
router.get("/:negocioId/perfil", async (req, res) => {
  const { negocioId } = req.params;
  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }
    const resultado = await pool.query(
      `SELECT id, nombre, nit, direccion, telefono, correo, ciudad, rubro, logo, color_marca, iniciales
       FROM negocios WHERE id = $1`,
      [negocioId]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: "Negocio no encontrado." });
    }
    res.json(resultado.rows[0]);
  } catch (err) {
    console.error("Error al leer perfil:", err);
    res.status(500).json({ error: "No pudimos cargar el perfil del negocio." });
  }
});

// PUT /api/negocios/:negocioId/perfil — actualizar datos del negocio
router.put("/:negocioId/perfil", async (req, res) => {
  const { negocioId } = req.params;
  const { nombre, nit, direccion, telefono, correo, ciudad, rubro, logo } = req.body;

  try {
    if (!(await tieneAcceso(negocioId, req.usuarioId))) {
      return res.status(403).json({ error: "No tienes acceso a este negocio." });
    }
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El nombre del negocio es obligatorio." });
    }

    const resultado = await pool.query(
      `UPDATE negocios
       SET nombre = $1, nit = $2, direccion = $3, telefono = $4,
           correo = $5, ciudad = $6, rubro = $7, logo = $8
       WHERE id = $9
       RETURNING id, nombre, nit, direccion, telefono, correo, ciudad, rubro, logo`,
      [
        nombre.trim(),
        nit || null,
        direccion || null,
        telefono || null,
        correo || null,
        ciudad || null,
        rubro || null,
        logo || null,
        negocioId,
      ]
    );
    res.json(resultado.rows[0]);
  } catch (err) {
    console.error("Error al actualizar perfil:", err);
    res.status(500).json({ error: "No pudimos guardar los cambios." });
  }
});

module.exports = router;
