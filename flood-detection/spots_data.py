"""The 40 SAMPLE recurring flood spots in static/data/flood-spots.js, and the switch that turns them off.

They were made up for the prototype (modelled on QCDRRMO / MMDA advisories), so once real sightings
are in the flood-spot log they should stop counting as the agent's S input:

    flask --app app sample-spots off     the map, Rule 1 and Rule 2 use only the real log (flood_spots table)
    flask --app app sample-spots on      count the samples again
    flask --app app sample-spots         show which it is
    flask --app app import-spots FILE    add real sightings from a CSV file (see app.py import_spots)

The choice is saved in instance/settings.json. FDA_SAMPLE_SPOTS=0 / 1 in the environment overrides it.
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_FILE = os.path.join(HERE, "static", "data", "flood-spots.js")
_seeds = []


def _settings_path():
    from flask import current_app
    return current_app.config.get("SETTINGS_FILE") or os.path.join(current_app.instance_path, "settings.json")


def _settings():
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def sample_spots_on():
    env = os.environ.get("FDA_SAMPLE_SPOTS")
    if env in ("0", "1"):
        return env == "1"
    return _settings().get("sample_spots", True) is not False


def set_sample_spots(on):
    data = _settings()
    data["sample_spots"] = bool(on)
    os.makedirs(os.path.dirname(_settings_path()), exist_ok=True)
    with open(_settings_path(), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _field(line, key, number=False):
    m = re.search(r'\b%s:\s*(-?[\d.]+)' % key if number else r'\b%s:\s*"([^"]*)"' % key, line)
    return (float(m.group(1)) if number else m.group(1)) if m else None


def all_seed_spots():
    """Every sample spot with its position, worked out as core/hazard.js does (barangay centre moved dn m north, de m east)."""
    if not _seeds:
        from agent import barangay_centre
        with open(SEED_FILE, encoding="utf-8") as f:
            for line in f:
                name = _field(line, "b")
                centre = barangay_centre(name) if name else None
                if not centre:
                    continue
                dn, de = _field(line, "dn", True) or 0, _field(line, "de", True) or 0
                _seeds.append({"barangay": name, "corner": _field(line, "corner") or "", "times": int(_field(line, "n", True) or 1),
                               "lat": centre[0] + dn / 111320, "lng": centre[1] + de / (111320 * math.cos(math.radians(centre[0])))})
    return _seeds


def seed_spots():
    """The sample spots that count right now: all of them, or none when they are turned off."""
    return all_seed_spots() if sample_spots_on() else []
