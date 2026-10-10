"""
Estimate weather-adjusted sunlight lost by NYC parks.

Weather source: Open-Meteo Historical Weather API.
The shadow timestamps must come from your building-shadow calculation.
These are modeled estimates, not official sunlight measurements.
"""

import json
from urllib.parse import urlencode
from urllib.request import urlopen

API_URL = "https://archive-api.open-meteo.com/v1/archive"

NYC_LATITUDE = 40.7128
NYC_LONGITUDE = -74.0060


def fetch_2025_weather():
    """Download actual historical weather data for NYC in 2025."""
    params = {
        "latitude": NYC_LATITUDE,
        "longitude": NYC_LONGITUDE,
        "start_date": "2025-01-01",
        "end_date": "2025-12-31",
        "hourly": "sunshine_duration,direct_radiation",
        "timezone": "America/New_York",
    }

    url = API_URL + "?" + urlencode(params)

    with urlopen(url, timeout=30) as response:
        data = json.load(response)

    hourly = data["hourly"]

    # Match each local timestamp to estimated sunshine seconds
    # during that hour.
    weather = {}

    for i, timestamp in enumerate(hourly["time"]):
        sunshine_seconds = hourly["sunshine_duration"][i]

        weather[timestamp] = {
            "sunshine_hours": (
                sunshine_seconds / 3600
                if sunshine_seconds is not None
                else 0.0
            ),
            "direct_radiation": hourly["direct_radiation"][i],
        }

    return weather


def calculate_park_loss(shadowed_timestamps, weather):
    """
    Estimate sunlight lost during hours when a building casts
    a shadow on a park.

    shadowed_timestamps: timestamps marked as shadowed by
    your 3D shadow calculation.
    weather: dictionary returned by fetch_2025_weather().
    """
    lost_hours = 0.0
    matched_hours = 0

    for timestamp in set(shadowed_timestamps):
        hour_weather = weather.get(timestamp)

        if hour_weather is None:
            continue

        lost_hours += hour_weather["sunshine_hours"]
        matched_hours += 1

    return {
        "lost_sunlight_hours": round(lost_hours, 1),
        "matched_weather_hours": matched_hours,
    }


def rank_parks(shadowed_hours_by_park, weather):
    """Rank parks from most to least estimated sunlight lost."""
    results = []

    for park_name, timestamps in shadowed_hours_by_park.items():
        loss = calculate_park_loss(timestamps, weather)

        results.append({
            "park": park_name,
            **loss,
        })

    return sorted(
        results,
        key=lambda item: item["lost_sunlight_hours"],
        reverse=True,
    )


if __name__ == "__main__":
    weather = fetch_2025_weather()
    print(f"Downloaded weather for {len(weather)} hours.")

    # DEMO INPUT ONLY: replace these example timestamps with
    # timestamps produced by your actual shadow-map calculation.
    example_shadows = {
        "Example Park": [
            "2025-06-15T14:00",
            "2025-06-15T15:00",
        ],
    }

    for result in rank_parks(example_shadows, weather):
        print(result)
