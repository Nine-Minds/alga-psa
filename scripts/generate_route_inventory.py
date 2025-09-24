import csv
import json
import os
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional, Set

BASE_DIR = Path(__file__).resolve().parents[1]

@dataclass
class RouteRecord:
    edition: str
    route_path: str
    methods: List[str]
    route_file: str
    controller: str
    controller_import: str
    controller_file: str


def detect_methods(source: str) -> List[str]:
    method_matches: Set[str] = set()
    for match in re.findall(r"export\s+(?:const|async\s+function|function)\s+([A-Z]+)\b", source):
        method_matches.add(match.upper())
    for block in re.findall(r"export\s*{\s*([^}]*)}", source):
        tokens = [token.strip() for token in block.split(',')]
        for token in tokens:
            if not token:
                continue
            if ' as ' in token:
                token = token.rsplit(' as ', 1)[-1].strip()
            if token.isupper():
                method_matches.add(token)
    for block in re.findall(r"export\s+const\s+{\s*([^}]*)}", source):
        tokens = [token.strip() for token in block.split(',')]
        for token in tokens:
            if token.isupper():
                method_matches.add(token)
    return sorted(method_matches)


def detect_controller(source: str) -> str:
    controller_match = re.search(r"new\s+(\w+Controller)\s*\(", source)
    if controller_match:
        return controller_match.group(1)
    handler_match = re.search(r"class\s+(\w+Controller)\s+extends", source)
    if handler_match:
        return handler_match.group(1)
    return ""


def detect_controller_import(source: str) -> str:
    import_match = re.search(r"from\s+'([^']*controllers[^']*)'", source)
    if import_match:
        return import_match.group(1)
    import_match = re.search(r'from\s+"([^"]*controllers[^"]*)"', source)
    if import_match:
        return import_match.group(1)
    return ""


def resolve_controller_file(import_path: str, route_file: Path) -> str:
    if not import_path:
        return ""

    candidates: List[Path] = []

    if import_path.startswith('@/'):
        rel = import_path[2:]
        candidates.append(BASE_DIR / 'server' / 'src' / rel)
    elif import_path.startswith('@ee/'):
        rel = import_path[4:]
        candidates.append(BASE_DIR / 'ee' / 'server' / 'src' / rel)
    elif import_path.startswith('~/'):
        rel = import_path[2:]
        candidates.append(BASE_DIR / 'server' / 'src' / rel)
    elif import_path.startswith('./') or import_path.startswith('../'):
        candidates.append((route_file.parent / import_path).resolve())
    else:
        candidates.append(BASE_DIR / import_path)

    extension_candidates = ['.ts', '.tsx', '.js', '.mjs', '.cjs']

    def existing_path(base: Path) -> Optional[Path]:
        if base.is_file():
            return base
        if base.suffix:
            if base.exists():
                return base
        for ext in extension_candidates:
            candidate = base.with_suffix(ext)
            if candidate.exists():
                return candidate
        # Support index files in directories
        for ext in extension_candidates:
            candidate = base / f'index{ext}'
            if candidate.exists():
                return candidate
        return None

    for base in candidates:
        resolved = existing_path(base)
        if resolved and BASE_DIR in resolved.parents:
            return str(resolved.relative_to(BASE_DIR))
    return ""


def next_path_to_openapi(rel_path: Path) -> str:
    segments = ['api']
    for segment in rel_path.parts:
        if segment in {'route.ts', 'route.tsx', 'route'}:
            continue
        if segment.startswith('(') and segment.endswith(')'):
            # Next.js "group" segment, skip in route path
            continue
        if segment.startswith('['):
            # Normalize dynamic segments to OpenAPI-style parameters
            raw = segment
            while raw.startswith('[') and raw.endswith(']'):
                raw = raw[1:-1]
            raw = raw.removeprefix('...').removeprefix('..')
            if not raw:
                raw = 'param'
            segment = '{' + raw + '}'
        segments.append(segment)
    return '/' + '/'.join(segments)


def collect_records(base: Path, edition: str) -> List[RouteRecord]:
    records: List[RouteRecord] = []
    for dirpath, _, filenames in os.walk(base):
        for filename in filenames:
            if filename not in {'route.ts', 'route.tsx'}:
                continue
            route_file_path = Path(dirpath, filename)
            rel = route_file_path.relative_to(base)
            with route_file_path.open('r', encoding='utf-8') as fh:
                source = fh.read()
            methods = detect_methods(source)
            controller = detect_controller(source)
            controller_import = detect_controller_import(source)
            controller_file = resolve_controller_file(controller_import, route_file_path)
            route_path = next_path_to_openapi(rel)
            records.append(
                RouteRecord(
                    edition=edition,
                    route_path=route_path,
                    methods=methods,
                    route_file=str(route_file_path.relative_to(BASE_DIR)),
                    controller=controller,
                    controller_import=controller_import,
                    controller_file=controller_file,
                )
            )
    records.sort(key=lambda r: (r.route_path, r.edition))
    return records


def main() -> None:
    targets = [
        ('CE', BASE_DIR / 'server' / 'src' / 'app' / 'api'),
        ('EE', BASE_DIR / 'ee' / 'server' / 'src' / 'app' / 'api'),
    ]
    records: List[RouteRecord] = []
    for edition, base in targets:
        if base.exists():
            records.extend(collect_records(base, edition))

    output_dir = BASE_DIR / 'docs' / 'openapi'
    output_dir.mkdir(parents=True, exist_ok=True)

    json_path = output_dir / 'route-inventory.json'
    csv_path = output_dir / 'route-inventory.csv'

    with json_path.open('w', encoding='utf-8') as jf:
        json.dump([asdict(r) for r in records], jf, indent=2)
        jf.write('\n')

    with csv_path.open('w', encoding='utf-8', newline='') as cf:
        writer = csv.writer(cf)
        writer.writerow([
            'edition',
            'route_path',
            'methods',
            'route_file',
            'controller',
            'controller_import',
            'controller_file',
        ])
        for record in records:
            writer.writerow([
                record.edition,
                record.route_path,
                ' '.join(record.methods),
                record.route_file,
                record.controller,
                record.controller_import,
                record.controller_file,
            ])

    print(f"Wrote {len(records)} routes to {json_path} and {csv_path}")


if __name__ == '__main__':
    main()
