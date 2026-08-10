ALTER TABLE app_settings ADD COLUMN chat_font_size TEXT NOT NULL DEFAULT 'base'
    CHECK (chat_font_size IN ('sm', 'base', 'lg'));
