-- Migration 012: Add account profile fields for admin-managed users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS id_card_num VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(255) NULL;
