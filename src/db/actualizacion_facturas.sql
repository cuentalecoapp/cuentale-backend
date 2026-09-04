-- Actualización: agrega el módulo de facturas a una base de datos que ya tiene
-- las tablas del schema.sql original. Corre SOLO este archivo (no todo schema.sql
-- de nuevo, porque fallaría al intentar crear tablas que ya existen).

CREATE TABLE facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  cliente_nombre VARCHAR(160) NOT NULL,
  cliente_contacto VARCHAR(160),
  estado VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'anulada')),
  notas VARCHAR(300),
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  transaccion_id UUID REFERENCES transacciones(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, numero)
);

CREATE TABLE factura_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  descripcion VARCHAR(200) NOT NULL,
  cantidad NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario NUMERIC(14, 2) NOT NULL CHECK (precio_unitario >= 0),
  orden SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_facturas_negocio_fecha ON facturas (negocio_id, fecha DESC);
CREATE INDEX idx_factura_items_factura ON factura_items (factura_id);
