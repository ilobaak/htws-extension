from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "icons"
SOURCE = ROOT / "assets" / "branding" / "htws-icon-source.png"
SITE_ICON = ROOT / "store-site" / "assets" / "icon-128.png"
SIZES = (16, 32, 48, 128)


def build_icon() -> Image.Image:
    if not SOURCE.exists():
        raise SystemExit(f"Missing icon source: {SOURCE}")
    with Image.open(SOURCE) as source:
        return source.convert("RGBA")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = build_icon()
    for size in SIZES:
        content_size = 96 if size == 128 else size
        content = source.resize(
            (content_size, content_size), Image.Resampling.LANCZOS
        )
        icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset = (size - content_size) // 2
        icon.alpha_composite(content, (offset, offset))
        icon.save(OUTPUT / f"icon-{size}.png", optimize=True)
        if size == 128:
            SITE_ICON.parent.mkdir(parents=True, exist_ok=True)
            icon.save(SITE_ICON, optimize=True)


if __name__ == "__main__":
    main()
