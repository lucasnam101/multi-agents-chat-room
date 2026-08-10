-- Image/file attachments on a message, as sent to the ACP adapter's
-- session/prompt content blocks (image: base64 data; file: a resource_link
-- path reference, no inline bytes). Small enough for this local single-user
-- app to store inline rather than a separate blob directory.
ALTER TABLE messages ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]';
