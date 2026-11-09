import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def pytest_collection_modifyitems(config, items):
    """Skip live-network tests unless JOBSEARCH_LIVE_TESTS=1."""
    if os.environ.get("JOBSEARCH_LIVE_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="set JOBSEARCH_LIVE_TESTS=1 to run live network tests")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)
