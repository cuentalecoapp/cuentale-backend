-- Actualización v2: multi-usuario por negocio y clientes frecuentes.
-- Corre esto DESPUÉS de haber corrido actualizacion_facturas.sql.

CREATE TABLE negocio_usuarios (
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol VARCHAR(20) NOT NULL DEFAULT 'miembro' CHECK (rol IN ('dueño', 'miembro')),
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (negocio_id, usuario_id)
);

CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  contacto VARCHAR(160),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, nombre)
);

CREATE INDEX idx_negocio_usuarios_usuario ON negocio_usuarios (usuario_id);
CREATE INDEX idx_clientes_negocio ON clientes (negocio_id);

-- Migra los negocios que ya existen: registra al dueño original como
-- miembro con rol 'dueño', para que todo lo creado hasta ahora siga funcionando.
INSERT INTO negocio_usuarios (negocio_id, usuario_id, rol)
SELECT id, usuario_id, 'dueño' FROM negocios
ON CONFLICT DO NOTHING;
