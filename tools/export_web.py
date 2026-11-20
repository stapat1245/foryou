#!/usr/bin/env python3

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import rose_bouquet as rb


def rgb565(colour: np.ndarray) -> np.ndarray:
    c = (np.clip(colour, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint16)
    return (((c[..., 0] >> 3) << 11) | ((c[..., 1] >> 2) << 5) | (c[..., 2] >> 3)).astype("<u2")


def message_data(message):
    if not message:
        return None
    letters = []
    for letter, x, colour in message["letters"]:
        c = np.clip(colour, 0.0, 1.0)
        letters.append([letter, round(float(x), 2)] + [int(round(float(v) * 255)) for v in c])
    return {"size": int(message["size"]), "y": round(float(message["y"]), 2), "letters": letters}


def export(out_dir: Path, fps: int) -> None:
    frames = int(round(rb.LOOP * fps))
    cells = rb.ROWS * rb.COLS
    char_data = np.empty((frames, rb.ROWS, rb.COLS), np.uint8)
    colour_data = np.empty((frames, rb.ROWS, rb.COLS), "<u2")
    meta_frames = []

    for i in range(frames):
        t = i / fps
        char, colour, steady, info = rb.frame(t, rb.COLS, rb.ROWS, rb.CW, rb.CH)
        packed = char.astype(np.uint8).copy()
        packed[np.asarray(steady)] |= 0x80
        char_data[i] = packed
        colour_data[i] = rgb565(colour)
        meta_frames.append({
            "letters": int(info["letters"]),
            "open": int(info["open"]),
            "falling": int(info["falling"]),
            "grown": round(float(info["grown"]), 4),
            "msg": message_data(info["message"]),
        })

    raw = char_data.tobytes()
    colour_offset = len(raw)
    if colour_offset % 2:
        raw += b"\0"
        colour_offset += 1
    raw += colour_data.tobytes()

    out_dir.mkdir(parents=True, exist_ok=True)
    blob = gzip.compress(raw, compresslevel=9, mtime=0)
    data_path = out_dir / "frames.bin.gz"
    data_path.write_bytes(blob)

    meta = {
        "title": rb.TITLE,
        "credit": rb.CREDIT,
        "message": rb.MESSAGE,
        "fps": fps,
        "frames": frames,
        "loop": rb.LOOP,
        "cols": rb.COLS,
        "rows": rb.ROWS,
        "cw": rb.CW,
        "ch": rb.CH,
        "width": rb.W,
        "height": rb.H,
        "trail": rb.TRAIL,
        "messagePx": rb.MESSAGE_PX,
        "fontPx": rb.FONT_PX,
        "hudPx": 15,
        "roses": rb.N_ROSES,
        "hint": "Space pause · R restart · S screenshot · F fullscreen",
        "colours": {
            "dim": list(rb.DIM),
            "accent": list(rb.ACCENT),
            "sign": list(rb.SIGN),
        },
        "data": {
            "bytes": len(blob),
            "rawBytes": len(raw),
            "charsBytes": frames * cells,
            "coloursOffset": colour_offset,
            "coloursBytes": frames * cells * 2,
            "cells": cells,
        },
        "meta": meta_frames,
    }
    meta_path = out_dir / "meta.json"
    meta_path.write_text(json.dumps(meta, separators=(",", ":")) + "\n")

    print(
        f"exported {frames} frames ({frames / fps:.2f}s) at {fps} fps\n"
        f"  {data_path}  {len(blob) / 1e6:.2f} MB compressed\n"
        f"  {meta_path}  {meta_path.stat().st_size / 1e3:.0f} KB"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Bake the rose bouquet animation into browser frame data.")
    parser.add_argument("--out", type=Path, default=ROOT / "web" / "data", help="output directory")
    parser.add_argument("--fps", type=int, default=30, help="frames per second (default: 30)")
    args = parser.parse_args()
    export(args.out, max(1, args.fps))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
