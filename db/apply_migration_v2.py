#!/usr/bin/env python3
"""Backward-compatible entrypoint — applies all pending ECC migrations."""

from __future__ import annotations

import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("apply_migrations.py")), run_name="__main__")
