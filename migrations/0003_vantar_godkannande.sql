-- Nya konton från /registrera väntar på att admin godkänner dem.
-- pending = 1 tillsammans med approved = 0 betyder "väntar", approved = 0 och pending = 0 betyder "nekad/avstängd".
ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
