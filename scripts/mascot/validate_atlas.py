#!/usr/bin/env python3
"""Validate the built Compass mentor atlas and its public metadata."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = ROOT / "apps/frontend/public/mascot"
QA_DIR = ROOT / "output/mascot/compass-mentor/custom/qa"
STATES = (
    "idle",
    "receiving",
    "thinking",
    "listening",
    "speaking",
    "modifying",
    "hinting",
    "celebrating",
    "error",
)
CELL_WIDTH = 192
CELL_HEIGHT = 208


def main() -> None:
    png_path = PUBLIC_DIR / "compass-mentor-atlas.png"
    webp_path = PUBLIC_DIR / "compass-mentor-atlas.webp"
    metadata_path = PUBLIC_DIR / "compass-mentor-atlas.json"
    validation_path = QA_DIR / "validation.json"
    required = (png_path, webp_path, metadata_path, validation_path, QA_DIR / "contact-sheet.png")
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Missing atlas deliverables:\n" + "\n".join(missing))

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    validation = json.loads(validation_path.read_text(encoding="utf-8"))
    if metadata.get("columns") != 8 or metadata.get("rows") != 9:
        raise SystemExit("Atlas metadata must declare 8 columns and 9 rows.")
    if tuple(metadata.get("states", {}).keys()) != STATES:
        raise SystemExit("Atlas states are missing or out of contractual order.")
    for state in STATES:
        if metadata["states"][state].get("frames") != 8:
            raise SystemExit(f"{state} does not declare exactly eight frames.")
    if not validation.get("ok") or validation.get("errors"):
        raise SystemExit("Recorded atlas validation contains errors.")

    expected_size = (CELL_WIDTH * 8, CELL_HEIGHT * 9)
    for path in (png_path, webp_path):
        image = Image.open(path)
        if image.size != expected_size:
            raise SystemExit(f"{path.name} has size {image.size}, expected {expected_size}.")
        if "A" not in image.getbands():
            raise SystemExit(f"{path.name} does not preserve transparency.")
        for row, state in enumerate(STATES):
            for frame in range(8):
                alpha = image.crop(
                    (
                        frame * CELL_WIDTH,
                        row * CELL_HEIGHT,
                        (frame + 1) * CELL_WIDTH,
                        (row + 1) * CELL_HEIGHT,
                    ),
                ).getchannel("A")
                bbox = alpha.getbbox()
                if bbox is None:
                    raise SystemExit(f"{path.name}: {state} frame {frame} is empty.")
                if bbox[0] < 3 or bbox[1] < 3 or bbox[2] > CELL_WIDTH - 3 or bbox[3] > CELL_HEIGHT - 3:
                    raise SystemExit(f"{path.name}: {state} frame {frame} touches a cell edge.")

    print(
        json.dumps(
            {
                "ok": True,
                "atlasSize": list(expected_size),
                "states": len(STATES),
                "framesPerState": 8,
                "totalFrames": len(STATES) * 8,
            },
            indent=2,
        ),
    )


if __name__ == "__main__":
    main()
