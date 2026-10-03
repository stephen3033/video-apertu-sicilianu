#!/usr/bin/env python3
"""Read-only SQLite backup and export. Never exports sessions or login challenges."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3


def export(source: Path, destination: Path, media_root: Path):
    source = source.resolve(strict=True)
    destination.mkdir(parents=True, exist_ok=True)
    os.chmod(destination, 0o700)
    # SQLite backup includes a consistent snapshot even when the source uses WAL.
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as original:
        backup = destination / "source.sqlite"
        if backup.exists():
            raise ValueError("Choose a fresh export directory; existing backups are never overwritten")
        with sqlite3.connect(backup) as snapshot:
            original.backup(snapshot)
    os.chmod(backup, 0o600)
    with sqlite3.connect(f"file:{backup}?mode=ro", uri=True) as database:
        database.row_factory = sqlite3.Row
        users = [dict(row) for row in database.execute("SELECT id,email,email_verified_at,created_at FROM users ORDER BY id")]
        submissions = [dict(row) for row in database.execute("SELECT id,user_id,title,notes,original_filename,media_kind,content_type,byte_size,storage_ref,created_at FROM submissions ORDER BY id")]
        ids = {row["id"] for row in users}
        for row in submissions:
            if row["user_id"] not in ids:
                raise ValueError("Submission refers to missing account")
            path = (media_root.resolve() / row["storage_ref"]).resolve(strict=True)
            if not path.is_relative_to(media_root.resolve()) or path.stat().st_size != row["byte_size"]:
                raise ValueError("Invalid source media reference or length")
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            row["source_path"] = str(path)
            row["sha256"] = digest.hexdigest()
        content = {"version": 1, "users": users, "submissions": submissions}
        source_id = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
        manifest = destination / "manifest.json"
        manifest.write_text(json.dumps({"source_id": source_id, **content}, ensure_ascii=False, indent=2) + "\n")
        os.chmod(manifest, 0o600)
    return {"accounts": len(users), "submissions": len(submissions), "media_bytes": sum(s["byte_size"] for s in submissions), "source_id": source_id}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--media-root", type=Path, default=Path("data/uploads"))
    args = parser.parse_args()
    print(json.dumps(export(args.source, args.destination, args.media_root)))
