#!/usr/bin/env python3
"""Mid-video prompt widgets from prompts_sheet.png (rendered from prompts.html).

  follow  - 3 s: slide in, heart pops red, button fills to "Following", slide out
  Q1..Q5  - 3 s comment prompts: slide in, arrow nudges toward the comment button, slide out

Render the sheet with --window-size=1080,2100: headless Chromium's viewport is ~90 px shorter than the window,
so a 1920 window clips anything below y~1830.
Widgets sit at x=60, y=1180 (bottom edge ~1305): below the centre of the action, above TikTok's caption
bubble, left of every platform's button column. Usage: python make_prompts.py [--ffmpeg PATH]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image

W, H = 1080, 1920
FPS = 15
X, Y = 60, 1180
BANDS = {"A": (0, 170), "AB": (170, 330), "B": (330, 490), "HEART": (490, 660),
         "Q1": (660, 820), "Q2": (820, 980), "Q3": (980, 1140), "Q4": (1140, 1300), "Q5": (1300, 1460),
         "A2": (1460, 1620), "AB2": (1620, 1780), "B2": (1780, 1920)}


def ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def crop_bands(sheet: Image.Image) -> dict[str, Image.Image]:
    out = {}
    a = sheet.getchannel("A")
    for name, (y0, y1) in BANDS.items():
        band = sheet.crop((0, y0, W, y1))
        bb = band.getchannel("A").getbbox()
        out[name] = band.crop(bb)
    return out


def place(canvas: Image.Image, img: Image.Image, x: int, y: int, alpha: float = 1.0, scale: float = 1.0, anchor=None) -> None:
    if scale != 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    if alpha < 1.0:
        img = img.copy(); img.putalpha(img.getchannel("A").point(lambda v: int(v * alpha)))
    if anchor:  # centre on anchor point
        x, y = anchor[0] - img.width // 2, anchor[1] - img.height // 2
    canvas.alpha_composite(img, (x, y))


def slide(i: int, n: int, w: int) -> tuple[int, float]:
    """(x, alpha) for slide-in over first 5 frames and slide-out over last 5."""
    if i < 5:
        t = ease_out(i / 5); return round(X - (1 - t) * (w + X)), t
    if i >= n - 5:
        t = ease_out((i - (n - 5)) / 5); return round(X - t * (w + X)), 1 - t
    return X, 1.0


def follow_frames(el: dict[str, Image.Image]) -> list[Image.Image]:
    n = 45
    frames = []
    A, AB, B, heart = el["A"], el["AB"], el["B"], el["HEART"]
    # heart centre inside the panel: find it from the red pixels of AB
    red = AB.convert("RGB").getchannel("R").point(lambda v: 255 if v > 200 else 0)
    g = AB.convert("RGB").getchannel("G").point(lambda v: 255 if v < 120 else 0)
    from PIL import ImageChops
    bb = ImageChops.multiply(red, g).getbbox()
    hc = ((bb[0] + bb[2]) // 2, (bb[1] + bb[3]) // 2)
    for i in range(n):
        c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        x, al = slide(i, n, A.width)
        if i < 18:
            panel = A
        elif i < 27:
            panel = AB
        else:
            panel = B
        pscale = 1.0
        if 27 <= i < 32:  # button fill: tiny bump
            t = (i - 27) / 5; pscale = 1 + 0.03 * (1 - abs(2 * t - 1))
        if pscale != 1.0:
            place(c, panel, 0, 0, al, pscale, anchor=(x + panel.width // 2, Y + panel.height // 2))
        else:
            place(c, panel, x, Y, al)
        if 18 <= i < 23:  # heart pop
            t = (i - 18) / 5
            s = (1.0 + 0.45 * (1 - abs(2 * t - 1))) * (64 / heart.width)
            place(c, heart, 0, 0, al, s, anchor=(x + hc[0], Y + hc[1]))
        if 27 <= i < 32 and pscale == 1.0:
            pass
        frames.append(c)
    return frames


def comment_frames(panel: Image.Image) -> list[Image.Image]:
    n = 45
    frames = []
    for i in range(n):
        c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        x, al = slide(i, n, panel.width)
        nudge = 0
        if 12 <= i < 36:  # arrow nudge: whole panel shifts right 10 px twice
            t = ((i - 12) % 12) / 12
            nudge = round(10 * (1 - abs(2 * t - 1)))
        place(c, panel, x + nudge, Y, al)
        frames.append(c)
    return frames


def export(frames: list[Image.Image], out_dir: Path, name: str, ffmpeg: str) -> None:
    fd = out_dir / f"{name}_frames"; fd.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames):
        f.save(fd / f"f{i:04d}.png")
    gif = []
    for f in frames:
        a = f.getchannel("A")
        solid = Image.new("RGBA", f.size, (14, 10, 20, 255)); solid.paste(f, (0, 0), a)
        q = solid.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        q.paste(255, mask=Image.eval(a.point(lambda v: 255 if v >= 96 else 0), lambda v: 255 - v))
        gif.append(q)
    gif[0].save(out_dir / f"{name}.gif", save_all=True, append_images=gif[1:], loop=0, duration=round(1000 / FPS), transparency=255, disposal=2)
    if ffmpeg:
        for ext, codec in (("mov", ["-c:v", "png", "-pix_fmt", "rgba"]),
                           ("webm", ["-c:v", "libvpx", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1200k", "-metadata:s:v:0", "alpha_mode=1"])):
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(fd / "f%04d.png"), *codec, str(out_dir / f"{name}_alpha.{ext}")], check=True)
    print("wrote", name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", type=Path, default=Path("prompts_sheet.png"))
    ap.add_argument("--out", type=Path, default=Path("out/prompts"))
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "")
    args = ap.parse_args()
    el = crop_bands(Image.open(args.sheet).convert("RGBA"))
    args.out.mkdir(parents=True, exist_ok=True)
    for k, v in el.items():
        v.save(args.out / f"element_{k}.png")
    export(follow_frames(el), args.out, "follow", args.ffmpeg)
    export(follow_frames({"A": el["A2"], "AB": el["AB2"], "B": el["B2"], "HEART": el["HEART"]}), args.out, "follow_youtube", args.ffmpeg)
    for q in ("Q1", "Q2", "Q3", "Q4", "Q5"):
        export(comment_frames(el[q]), args.out, f"comment_{q}", args.ffmpeg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
