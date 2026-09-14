-- English becomes the default language for first-time visitors.
ALTER TABLE portal_settings ALTER COLUMN default_language SET DEFAULT 'en';
-- Only switch installations whose settings were never saved by an admin (version is still 1).
UPDATE portal_settings SET default_language = 'en' WHERE id = 1 AND version = 1;
