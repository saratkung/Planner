"""สร้างไอคอนแอปทุกขนาดจาก icons/logo.png (ถ้ามี) หรือวาดไอคอนสำรอง

วิธีใช้:  python3 tools/make_icons.py
ต้องมี Pillow (pip install pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
LOGO = ICONS / "logo.png"
NAVY = (42, 37, 99)


def rounded(img, radius_ratio=0.22):
    s = img.size[0]
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def square_crop(img):
    w, h = img.size
    side = min(w, h)
    return img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))


def trim_transparent(img):
    """ตัดขอบโปร่งใสรอบโลโก้ออก (ถ้ามี)"""
    if img.mode != "RGBA":
        return img
    bbox = img.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    return img.crop(bbox) if bbox else img


def fill_dark_corners(img):
    """โลโก้ที่มุมเป็นสีดำ (ไม่โปร่งใส): เติมมุมด้วยสีกรมท่าให้กลืนกับไอคอน"""
    img = img.convert("RGB")
    w, h = img.size
    for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        r, g, b = img.getpixel(xy)
        if r + g + b < 90:
            ImageDraw.floodfill(img, xy, NAVY, thresh=70)
    return img.convert("RGBA")


def fallback(size):
    """ไอคอนสำรอง: ท้องฟ้ากลางคืนสีม่วง + คลิปบอร์ดเช็กลิสต์ + คลิปสีทอง"""
    S = size * 4
    bg = Image.new("RGBA", (S, S))
    px = bg.load()
    a, b, c = (42, 37, 99), (74, 63, 166), (130, 112, 220)
    for y in range(S):
        for x in range(S):
            t = (x * 0.35 + y * 0.65) / S
            if t < 0.5:
                k = t / 0.5
                col = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
            else:
                k = (t - 0.5) / 0.5
                col = tuple(int(b[i] + (c[i] - b[i]) * k) for i in range(3))
            px[x, y] = col + (255,)
    d = ImageDraw.Draw(bg)
    # gold badge stripes
    for off, alpha in ((0.30, 150), (0.40, 110)):
        d.polygon([(0, S * off), (S, S * (off - 0.28)), (S, S * (off - 0.24)), (0, S * (off + 0.04))],
                  fill=(227, 178, 60, alpha))
    # clipboard
    w = S * 0.52
    x0, y0 = (S - w) / 2, S * 0.24
    x1, y1 = x0 + w, y0 + w * 1.12
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x0, y0 + S * 0.02, x1, y1 + S * 0.02], radius=w * 0.12, fill=(10, 8, 30, 120))
    bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(S * 0.02)))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([x0, y0, x1, y1], radius=w * 0.12, fill=(250, 248, 255, 255))
    # gold clip
    cw = w * 0.42
    d.rounded_rectangle([S / 2 - cw / 2, y0 - w * 0.08, S / 2 + cw / 2, y0 + w * 0.1], radius=w * 0.06, fill=(227, 178, 60, 255))
    # checklist rows
    for i, done in enumerate((True, True, False)):
        cy = y0 + w * (0.34 + i * 0.25)
        bx = x0 + w * 0.14
        bs = w * 0.15
        d.rounded_rectangle([bx, cy - bs / 2, bx + bs, cy + bs / 2], radius=bs * 0.25, outline=(91, 75, 196, 255), width=int(w * 0.03))
        if done:
            d.line([(bx + bs * 0.18, cy), (bx + bs * 0.45, cy + bs * 0.28), (bx + bs * 1.05, cy - bs * 0.5)],
                   fill=(91, 75, 196, 255), width=int(w * 0.045), joint="curve")
        d.rounded_rectangle([bx + bs * 1.6, cy - w * 0.025, x1 - w * 0.14, cy + w * 0.025], radius=w * 0.02,
                            fill=(205, 198, 240, 255))
    return bg.resize((size, size), Image.LANCZOS)


def main():
    if LOGO.exists():
        src = fill_dark_corners(square_crop(trim_transparent(Image.open(LOGO).convert("RGBA"))))
        art = lambda s: src.resize((s, s), Image.LANCZOS)
        print("ใช้โลโก้จาก", LOGO)
    else:
        big = fallback(1024)
        art = lambda s: big.resize((s, s), Image.LANCZOS)
        print("ไม่พบ icons/logo.png ใช้ไอคอนสำรอง")

    rounded(art(192)).save(ICONS / "icon-192.png")
    rounded(art(512)).save(ICONS / "icon-512.png")
    rounded(art(64), 0.25).save(ICONS / "favicon-64.png")
    # maskable: ระบบจะตัดเป็นวงกลม/สี่เหลี่ยมมน ต้องเว้นขอบ ~12%
    m = Image.new("RGBA", (512, 512), NAVY + (255,))
    inner = art(400)
    m.alpha_composite(inner, (56, 56))
    m.save(ICONS / "icon-maskable-512.png")
    # apple: ห้ามโปร่งใส iOS ตัดมุมให้เอง
    a = Image.new("RGB", (180, 180), NAVY)
    a.paste(art(180), (0, 0), art(180))
    a.save(ICONS / "apple-touch-icon.png")
    # รูปโลโก้สำหรับหน้าโหลด (เล็ก โหลดไว)
    rounded(art(420), 0.2).save(ICONS / "splash-logo.webp", quality=86, method=6)
    print("สร้างไอคอนแล้ว:", ", ".join(p.name for p in sorted(ICONS.glob("*.*"))))


if __name__ == "__main__":
    main()
