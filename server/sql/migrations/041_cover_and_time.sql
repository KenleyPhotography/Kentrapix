-- Photo de couverture des produits (albums, tirages) et heure souhaitée des demandes du portfolio.
ALTER TABLE print_products ADD COLUMN IF NOT EXISTS cover_key VARCHAR(200) NULL;
ALTER TABLE portfolio_requests ADD COLUMN IF NOT EXISTS wished_time VARCHAR(5) NOT NULL DEFAULT '';
