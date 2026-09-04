"""
Draws the Agency Command app icon (real triangle mark, composited onto a
crushed-black + dark-purple glow background) and saves it in every size the
phone needs. Run once with: python3 generate_icons.py
Re-run any time to regenerate after tweaking colors/sizes below, or after
swapping in a new mark-source.png (the transparent triangle-mark artwork).
"""
from PIL import Image, ImageDraw, ImageFilter
import os

BG = (10, 10, 13, 255)            # #0a0a0d crushed black
GLOW_PURPLE = (123, 47, 247, 255) # #7b2ff7
GLOW_PURPLE_2 = (60, 20, 110, 255)

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "mark-source.png")


def add_glow(img, cx, cy, r, color, blur_frac=0.22, peak_alpha=150):
    """Paints a soft blurred glow onto img by compositing a blurred layer."""
    size = img.width
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=(color[0], color[1], color[2], peak_alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=size * blur_frac))
    img.alpha_composite(glow)


def load_mark():
    mark = Image.open(SOURCE).convert("RGBA")
    bbox = mark.getbbox()
    return mark.crop(bbox)


MARK = load_mark()


def make_icon(size, maskable=False, out_name=None, transparent=False):
    if transparent:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    else:
        img = Image.new("RGBA", (size, size), BG)
        cx, cy = size / 2, size / 2
        add_glow(img, cx, cy, size * 0.30, GLOW_PURPLE, blur_frac=0.20, peak_alpha=130)
        add_glow(img, cx, cy * 1.05, size * 0.42, GLOW_PURPLE_2, blur_frac=0.30, peak_alpha=90)

    # How much of the frame the mark should fill (width-relative).
    # Maskable icons need extra padding so the OS crop-mask never clips it.
    fill = 0.56 if maskable else 0.72
    target_w = size * fill
    scale = target_w / MARK.width
    new_w = max(1, int(MARK.width * scale))
    new_h = max(1, int(MARK.height * scale))
    mark_resized = MARK.resize((new_w, new_h), Image.LANCZOS)

    px = int((size - new_w) / 2)
    py = int((size - new_h) / 2)
    img.alpha_composite(mark_resized, (px, py))

    path = os.path.join(HERE, out_name)
    img.save(path, "PNG")
    print("wrote", path)


if __name__ == "__main__":
    make_icon(192, maskable=False, out_name="icon-192.png")
    make_icon(512, maskable=False, out_name="icon-512.png")
    make_icon(192, maskable=True, out_name="icon-maskable-192.png")
    make_icon(512, maskable=True, out_name="icon-maskable-512.png")
    make_icon(180, maskable=False, out_name="apple-touch-icon.png")
    make_icon(32, maskable=False, out_name="favicon-32.png")
    make_icon(1024, maskable=False, out_name="icon-1024.png")
    # Standalone transparent mark for use as an <img> in the topbar / auth ring.
    make_icon(256, maskable=False, out_name="mark.png", transparent=True)
