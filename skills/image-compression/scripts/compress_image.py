#!/usr/bin/env python3
"""Compress a raster image without overwriting the source."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-edge", type=int, default=1600)
    parser.add_argument("--quality", type=int, default=82)
    args = parser.parse_args()
    with Image.open(args.input) as source:
        image = source.convert("RGBA") if "A" in source.getbands() else source.convert("RGB")
        image.thumbnail((args.max_edge, args.max_edge), Image.Resampling.LANCZOS)
        if args.output.suffix.lower() == ".png" and image.mode == "RGBA":
            image.save(args.output, format="PNG", optimize=True)
        else:
            image.convert("RGB").save(args.output, format="JPEG", quality=args.quality, optimize=True, progressive=True)
        print(f"{args.output} {image.width}x{image.height} {args.output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
