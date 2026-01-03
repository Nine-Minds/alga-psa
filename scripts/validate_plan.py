#!/usr/bin/env python3
"""
Lightweight validation for an ALGA plan folder.

Checks:
- required files exist
- features.json is valid JSON array
- each feature has required keys and types
- tests.json is valid JSON array with required keys and types
- optional test featureIds reference existing feature ids (when present)
- scratchpad presence is recommended (warn if missing)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an ALGA plan folder.")
    parser.add_argument(
        "plan_dir",
        help="Path to a plan folder containing PRD.md, features.json, tests.json.",
    )
    args = parser.parse_args()

    plan_dir = Path(args.plan_dir)
    prd = plan_dir / "PRD.md"
    features = plan_dir / "features.json"
    tests = plan_dir / "tests.json"
    scratchpad = plan_dir / "SCRATCHPAD.md"

    missing = [p.name for p in (prd, features, tests) if not p.exists()]
    if missing:
        raise SystemExit(f"Missing required file(s): {', '.join(missing)}")

    if not scratchpad.exists():
        print("⚠️  Missing recommended file: SCRATCHPAD.md")

    try:
        features_data = json.loads(features.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SystemExit(f"features.json is not valid JSON: {e}") from e

    if not isinstance(features_data, list):
        raise SystemExit("features.json must be a JSON array.")

    feature_ids: set[str] = set()
    for i, item in enumerate(features_data):
        if not isinstance(item, dict):
            raise SystemExit(f"Feature at index {i} must be an object.")
        if "description" not in item or not isinstance(item["description"], str):
            raise SystemExit(f"Feature at index {i} missing string 'description'.")
        if "implemented" not in item or not isinstance(item["implemented"], bool):
            raise SystemExit(f"Feature at index {i} missing boolean 'implemented'.")
        if "id" in item:
            if not isinstance(item["id"], str) or not item["id"].strip():
                raise SystemExit(f"Feature at index {i} has invalid 'id' (must be string).")
            feature_ids.add(item["id"])
        if "prdRefs" in item:
            if not isinstance(item["prdRefs"], list) or not all(
                isinstance(x, str) for x in item["prdRefs"]
            ):
                raise SystemExit(
                    f"Feature at index {i} has invalid 'prdRefs' (must be array of strings)."
                )

    print(f"✅ {plan_dir} looks valid.")
    print(f"✅ features.json features: {len(features_data)}")

    try:
        tests_data = json.loads(tests.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SystemExit(f"tests.json is not valid JSON: {e}") from e

    if not isinstance(tests_data, list):
        raise SystemExit("tests.json must be a JSON array.")

    for i, item in enumerate(tests_data):
        if not isinstance(item, dict):
            raise SystemExit(f"Test at index {i} must be an object.")
        if "description" not in item or not isinstance(item["description"], str):
            raise SystemExit(f"Test at index {i} missing string 'description'.")
        if "implemented" not in item or not isinstance(item["implemented"], bool):
            raise SystemExit(f"Test at index {i} missing boolean 'implemented'.")
        if "id" in item and (not isinstance(item["id"], str) or not item["id"].strip()):
            raise SystemExit(f"Test at index {i} has invalid 'id' (must be string).")
        if "featureIds" in item:
            if not isinstance(item["featureIds"], list) or not all(
                isinstance(x, str) for x in item["featureIds"]
            ):
                raise SystemExit(
                    f"Test at index {i} has invalid 'featureIds' (must be array of strings)."
                )
            if feature_ids:
                unknown = [x for x in item["featureIds"] if x not in feature_ids]
                if unknown:
                    raise SystemExit(
                        f"Test at index {i} references unknown feature id(s): {', '.join(unknown)}"
                    )

    print(f"✅ tests.json tests: {len(tests_data)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

