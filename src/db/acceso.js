const pool = require("./pool");

// Cualquier miembro del negocio (dueño o agregado después) puede operar sobre él.
async function tieneAcceso(negocioId, usuarioId) {
  const resultado = await pool.query(
    "SELECT 1 FROM negocio_usuarios WHERE negocio_id = $1 AND usuario_id = $2",
    [negocioId, usuarioId]
  );
  return resultado.rows.length > 0;
}

module.exports = { tieneAcceso };
