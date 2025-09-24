import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parents[1]
SCHEMA_ROOT = BASE_DIR / 'server' / 'src' / 'lib' / 'api' / 'schemas'

INVENTORY_PATH = BASE_DIR / 'docs' / 'openapi' / 'route-inventory.json'

IMPORT_PATTERN = re.compile(r"from\s+['\"]([^'\"]*schemas[^'\"]*)['\"]")

SUPPORTED_EXTENSIONS = ('.ts', '.tsx', '.js', '.mjs', '.cjs')


def resolve_import_path(import_path: str, importer: Path) -> Optional[Path]:
    if not import_path:
        return None

    candidates: List[Path] = []

    if import_path.startswith('@/'):
        candidates.append(BASE_DIR / 'server' / 'src' / import_path[2:])
    elif import_path.startswith('@ee/'):
        candidates.append(BASE_DIR / 'ee' / 'server' / 'src' / import_path[4:])
    elif import_path.startswith('~/'):
        candidates.append(BASE_DIR / 'server' / 'src' / import_path[2:])
    elif import_path.startswith('./') or import_path.startswith('../'):
        candidates.append((importer.parent / import_path).resolve())
    else:
        candidates.append(BASE_DIR / import_path)

    for base in candidates:
        if base.is_file():
            return base
        if base.suffix:
            if base.exists():
                return base
        for ext in SUPPORTED_EXTENSIONS:
            candidate = base.with_suffix(ext)
            if candidate.exists():
                return candidate
        for ext in SUPPORTED_EXTENSIONS:
            candidate = base / f'index{ext}'
            if candidate.exists():
                return candidate
    return None


@dataclass
class CoverageRecord:
    route_path: str
    edition: str
    methods: List[str]
    controller_file: str
    schema_imports: List[str]
    canonical_schemas: List[str]



def load_inventory() -> List[dict]:
    return json.loads(INVENTORY_PATH.read_text())


def analyze_controller(controller_file: str) -> Tuple[List[str], List[str]]:
    if not controller_file:
        return [], []
    controller_path = BASE_DIR / controller_file
    if not controller_path.exists():
        return [], []
    source = controller_path.read_text(encoding='utf-8')
    canonical: List[str] = []
    imports: List[str] = []
    for match in IMPORT_PATTERN.finditer(source):
        raw = match.group(1)
        resolved = resolve_import_path(raw, controller_path)
        if not resolved:
            continue
        rel = resolved.relative_to(BASE_DIR)
        imports.append(str(rel))
        if SCHEMA_ROOT in resolved.parents or resolved == SCHEMA_ROOT:
            canonical.append(str(rel))
    return imports, canonical


def main() -> None:
    inventory = load_inventory()

    controller_cache: Dict[str, Tuple[List[str], List[str]]] = {}

    coverage_records: List[CoverageRecord] = []

    for item in inventory:
        controller_file = item.get('controller_file', '')
        if controller_file not in controller_cache:
            controller_cache[controller_file] = analyze_controller(controller_file)
        imports, canonical = controller_cache[controller_file]
        coverage_records.append(
            CoverageRecord(
                route_path=item['route_path'],
                edition=item['edition'],
                methods=item['methods'],
                controller_file=controller_file,
                schema_imports=imports,
                canonical_schemas=canonical,
            )
        )

    total_routes = len(coverage_records)
    with_canonical = sum(1 for record in coverage_records if record.canonical_schemas)
    without_canonical = total_routes - with_canonical
    direct_handlers = sum(1 for record in coverage_records if not record.controller_file)

    controller_without_canonical = sorted({
        record.controller_file
        for record in coverage_records
        if record.controller_file and not record.canonical_schemas
    })

    gaps_per_controller: Dict[str, List[str]] = defaultdict(list)
    for record in coverage_records:
        if record.controller_file and not record.canonical_schemas:
            gaps_per_controller[record.controller_file].append(record.route_path)

    output_dir = BASE_DIR / 'docs' / 'openapi'
    output_dir.mkdir(parents=True, exist_ok=True)

    coverage_json = output_dir / 'schema-coverage.json'
    coverage_json.write_text(
        json.dumps(
            [
                {
                    'route_path': record.route_path,
                    'edition': record.edition,
                    'methods': record.methods,
                    'controller_file': record.controller_file,
                    'schema_imports': record.schema_imports,
                    'canonical_schemas': record.canonical_schemas,
                }
                for record in coverage_records
            ],
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )

    coverage_md = output_dir / 'schema-coverage.md'
    lines: List[str] = []
    lines.append('# Schema Coverage Snapshot')
    lines.append('')
    lines.append(f'- Total routes: {total_routes}')
    lines.append(f'- Routes with canonical schemas: {with_canonical} ({with_canonical * 100 // max(total_routes, 1)}%)')
    lines.append(f'- Routes missing canonical schemas: {without_canonical}')
    lines.append(f'- Routes handled without controllers (likely Next.js handlers): {direct_handlers}')
    lines.append('')

    lines.append('## Controllers Missing Canonical Schemas')
    if controller_without_canonical:
        for controller in controller_without_canonical:
            routes = gaps_per_controller[controller]
            lines.append(f'- `{controller}` ({len(routes)} routes)')
    else:
        lines.append('- All controllers import canonical schemas.')
    lines.append('')

    top_gaps = sorted(
        (
            (record.route_path, record.edition, record.methods)
            for record in coverage_records
            if not record.canonical_schemas
        ),
        key=lambda x: x[0],
    )

    lines.append('## Routes Lacking Canonical Schemas')
    for route_path, edition, methods in top_gaps[:50]:
        method_str = '/'.join(methods)
        lines.append(f'- `{method_str}` {route_path} ({edition})')
    if len(top_gaps) > 50:
        lines.append(f'- ...and {len(top_gaps) - 50} more')

    coverage_md.write_text('\n'.join(lines) + '\n', encoding='utf-8')

    summary = {
        'total_routes': total_routes,
        'with_canonical': with_canonical,
        'without_canonical': without_canonical,
        'direct_handlers': direct_handlers,
        'controllers_missing_canonical': controller_without_canonical,
    }

    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
