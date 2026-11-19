from pathlib import Path
from tempfile import gettempdir

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "store-assets"
ICON = ROOT / "public" / "icons" / "icon-128.png"
POPUP = Path(gettempdir()) / "htws-store-popup-source.png"
SITE_ICON = ROOT / "store-site" / "assets" / "icon-128.png"
FONT_ROOT = Path("C:/Windows/Fonts")

INK = "#142a3b"
DEEP_BLUE = "#173a55"
SOFT_BLUE = "#e7f0f3"
PAPER = "#f8faf9"
TEAL = "#42a99e"
ORANGE = "#ed9a4a"
YELLOW = "#f1c44f"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_ROOT / name, size)


def paste_shadowed(
    canvas: Image.Image, source: Image.Image, position: tuple[int, int], radius: int = 18
) -> None:
    x, y = position
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (x + 8, y + 12, x + source.width + 8, y + source.height + 12),
        radius=radius,
        fill=(15, 39, 55, 70),
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.alpha_composite(source, position)


def build_small_promo(icon: Image.Image) -> None:
    image = Image.new("RGB", (440, 280), SOFT_BLUE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((20, 22, 148, 258), radius=30, fill=DEEP_BLUE)
    image.paste(icon.resize((112, 112)), (28, 72), icon.resize((112, 112)))
    draw.text((174, 50), "HTWS", font=font("segoeuib.ttf", 44), fill=INK)
    draw.multiline_text(
        (174, 111),
        "Hibernate Tabs,\nWindows, and Sessions",
        font=font("segoeuib.ttf", 22),
        fill=DEEP_BLUE,
        spacing=5,
    )
    draw.text(
        (174, 202),
        "Save structure. Restore when ready.",
        font=font("segoeui.ttf", 15),
        fill="#4b6472",
    )
    image.save(OUTPUT / "small-promo-440x280.png", optimize=True)


def build_marquee(icon: Image.Image) -> None:
    image = Image.new("RGB", (1400, 560), DEEP_BLUE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((1010, -90, 1450, 350), radius=110, fill="#24506d")
    draw.rounded_rectangle((1110, 300, 1460, 650), radius=95, fill="#285d73")
    draw.rounded_rectangle((950, 365, 1125, 540), radius=50, fill=ORANGE)
    draw.rounded_rectangle((1138, 365, 1313, 540), radius=50, fill=TEAL)
    image.paste(icon.resize((286, 286)), (1000, 74), icon.resize((286, 286)))
    draw.text((86, 74), "HTWS", font=font("segoeuib.ttf", 32), fill=YELLOW)
    draw.multiline_text(
        (84, 128),
        "Hibernate Tabs, Windows,\nand Sessions",
        font=font("segoeuib.ttf", 58),
        fill=PAPER,
        spacing=7,
    )
    draw.multiline_text(
        (88, 300),
        "Put whole browsing sessions away without losing their order,\n"
        "groups, pins, names, or recovery history.",
        font=font("segoeui.ttf", 25),
        fill="#d3e3e8",
        spacing=8,
    )
    draw.text(
        (88, 438),
        "LOCAL ARCHIVE  •  STRUCTURED RESTORE  •  PRIVATE BY DEFAULT",
        font=font("segoeuib.ttf", 17),
        fill="#a9c8d3",
    )
    image.save(OUTPUT / "marquee-1400x560.png", optimize=True)


def build_popup_screenshot(icon: Image.Image) -> None:
    if not POPUP.exists():
        raise SystemExit("Capture the popup preview before building store media.")
    image = Image.new("RGBA", (1280, 800), SOFT_BLUE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 525, 800), radius=0, fill=DEEP_BLUE)
    draw.rounded_rectangle((52, 56, 166, 170), radius=28, fill="#244e68")
    image.alpha_composite(icon.resize((96, 96)), (61, 65))
    draw.text((54, 215), "A calmer browser,", font=font("segoeuib.ttf", 43), fill=PAPER)
    draw.text((54, 268), "ready when you are.", font=font("segoeuib.ttf", 43), fill=YELLOW)
    draw.multiline_text(
        (57, 350),
        "Hibernate one tab, a complete window,\n"
        "or the whole session. Restore the same\n"
        "structure later from a local archive.",
        font=font("segoeui.ttf", 23),
        fill="#d7e6ea",
        spacing=10,
    )
    draw.rounded_rectangle((56, 520, 215, 568), radius=16, fill=TEAL)
    draw.text((79, 532), "Tabs", font=font("segoeuib.ttf", 17), fill=INK)
    draw.rounded_rectangle((228, 520, 387, 568), radius=16, fill=ORANGE)
    draw.text((249, 532), "Windows", font=font("segoeuib.ttf", 17), fill=INK)
    draw.rounded_rectangle((56, 582, 215, 630), radius=16, fill=YELLOW)
    draw.text((77, 594), "Sessions", font=font("segoeuib.ttf", 17), fill=INK)
    popup = Image.open(POPUP).convert("RGBA")
    paste_shadowed(image, popup, (716, 100), radius=18)
    image.convert("RGB").save(OUTPUT / "popup-1280x800.png", optimize=True)


def main() -> None:
    try:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        SITE_ICON.parent.mkdir(parents=True, exist_ok=True)
        icon = Image.open(ICON).convert("RGBA")
        icon.save(SITE_ICON, optimize=True)
        build_small_promo(icon)
        build_marquee(icon)
        build_popup_screenshot(icon)
    finally:
        POPUP.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
