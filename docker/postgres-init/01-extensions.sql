CREATE EXTENSION IF NOT EXISTS unaccent;

-- Create a separate database for integration tests.
-- Mirrors the main 'app' database but is rolled back between tests.
CREATE DATABASE app_test
  OWNER dev
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.utf8'
  LC_CTYPE 'en_US.utf8';

\c app_test
CREATE EXTENSION IF NOT EXISTS unaccent;
