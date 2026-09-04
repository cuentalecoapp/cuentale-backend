-- Actualización v3: inventario, cuentas por pagar, y vencimientos.
-- Corre esto DESPUÉS de actualizacion_v2.sql.

CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  sku VARCHAR(60),
  precio_venta NUMERIC(14, 2) NOT NULL DEFAULT 0,
  stock_actual NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(10, 2) NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, nombre)
);

ALTER TABLE factura_items ADD COLUMN producto_id UUID REFERENCES productos(id) ON DELETE SET NULL;
ALTER TABLE facturas ADD COLUMN fecha_vencimiento DATE;

CREATE TABLE cuentas_por_pagar (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  proveedor_nombre VARCHAR(160) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  estado VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
  fecha_vencimiento DATE,
  transaccion_id UUID REFERENCES transacciones(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_productos_negocio ON productos (negocio_id);
CREATE INDEX idx_cuentas_por_pagar_negocio ON cuentas_por_pagar (negocio_id);
