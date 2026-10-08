-- ==========================================================================
-- 005 — Verrou d'analyse des visages
-- « processing » : une photo est réservée par un processus avant d'être analysée,
-- pour qu'elle ne soit jamais traitée deux fois en même temps (redémarrage,
-- plusieurs instances du serveur…).
-- ==========================================================================
ALTER TABLE photos
  MODIFY faces_status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending'
    COMMENT 'Analyse des visages : en attente, en cours, terminée, échouée';
