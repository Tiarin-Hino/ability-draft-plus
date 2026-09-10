#!/usr/bin/env python3
"""Chroma-key MP4s for editors that ignore alpha (VN, older CapCut, most phone galleries).

Composites a frames directory onto a solid key colour and encodes H.264 at 30 fps. Pick a key colour
that does not occur in the artwork: green (#00FF00) for the platform-native rows, blue (#0000FF) for the
branded prompts / end card / watermark (they contain green). Panels that were semi-transparent are made
opaque first so they do not pick up a tint of the key colour.

Usage: python make_chroma.py --ffmpeg PATH <frames_dir> <green|blue> <out.mp4>  (or --all)
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image

KEYS = {"green": (0, 255, 0), "blue": (0, 0, 255)}
FPS_IN, FPS_OUT = 15, 30


def encode(frames_dir: Path, key: str, out: Path, ffmpeg: str) -> None:
    files = sorted(frames_dir.glob("f*.png"))
    first = Image.open(files[0])
    w, h = first.size
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-framerate", str(FPS_IN), "-i", "-",
           "-r", str(FPS_OUT), "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin
    bg_rgb = KEYS[key]
    for f in files:
        im = Image.open(f).convert("RGBA")
        a = im.getchannel("A").point(lambda v: min(255, int(v / 0.86)))  # 86 %-opaque panels -> solid
        im.putalpha(a)
        bg = Image.new("RGBA", im.size, (*bg_rgb, 255))
        bg.alpha_composite(im)
        proc.stdin.write(bg.convert("RGB").tobytes())
    proc.stdin.close()
    err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {out}: {err[-400:]}")
    print(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB, {len(files)} frames)")


ALL = [
    ("out/native/native_instagram_frames", "green", "native_instagram_GREENKEY.mp4"),
    ("out/native/native_youtube_frames", "green", "native_youtube_GREENKEY.mp4"),
    ("out/native/native_tiktok_frames", "green", "native_tiktok_GREENKEY.mp4"),
    ("out/prompts/follow_frames", "blue", "follow_BLUEKEY.mp4"),
    ("out/prompts/follow_youtube_frames", "blue", "follow_youtube_BLUEKEY.mp4"),
    *[(f"out/prompts/comment_Q{i}_frames", "blue", f"comment_Q{i}_BLUEKEY.mp4") for i in range(1, 6)],
    ("out/endcard_frames", "blue", "endcard_BLUEKEY.mp4"),
    ("out/frames", "blue", "adplus_bounce_BLUEKEY.mp4"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("frames_dir", nargs="?")
    ap.add_argument("key", nargs="?", choices=list(KEYS))
    ap.add_argument("out", nargs="?")
    ap.add_argument("--all", action="store_true", help="build every known overlay into out/chroma/")
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "")
    args = ap.parse_args()
    if not args.ffmpeg:
        raise SystemExit("ffmpeg not found; pass --ffmpeg PATH")
    if args.all:
        out_dir = Path("out/chroma"); out_dir.mkdir(parents=True, exist_ok=True)
        for fd, key, name in ALL:
            if Path(fd).exists():
                encode(Path(fd), key, out_dir / name, args.ffmpeg)
            else:
                print("skip (no frames):", fd)
        return 0
    if not (args.frames_dir and args.key and args.out):
        ap.error("give frames_dir key out, or --all")
    encode(Path(args.frames_dir), args.key, Path(args.out), args.ffmpeg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
