-- Visites du site public (portfolio, connexion) : comptage anonyme. Aucune adresse IP n'est gardée :
-- « visitor » est une empreinte qui change chaque jour, donc impossible à relier d'un jour à l'autre.
CREATE TABLE IF NOT EXISTS site_visits (
  day     DATE        NOT NULL,
  visitor VARCHAR(24) NOT NULL,
  path    VARCHAR(60) NOT NULL,
  hits    INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (day, visitor, path)
);
CREATE INDEX IF NOT EXISTS idx_site_visits_day ON site_visits (day);
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
