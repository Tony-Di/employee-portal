-- Incremented when an admin's password changes; sessions from before the change stop working.
ALTER TABLE admins ADD COLUMN session_epoch integer NOT NULL DEFAULT 0;
