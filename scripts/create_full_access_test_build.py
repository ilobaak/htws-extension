import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dist"
TARGET = (ROOT / "release" / "acceptance-full-access").resolve()


def main() -> None:
    release_root = (ROOT / "release").resolve()
    if TARGET.parent != release_root:
        raise SystemExit("Unexpected acceptance-build target.")
    if not (SOURCE / "manifest.json").exists():
        raise SystemExit("Build the extension before creating an acceptance build.")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    shutil.copytree(SOURCE, TARGET)
    manifest_path = TARGET / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["host_permissions"] = manifest.pop("optional_host_permissions")
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(TARGET)


if __name__ == "__main__":
    main()
