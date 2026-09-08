-- Actualización v6: recuperación de contraseña por correo.
-- Guarda códigos temporales de un solo uso para restablecer la contraseña.
-- Ejecutar una sola vez en la base de datos existente.

CREATE TABLE IF NOT EXISTS codigos_recuperacion (
  id SERIAL PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE, -- guardamos el código "encriptado", nunca el original
  expira_en TIMESTAMPTZ NOT NULL,
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para buscar rápido por usuario cuando alguien pide varios códigos seguidos
CREATE INDEX IF NOT EXISTS idx_codigos_recuperacion_usuario ON codigos_recuperacion(usuario_id);
