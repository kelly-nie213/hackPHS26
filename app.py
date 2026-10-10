streamlit

import streamlit as st

st.set_page_config(
    page_title="NYC Sunlight Watch",
    page_icon="☀️",
    layout="wide",
)

st.title("☀️ NYC Sunlight Watch")
st.subheader("Who gets sunlight — and who loses it?")

st.write(
    "Explore how skyscraper shadows can affect sunlight in "
    "New York City's public parks."
)

st.info(
    "Prototype dashboard: the figures below are examples, "
    "not verified measurements. Real shadow calculations "
    "will be connected in a later step."
)

parks = {
    "Example Park A": 120,
    "Example Park B": 85,
    "Example Park C": 42,
}

st.header("🌳 Park sunlight-loss rankings")
st.caption("Illustrative example hours per year")

for rank, (park, hours) in enumerate(
    sorted(parks.items(), key=lambda item: item[1], reverse=True),
    start=1,
):
    st.metric(
        label=f"{rank}. {park}",
        value=f"{hours} hours",
    )

st.header("🔭 What comes next?")
st.write(
    "1. Load NYC park boundaries and building heights.\n\n"
    "2. Calculate building shadows at different times.\n\n"
    "3. Use 2025 weather data to estimate sunlight actually lost.\n\n"
    "4. Add an interactive 3D shadow map."
)
