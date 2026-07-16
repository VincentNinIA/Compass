#!/usr/bin/env python3
"""Build the Compass mentor atlas from nine GPT Image sprite strips."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "output/mascot/compass-mentor/custom/generated"
PROCESSED_DIR = ROOT / "output/mascot/compass-mentor/custom/processed"
QA_DIR = ROOT / "output/mascot/compass-mentor/custom/qa"
PUBLIC_DIR = ROOT / "apps/frontend/public/mascot"

CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 8
ROWS = 9
CHROMA_TARGET = (255, 0, 255)

STATE_DURATIONS_MS = {
    "idle": 220,
    "receiving": 150,
    "thinking": 170,
    "listening": 160,
    "speaking": 110,
    "modifying": 140,
    "hinting": 140,
    "celebrating": 130,
    "error": 180,
}
STATES = tuple(STATE_DURATIONS_MS)


@dataclass
class FrameSource:
    state: str
    index: int
    slot: Image.Image
    crop: Image.Image
    bbox: tuple[int, int, int, int]
    slot_width: int
    source_height: int


def _median_border_key(image: Image.Image) -> tuple[int, int, int]:
    width, height = image.size
    patches = (
        (0, 0, 16, 16),
        (width - 16, 0, width, 16),
        (0, height - 16, 16, height),
        (width - 16, height - 16, width, height),
    )
    samples: list[tuple[int, int, int]] = []
    for patch in patches:
        stat = ImageStat.Stat(image.crop(patch).convert("RGB"))
        samples.append(tuple(round(value) for value in stat.median))
    return tuple(sorted(sample[channel] for sample in samples)[len(samples) // 2] for channel in range(3))


def _key_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right, strict=True)))


def _remove_chroma(source: Path, destination: Path) -> None:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    helper = codex_home / "skills/.system/imagegen/scripts/remove_chroma_key.py"
    if not helper.is_file():
        raise SystemExit(f"Missing imagegen chroma-key helper: {helper}")
    if destination.is_file() and destination.stat().st_mtime >= source.stat().st_mtime:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            str(helper),
            "--input",
            str(source),
            "--out",
            str(destination),
            "--auto-key",
            "border",
            "--soft-matte",
            "--transparent-threshold",
            "28",
            "--opaque-threshold",
            "150",
            "--despill",
        ],
        check=True,
    )


def _slot_boundaries(alpha: Image.Image) -> list[int]:
    """Find the seven gutters nearest the expected 8-column guide.

    GPT Image keeps the requested column layout but antialiasing can leave a few
    opaque pixels in a gutter. Looking for the lowest-alpha valley around each
    expected guide is therefore more reliable than requiring a fully empty gap.
    """

    threshold = 96
    counts = [
        sum(1 for value in alpha.crop((x, 0, x + 1, alpha.height)).getdata() if value >= threshold)
        for x in range(alpha.width)
    ]
    slot_width = alpha.width / COLUMNS
    boundaries = [0]
    for index in range(1, COLUMNS):
        expected = index * slot_width
        radius = max(12, round(slot_width * 0.32))
        left = max(boundaries[-1] + 24, round(expected - radius))
        right = min(alpha.width - 24, round(expected + radius))
        if left >= right:
            raise SystemExit(f"Unable to locate gutter {index} in {alpha.width}px strip")
        minimum = min(counts[left:right])
        candidates = [x for x in range(left, right) if counts[x] <= minimum + 3]

        runs: list[tuple[int, int]] = []
        run_start = candidates[0]
        previous = candidates[0]
        for x in candidates[1:]:
            if x != previous + 1:
                runs.append((run_start, previous + 1))
                run_start = x
            previous = x
        runs.append((run_start, previous + 1))
        gutter = min(runs, key=lambda run: abs(((run[0] + run[1]) / 2) - expected))
        boundaries.append(round((gutter[0] + gutter[1]) / 2))
    boundaries.append(alpha.width)
    return boundaries


def _load_sources() -> tuple[list[FrameSource], dict[str, int]]:
    frames: list[FrameSource] = []
    baselines: dict[str, int] = {}
    missing = [str(SOURCE_DIR / f"{state}.png") for state in STATES if not (SOURCE_DIR / f"{state}.png").is_file()]
    if missing:
        raise SystemExit("Missing generated sprite strips:\n" + "\n".join(missing))

    for state in STATES:
        source_path = SOURCE_DIR / f"{state}.png"
        raw_image = Image.open(source_path).convert("RGB")
        ratio = raw_image.width / raw_image.height
        if ratio < 1.15 or ratio > 3.25:
            raise SystemExit(
                f"{state}: expected a horizontal strip, got {raw_image.width}x{raw_image.height}",
            )

        key = _median_border_key(raw_image)
        if _key_distance(key, CHROMA_TARGET) > 55:
            raise SystemExit(f"{state}: border is not the required magenta chroma key: {key}")
        processed_path = PROCESSED_DIR / f"{state}.png"
        _remove_chroma(source_path, processed_path)
        image = ImageOps.expand(
            Image.open(processed_path).convert("RGBA"),
            border=(12, 0, 12, 0),
            fill=(0, 0, 0, 0),
        )
        alpha = image.getchannel("A")
        boundaries = _slot_boundaries(alpha)

        state_frames: list[FrameSource] = []
        for index, (left, right) in enumerate(zip(boundaries[:-1], boundaries[1:], strict=True)):
            slot = image.crop((left, 0, right, image.height))
            slot_alpha = slot.getchannel("A")
            bbox = slot_alpha.point(lambda value: 255 if value >= 48 else 0).getbbox()
            if bbox is None:
                raise SystemExit(f"{state} frame {index}: empty slot")
            if bbox[1] <= 1 or bbox[3] >= slot.height - 1:
                raise SystemExit(f"{state} frame {index}: sprite touches the source top/bottom: {bbox}")
            crop = slot.crop(bbox)
            state_frames.append(
                FrameSource(
                    state=state,
                    index=index,
                    slot=slot,
                    crop=crop,
                    bbox=bbox,
                    slot_width=slot.width,
                    source_height=slot.height,
                ),
            )
        baselines[state] = max(frame.bbox[3] for frame in state_frames)
        frames.extend(state_frames)
    return frames, baselines


def _compose_frames(frames: list[FrameSource], baselines: dict[str, int]) -> Image.Image:
    scales: dict[str, float] = {}
    for state in STATES:
        state_frames = [frame for frame in frames if frame.state == state]
        max_width = max(frame.crop.width for frame in state_frames)
        max_height = max(frame.crop.height for frame in state_frames)
        scales[state] = min((CELL_WIDTH - 16) / max_width, (CELL_HEIGHT - 12) / max_height)
    atlas = Image.new("RGBA", (CELL_WIDTH * COLUMNS, CELL_HEIGHT * ROWS), (0, 0, 0, 0))

    for frame in frames:
        scale = scales[frame.state]
        width = max(1, round(frame.crop.width * scale))
        height = max(1, round(frame.crop.height * scale))
        sprite = frame.crop.resize((width, height), Image.Resampling.LANCZOS)
        slot_center = frame.slot_width / 2
        source_center = (frame.bbox[0] + frame.bbox[2]) / 2
        center_offset = round((source_center - slot_center) * scale)
        left = (CELL_WIDTH - width) // 2 + center_offset
        bottom_offset = round((baselines[frame.state] - frame.bbox[3]) * scale)
        top = CELL_HEIGHT - 6 - bottom_offset - height
        left = max(4, min(CELL_WIDTH - width - 4, left))
        top = max(4, min(CELL_HEIGHT - height - 4, top))
        row = STATES.index(frame.state)
        atlas.alpha_composite(sprite, (frame.index * CELL_WIDTH + left, row * CELL_HEIGHT + top))
    return atlas


def _cell_report(atlas: Image.Image) -> list[dict[str, object]]:
    report: list[dict[str, object]] = []
    for row, state in enumerate(STATES):
        for frame in range(COLUMNS):
            cell = atlas.crop(
                (
                    frame * CELL_WIDTH,
                    row * CELL_HEIGHT,
                    (frame + 1) * CELL_WIDTH,
                    (row + 1) * CELL_HEIGHT,
                ),
            )
            alpha = cell.getchannel("A")
            bbox = alpha.getbbox()
            opaque_pixels = sum(1 for value in alpha.getdata() if value > 24)
            report.append(
                {
                    "state": state,
                    "frame": frame,
                    "bbox": list(bbox) if bbox else None,
                    "opaquePixels": opaque_pixels,
                },
            )
    return report


def _write_contact_sheet(atlas: Image.Image) -> None:
    label_width = 150
    row_height = CELL_HEIGHT
    sheet = Image.new("RGB", (label_width + atlas.width, atlas.height), (255, 248, 238))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=18)
    for row, state in enumerate(STATES):
        y = row * row_height
        if row % 2:
            draw.rectangle((0, y, sheet.width, y + row_height), fill=(255, 240, 223))
        draw.text((18, y + row_height // 2 - 10), state, fill=(25, 34, 29), font=font)
    checker = Image.new("RGB", atlas.size, (244, 241, 232))
    checker_draw = ImageDraw.Draw(checker)
    tile = 16
    for y in range(0, checker.height, tile):
        for x in range(0, checker.width, tile):
            if (x // tile + y // tile) % 2:
                checker_draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(223, 211, 196))
    checker.paste(atlas.convert("RGB"), mask=atlas.getchannel("A"))
    sheet.paste(checker, (label_width, 0))
    QA_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(QA_DIR / "contact-sheet.png")


def build(check: bool) -> dict[str, object]:
    frames, baselines = _load_sources()
    atlas = _compose_frames(frames, baselines)
    report = _cell_report(atlas)
    errors = []
    for cell in report:
        bbox = cell["bbox"]
        if bbox is None or int(cell["opaquePixels"]) < 450:
            errors.append(f"{cell['state']} frame {cell['frame']} is empty or too small")
        elif bbox[0] < 3 or bbox[1] < 3 or bbox[2] > CELL_WIDTH - 3 or bbox[3] > CELL_HEIGHT - 3:
            errors.append(f"{cell['state']} frame {cell['frame']} touches the output cell edge")
    if check and errors:
        raise SystemExit("Atlas validation failed:\n" + "\n".join(errors))

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    png_path = PUBLIC_DIR / "compass-mentor-atlas.png"
    webp_path = PUBLIC_DIR / "compass-mentor-atlas.webp"
    metadata_path = PUBLIC_DIR / "compass-mentor-atlas.json"
    validation_path = QA_DIR / "validation.json"
    atlas.save(png_path, optimize=True)
    atlas.save(webp_path, format="WEBP", lossless=True, quality=100, method=6)
    metadata = {
        "version": 1,
        "image": "/mascot/compass-mentor-atlas.webp",
        "columns": COLUMNS,
        "rows": ROWS,
        "cellWidth": CELL_WIDTH,
        "cellHeight": CELL_HEIGHT,
        "states": {
            state: {"row": row, "frames": COLUMNS, "frameDurationMs": STATE_DURATIONS_MS[state]}
            for row, state in enumerate(STATES)
        },
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    validation = {
        "ok": not errors,
        "atlas": {"width": atlas.width, "height": atlas.height, "mode": atlas.mode},
        "states": list(STATES),
        "frames": report,
        "errors": errors,
    }
    validation_path.write_text(json.dumps(validation, indent=2) + "\n", encoding="utf-8")
    _write_contact_sheet(atlas)
    return validation


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Fail if any generated cell violates atlas constraints.")
    args = parser.parse_args()
    print(json.dumps(build(args.check), indent=2))


if __name__ == "__main__":
    main()
