ALTER TABLE rooms ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rooms ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE rooms
SET sort_order = ranked.position
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC)::INTEGER - 1 AS position
    FROM rooms
) AS ranked
WHERE rooms.id = ranked.id;
