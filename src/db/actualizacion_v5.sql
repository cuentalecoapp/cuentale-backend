-- Actualización v5: campos de perfil del negocio (Configuración)
-- Agrega los datos que el emprendedor puede configurar sobre su negocio.
-- Ejecutar una sola vez en la base de datos existente.

ALTER TABLE negocios ADD COLUMN IF NOT EXISTS nit VARCHAR(30);
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS direccion VARCHAR(200);
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS telefono VARCHAR(40);
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS correo VARCHAR(160);
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS ciudad VARCHAR(80);
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS rubro VARCHAR(80);
-- El logo se guarda como texto en formato "data URL" (base64). Sirve para logos pequeños.
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS logo TEXT;
