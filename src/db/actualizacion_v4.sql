-- Actualización v4: números de WhatsApp vinculados a un negocio.
-- Corre esto DESPUÉS de actualizacion_v3.sql.

CREATE TABLE whatsapp_numeros (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero VARCHAR(20) NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_numeros_numero ON whatsapp_numeros (numero);
