-- Crée l'utilisateur MySQL utilisé par l'API KentraPix (à exécuter une fois, connecté en root).
-- Remplacez MODPAS_OU par la même valeur que DB_PASSWORD dans backend/.env.
CREATE USER IF NOT EXISTS 'kentrapix'@'localhost' IDENTIFIED BY 'MODPAS_OU';
CREATE USER IF NOT EXISTS 'kentrapix'@'127.0.0.1' IDENTIFIED BY 'MODPAS_OU';
GRANT SELECT, INSERT, UPDATE, DELETE ON kentrapix.* TO 'kentrapix'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON kentrapix.* TO 'kentrapix'@'127.0.0.1';
FLUSH PRIVILEGES;
