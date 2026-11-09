#!/usr/bin/env python3
"""Standalone entrypoint for the job-search skill.

Runs from any working directory without installation or PYTHONPATH, which lets
any agent harness invoke it as `<skill-dir>/jobsearch.py ...`.

    /path/to/job-search/jobsearch.py --company Stripe --title engineer
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jobsearch.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
