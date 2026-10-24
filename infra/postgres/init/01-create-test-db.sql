-- Runs once, when the postgres volume is first created.
-- A separate database for integration tests so they never touch dev data.
CREATE DATABASE repforge_test;
