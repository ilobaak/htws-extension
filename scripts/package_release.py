import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def package_path() -> Path:
    manifest = json.loads((DIST / "manifest.json").read_text(encoding="utf-8"))
    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        raise SystemExit("Built manifest has no valid version.")
    return ROOT / "release" / f"htws-{version}.zip"


def main() -> None:
    if not (DIST / "manifest.json").exists():
        raise SystemExit("Build the extension before packaging it.")
    output = package_path()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            for path in sorted(DIST.rglob("*")):
                if path.is_file() and path.suffix != ".map":
                    archive.write(path, path.relative_to(DIST))
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(output)


if __name__ == "__main__":
    main()
