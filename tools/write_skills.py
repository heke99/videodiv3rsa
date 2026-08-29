"""Write skill packages from a declarative table.

Authoring 200 directories by hand invites copy-paste drift in the frontmatter,
which is exactly what the registry hash is meant to catch. Generating the
scaffold from one table keeps the descriptors consistent; the bodies are
written by hand and passed in.
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "skills"


def write(category: str, skill_id: str, spec: dict) -> None:
    directory = ROOT / category / skill_id
    directory.mkdir(parents=True, exist_ok=True)

    front = {
        "name": spec["name"],
        "version": spec.get("version", "1.0"),
        "category": category,
        "description": spec["description"],
        "status": spec.get("status", "draft"),
        "required_tools": spec.get("required_tools", []),
        "supported_models": spec.get("supported_models", []),
        "requires_skills": spec.get("requires_skills", []),
        "quality_profile": spec.get("quality_profile", "STANDARD"),
        "timeout_seconds": spec.get("timeout_seconds", 120),
        "max_retries": spec.get("max_retries", 1),
        "license": spec.get("license", "proprietary"),
        "modes": spec.get("modes", []),
        "generation_kinds": spec.get("generation_kinds", []),
    }

    lines = ["---"]
    for key, value in front.items():
        if isinstance(value, list):
            lines.append(f"{key}: {json.dumps(value)}")
        elif isinstance(value, str):
            lines.append(f"{key}: {json.dumps(value)}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    lines.append("")
    lines.append(spec.get("body", DRAFT_BODY.format(name=spec["name"])).strip())
    lines.append("")

    (directory / "SKILL.md").write_text("\n".join(lines))

    if "schema" in spec:
        (directory / "schema.json").write_text(json.dumps(spec["schema"], indent=2) + "\n")
    if "eval" in spec:
        (directory / "EVAL.md").write_text(spec["eval"].strip() + "\n")


DRAFT_BODY = """
Not yet written.

This skill is registered so the catalogue reflects the full production design,
and is marked draft so the router cannot select it. Writing it means giving it
real craft guidance and an eval that shows the guidance changes the output.
""".strip()


def write_all(category: str, skills: dict) -> None:
    for skill_id, spec in skills.items():
        write(category, skill_id, spec)
    print(f"{category}: {len(skills)} skills")
