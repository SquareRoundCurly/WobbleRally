"""Build and revalidate a reproducible release using the pinned public SDK."""
import json
from pathlib import Path
from pocketrealms.package import build_package, validate_package

root = Path(__file__).resolve().parents[1]
package = build_package(root)
checked = validate_package(package.archive)
assert checked.content_digest == package.content_digest
assert build_package(root).archive == package.archive
out = root / 'dist'
out.mkdir(exist_ok=True)
name = f"wobble-rally-{package.manifest['version']}"
(out / f'{name}.zip').write_bytes(package.archive)
record = {
    'module': package.manifest['module'], 'version': package.manifest['version'],
    'runtime': package.manifest['runtime'], 'archive_bytes': len(package.archive),
    'file_count': len(package.files), 'content_digest': package.content_digest,
    'archive_digest': package.archive_digest,
}
(out / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
