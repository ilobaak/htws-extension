import json
from pathlib import PurePosixPath
from pathlib import Path
from struct import unpack
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def load_manifest() -> dict:
    return json.loads((ROOT / "public" / "manifest.json").read_text(encoding="utf-8"))


def require_png(path: Path, size: tuple[int, int], rgba: bool = False) -> None:
    if not path.exists():
        raise SystemExit(f"Missing store image: {path}")
    with path.open("rb") as stream:
        header = stream.read(26)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise SystemExit(f"{path} is not a valid PNG image.")
    width, height = unpack(">II", header[16:24])
    if (width, height) != size:
        raise SystemExit(f"{path} is {(width, height)}; expected {size}.")
    if rgba and header[25] != 6:
        raise SystemExit(f"{path} must use RGBA color for transparent padding.")


def main() -> None:
    manifest = load_manifest()
    version = manifest.get("version")
    package = ROOT / "release" / f"htws-{version}.zip"
    if manifest.get("name") != "Hibernate Tabs, Windows, and Sessions":
        raise SystemExit("Manifest product name is not the reviewed HTWS name.")
    if manifest.get("short_name") != "HTWS":
        raise SystemExit("Manifest short name is not HTWS.")
    if manifest.get("action", {}).get("default_title") != manifest.get("name"):
        raise SystemExit("Manifest action title does not match the product name.")
    expected_permissions = {
        "alarms",
        "bookmarks",
        "contextMenus",
        "scripting",
        "storage",
        "tabGroups",
        "tabs",
    }
    if set(manifest.get("permissions", [])) != expected_permissions:
        raise SystemExit("Manifest permissions differ from the reviewed release set.")
    if manifest.get("minimum_chrome_version") != "119":
        raise SystemExit("The reviewed minimum Chrome version must remain 119.")
    privacy = (ROOT / "PRIVACY.md").read_text(encoding="utf-8")
    if "including the Limited Use requirements" not in privacy:
        raise SystemExit("Privacy policy is missing the Limited Use statement.")
    public_privacy = (ROOT / "store-site" / "privacy.html").read_text(
        encoding="utf-8"
    )
    for disclosure in (
        "including the Limited Use requirements",
        "optional website access",
        "Private And Incognito Tabs",
    ):
        if disclosure.casefold() not in public_privacy.casefold():
            raise SystemExit(
                f"Public privacy page is missing disclosure: {disclosure}"
            )
    public_support = (ROOT / "store-site" / "support.html").read_text(
        encoding="utf-8"
    )
    for support_requirement in (
        "https://github.com/ilobaak/htws-extension/issues",
        "Do not include private URLs or exported archive files",
    ):
        if support_requirement.casefold() not in public_support.casefold():
            raise SystemExit(
                f"Public support page is missing: {support_requirement}"
            )
    listing = (ROOT / "STORE_LISTING.md").read_text(encoding="utf-8")
    for heading in (
        "## Prominent data-use disclosure",
        "## Permission justifications",
        "## Privacy dashboard answers",
    ):
        if heading not in listing:
            raise SystemExit(f"Store listing is missing {heading}.")
    for screenshot in (
        "hibernated-1280x800.png",
        "popup-1280x800.png",
        "activity-1280x800.png",
        "options-1280x800.png",
    ):
        require_png(ROOT / "store-assets" / screenshot, (1280, 800))
    require_png(ROOT / "store-assets" / "small-promo-440x280.png", (440, 280))
    require_png(ROOT / "store-assets" / "marquee-1400x560.png", (1400, 560))
    require_png(
        ROOT / "public" / "icons" / "icon-128.png", (128, 128), rgba=True
    )

    if not package.exists():
        raise SystemExit(f"Missing release package: {package}")
    with ZipFile(package) as archive:
        names = archive.namelist()
        if "manifest.json" not in names:
            raise SystemExit("Release package has no root manifest.json.")
        unsafe = [
            name
            for name in names
            if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts
        ]
        if unsafe:
            raise SystemExit(f"Release package contains unsafe paths: {unsafe}")
        forbidden = [
            name
            for name in names
            if name.endswith((".map", ".ts", ".tsx"))
            or PurePosixPath(name).name in {".DS_Store", "Thumbs.db"}
        ]
        if forbidden:
            raise SystemExit(f"Release package contains development files: {forbidden}")
        packaged_manifest = json.loads(archive.read("manifest.json"))
        if packaged_manifest != manifest:
            raise SystemExit("Packaged manifest does not match public/manifest.json.")
        empty_files = [
            info.filename
            for info in archive.infolist()
            if not info.is_dir() and info.file_size == 0
        ]
        if empty_files:
            raise SystemExit(f"Release package contains empty files: {empty_files}")

    print("Store assets and release package are valid.")


if __name__ == "__main__":
    main()
