-- Albums et tirages : le photographe publie un catalogue, le client choisit un produit et ses photos, puis envoie sa commande.
CREATE TABLE IF NOT EXISTS print_products (
  id          VARCHAR(36)   PRIMARY KEY,
  staff_id    VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        VARCHAR(120)  NOT NULL,
  description VARCHAR(400)  NULL,
  price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency    VARCHAR(3)    NOT NULL DEFAULT 'USD',
  min_photos  INTEGER       NOT NULL DEFAULT 1,
  max_photos  INTEGER       NOT NULL DEFAULT 100,
  active      SMALLINT      NOT NULL DEFAULT 1,
  position    INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_print_products_staff ON print_products (staff_id, active, position);

CREATE TABLE IF NOT EXISTS print_orders (
  id           VARCHAR(36)   PRIMARY KEY,
  staff_id     VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id    VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id   VARCHAR(36)   NULL REFERENCES print_products (id) ON DELETE SET NULL,
  product_name VARCHAR(120)  NOT NULL,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency     VARCHAR(3)    NOT NULL DEFAULT 'USD',
  quantity     INTEGER       NOT NULL DEFAULT 1,
  delivery     VARCHAR(10)   NOT NULL DEFAULT 'pickup', -- pickup | delivery
  address      VARCHAR(300)  NULL,
  note         VARCHAR(600)  NULL,
  status       VARCHAR(14)   NOT NULL DEFAULT 'new',    -- new | accepted | production | ready | delivered | cancelled
  reply        VARCHAR(500)  NULL,
  created_at   TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_print_orders_staff ON print_orders (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_orders_client ON print_orders (client_id, created_at DESC);

-- Photos d'une commande : numéro, nom de fichier et galerie sont copiés (la commande reste lisible si la photo est supprimée).
CREATE TABLE IF NOT EXISTS print_order_photos (
  order_id   VARCHAR(36)  NOT NULL REFERENCES print_orders (id) ON DELETE CASCADE,
  photo_id   VARCHAR(36)  NULL REFERENCES photos (id) ON DELETE SET NULL,
  number     INTEGER      NOT NULL,
  filename   VARCHAR(255) NOT NULL,
  event_name VARCHAR(160) NOT NULL DEFAULT '',
  position   INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_print_order_photos_order ON print_order_photos (order_id, position);

ALTER TABLE print_products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_order_photos ENABLE ROW LEVEL SECURITY;
