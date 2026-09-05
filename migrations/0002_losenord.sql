-- Lösenordsinloggning: registrering med registreringskod i stället för mejlad engångskod.
-- NULL = användaren har inget lösenord ännu (tillagd av admin, eller nollställt).
ALTER TABLE users ADD COLUMN password_hash TEXT;
