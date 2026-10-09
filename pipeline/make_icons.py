# Génère les icônes PNG de la PWA (utilisé par la routine GitHub Actions
# uniquement si les icônes sont absentes du dépôt).
from PIL import Image, ImageDraw, ImageFont
import glob
import os


def font(sz):
    for p in glob.glob("/usr/share/fonts/**/DejaVuSans-Bold.ttf", recursive=True) + \
             glob.glob("/usr/share/fonts/**/LiberationSans-Bold.ttf", recursive=True):
        return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


os.makedirs("icons", exist_ok=True)
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
    img = Image.new("RGB", (size, size), (13, 15, 20))
    d = ImageDraw.Draw(img)
    m = size * 0.08
    d.rounded_rectangle([m, m, size - m, size - m], radius=size * 0.18,
                        outline=(245, 197, 66), width=max(4, int(size * 0.02)))
    d.text((size / 2, size * 0.44), "K", font=font(int(size * 0.52)),
           fill=(245, 197, 66), anchor="mm")
    d.text((size / 2, size * 0.76), "PRONOS", font=font(int(size * 0.13)),
           fill=(255, 255, 255), anchor="mm")
    img.save(f"icons/{name}")
    print(name, "ok")
