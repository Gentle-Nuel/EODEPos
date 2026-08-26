"""
One-off script: regenerate app icon assets from the EODE brand logo,
replacing the default Expo template icons.

Run: python scripts/generate-app-icons.py
"""
from PIL import Image
import numpy as np
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
SRC = os.path.join(ASSETS, "EODE-logo.png")

NAVY = (27, 42, 107, 255)   # #1B2A6B - matches app.json web.themeColor
WHITE = (255, 255, 255, 255)

logo = Image.open(SRC).convert("RGBA")


def square_flatten(path, size, bg, scale):
    canvas = Image.new("RGBA", (size, size), bg)
    logo_size = int(size * scale)
    resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
    offset = ((size - logo_size) // 2, (size - logo_size) // 2)
    canvas.paste(resized, offset, resized)
    canvas.convert("RGB").save(path)


def adaptive_foreground(path, size, scale):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    logo_size = int(size * scale)
    resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
    offset = ((size - logo_size) // 2, (size - logo_size) // 2)
    canvas.paste(resized, offset, resized)
    canvas.save(path)


def solid_background(path, size, bg):
    Image.new("RGBA", (size, size), bg).save(path)


def monochrome(path, size, scale, luma_threshold=190):
    # Android themed (monochrome) icons should read as a simple white
    # silhouette, not a filled disc. Using the raw alpha channel here
    # would just draw the whole opaque badge as one blob, so instead
    # treat only the darker linework (rings, text, glyph) as "on" and
    # let the light interior fall away to transparent.
    logo_size = int(size * scale)
    resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
    arr = np.array(resized)
    rgb = arr[:, :, :3].astype(np.float32)
    alpha = arr[:, :, 3]
    luma = rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114
    mask = (alpha > 0) & (luma < luma_threshold)

    shape = np.zeros((*resized.size[::-1], 4), dtype=np.uint8)
    shape[mask] = [255, 255, 255, 255]
    shape_img = Image.fromarray(shape, mode="RGBA")

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - logo_size) // 2, (size - logo_size) // 2)
    canvas.paste(shape_img, offset, shape_img)
    canvas.save(path)


# Main app icon (iOS + generic) - opaque, logo fills most of the canvas.
square_flatten(os.path.join(ASSETS, "icon.png"), 1024, WHITE, scale=0.94)

# Android adaptive icon layers - foreground content kept inside the ~66%
# safe zone so circular/squircle/rounded-square launcher masks don't clip
# the ring text.
adaptive_foreground(os.path.join(ASSETS, "android-icon-foreground.png"), 512, scale=0.62)
solid_background(os.path.join(ASSETS, "android-icon-background.png"), 512, NAVY)
monochrome(os.path.join(ASSETS, "android-icon-monochrome.png"), 432, scale=0.62)

# Web favicon.
square_flatten(os.path.join(ASSETS, "favicon.png"), 48, WHITE, scale=0.94)

print("Done. Regenerated icon.png, android-icon-foreground.png, "
      "android-icon-background.png, android-icon-monochrome.png, favicon.png")
