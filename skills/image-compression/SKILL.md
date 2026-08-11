---
name: image-compression
description: Compress raster images before sending them to an AI agent or storing them as chat attachments. Use when an image is pasted, uploaded, or prepared for a vision prompt.
---

# Image compression

Use `scripts/compress_image.py` for deterministic local compression.

- Keep the longest edge at or below 1600 pixels unless native resolution is required.
- Prefer JPEG quality 82 for photographs and screenshots; preserve PNG only when transparency is required.
- Never modify the original file in place.
- Report output dimensions and byte size.

```powershell
python scripts/compress_image.py input.png --output optimized.jpg --max-edge 1600 --quality 82
```
