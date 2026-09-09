#!/usr/bin/env python3
"""Animate endcard_overlay.png (rendered from endcard.html) into a short alpha clip: the card slides up
and fades in over the first ~0.4 s, then holds. Drop it on the timeline over the last 2.5-3 s of a clip.

Usage: python make_endcard.py [--seconds 3] [--fps 15] [--rise 70] [--ffmpeg PATH]
Outputs (out/): endcard_alpha.mov (PNG codec), endcard_alpha.webm (VP8 alpha), endcard.gif, endcard_frames/
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image

W, H = 1080, 1920


def ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--overlay", type=Path, default=Path("endcard_overlay.png"))
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--seconds", type=float, default=3.0)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--anim", type=float, default=0.4, help="slide/fade duration in seconds")
    ap.add_argument("--rise", type=int, default=70, help="slide-up distance in px")
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "")
    args = ap.parse_args()

    card = Image.open(args.overlay).convert("RGBA")
    n = round(args.seconds * args.fps)
    anim_frames = max(1, round(args.anim * args.fps))
    frames_dir = args.out / "endcard_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Image.Image] = []
    for i in range(n):
        t = ease_out(min(1.0, i / anim_frames))
        dy = round((1 - t) * args.rise)
        layer = card.copy()
        if t < 1:
            layer.putalpha(layer.getchannel("A").point(lambda v, t=t: int(v * t)))
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(layer, (0, dy))
        canvas.save(frames_dir / f"f{i:04d}.png")
        frames.append(canvas)
    print(f"{n} frames")

    # GIF (1-bit alpha; edges flattened onto the card's own dark tone)
    gif = []
    for f in frames:
        a = f.getchannel("A")
        solid = Image.new("RGBA", f.size, (14, 10, 20, 255)); solid.paste(f, (0, 0), a)
        q = solid.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        q.paste(255, mask=Image.eval(a.point(lambda v: 255 if v >= 96 else 0), lambda v: 255 - v))
        gif.append(q)
    gp = args.out / "endcard.gif"
    gif[0].save(gp, save_all=True, append_images=gif[1:], loop=0, duration=round(1000 / args.fps), transparency=255, disposal=2)
    print("wrote", gp)

    if not args.ffmpeg:
        print("ffmpeg not found - MOV/WebM skipped"); return 0
    pattern = str(frames_dir / "f%04d.png")
    for name, codec in (("endcard_alpha.mov", ["-c:v", "png", "-pix_fmt", "rgba"]),
                        ("endcard_alpha.webm", ["-c:v", "libvpx", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1500k", "-metadata:s:v:0", "alpha_mode=1"])):
        out = args.out / name
        r = subprocess.run([args.ffmpeg, "-y", "-loglevel", "error", "-framerate", str(args.fps), "-i", pattern, *codec, str(out)], capture_output=True, text=True)
        print("wrote" if r.returncode == 0 else "failed", out, r.stderr[-200:] if r.returncode else f"{out.stat().st_size/1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
