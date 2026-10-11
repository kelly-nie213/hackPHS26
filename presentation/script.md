# Shadow Ledger: presentation script

About 4½ minutes at a relaxed pace. **Bold** lines are the ones to land; slow down on them.
Numbers in [brackets] are slide numbers. Switch to the next slide on "→".

---

## [1] Cover (15 sec)

Hi, I'm [name]. My project is **Shadow Ledger**.

It answers one question: when a skyscraper goes up, who loses the sunlight, and what does the city get back? →

## [2] The trade-off (25 sec)

Cities let developers build taller in exchange for public benefits, usually new housing or a plaza. Those benefits get written down and counted.

But a supertall tower also takes something from everyone around it: sunlight on the street, on the sidewalk, in the park.

**That cost almost never gets measured, building by building.** →

## [3] The question (15 sec)

So here's the question I set out to answer:

**For every hour of sun a tower takes from the public, how many homes did the city get back?** →

## [4] What it is (25 sec)

This is Shadow Ledger. It's a 3D model of eight American downtowns: about 57,000 buildings at their real heights.

You can scrub to any minute of 2025, and the sun, the shadows and even the cloud cover match what actually happened that day.

Behind the map, it replays every sunny hour of the year to keep score. →

> **If you're doing a live demo, do it here** (see "Live demo" below), then come back to slide 5.

## [5] How it works (40 sec)

Three steps.

**One: replay the weather.** I use historical hourly weather data to find every hour of 2025 the sun actually shone, and for how many minutes.

**Two: cast every shadow.** For each of those hours I compute where the sun was and cast every building's shadow onto a 4-metre grid of the city. Only public ground counts: streets, sidewalks, plazas and parks. Rooftops don't.

**Three: divide by homes.** A building's average shade divided by the number of homes inside it gives *shade per home*. Every residential building gets an A-to-F grade against its neighbors. →

## [6] Shade per home (30 sec)

Feature one: click any building and you get its grade.

This is Central Park Tower, 472 metres tall. Its shadow, in purple, reaches deep into Central Park. On an average sunny hour it shades about 46,600 square metres of public ground, and it has 179 homes.

That's 260 square metres of shade per home. The typical building here casts 33.

**So it gets an F: more shade per home than 95% of the 11,000 residential buildings in the map.** →

## [7] The finding (30 sec)

And this was the most interesting result: **being tall isn't what earns an F.**

Look at City Spire and 242 West 53rd. Both are over 220 metres, but they hold hundreds of homes, so their shade per home is close to normal.

The F's go to the slim luxury towers on Billionaires' Row. Steinway Tower has only 60 homes, so it casts **15 times** the shade per home of a typical building. →

## [8] Parks (30 sec)

Feature two is about parks. For every sunny hour, I cast every tower's shadow over every park and add up the hours each spot loses. Pink and purple on the heatmap is where sun is being taken.

Grand Army Plaza, at the corner of Central Park, loses 610 hours of direct sun per spot. That's nearly one in five of its sunny hours.

It's also fair: **a tower is only charged if no shorter building was already shading that spot.** And it names names: 761 Fifth Avenue alone takes 383 of those hours. →

## [9] In numbers (20 sec)

A few more numbers. Central Park lost almost 58,000 acre-hours of direct sun to towers over 150 metres last year. Its most-shaded spot lost over a third of its sunny hours.

And it's not just New York. In downtown Chicago, 67 of 74 parks lose sun to tall towers. →

## [10] Eight cities (15 sec)

The same method runs on eight downtowns. New York uses official city building and tax data. The other seven use OpenStreetMap, and the app tells you when a number is estimated. Adding a city is one config entry and one command. →

## [11] How it's built (25 sec)

Quickly, how it's built. A Python pipeline pulls buildings, homes, parks and a year of hourly weather for each city.

The shadow engine is my own: the sun-position math and shadow geometry are written from scratch, and they run in background threads so the 3D view never freezes.

The 3D view uses three.js. **It's about 2,900 lines of plain JavaScript and Python, with no build step.** One command and it runs in a browser. →

## [12] Why it's different (30 sec)

So what makes this different? Shadow studies already exist. When a big building is proposed, someone models its shadow, usually for one building, on a few sample days, assuming clear skies. Then the report goes to a review board.

Shadow Ledger turns that around. **It scores every building that's already standing, across every hour the sun actually shone,** and it asks a new question. Not just "does this tower shade the park?" but **"what did the public get in return?"**

And anyone can use it by searching their own address. →

## [13] Limits and next steps (25 sec)

I want to be upfront about the limits. Outside New York, home counts are often estimated, so those grades are approximate, and the app says so. Towers just outside each study area aren't counted. And overlapping shadows get charged to both towers.

Next, I'd like to let people drop in a proposed tower and score it before it's built, and turn grades into report cards that community boards can bring to a hearing. →

## [14] Close (10 sec)

**Every skyline keeps a ledger. Now anyone can read it.**

Thank you. I'd love to take questions, or show you your own block.

---

## Live demo (optional, about 60 sec)

Have it running before you start: `python3 -m http.server 8000` in the project folder, then open
`http://localhost:8000/explore.html?city=nyc&date=2025-12-21&time=14:30&play=0`
and give it a minute or two to finish ranking, so grades and the parks list show up right away.

1. **Press play** on the time slider. "This is December 21st. Watch the shadows sweep north across Central Park as the sun moves."
2. **Click Central Park Tower** (the tall dark red tower at the south end of the park). "Here's its grade card. F, 260 square metres per home."
3. **Click Grand Army Plaza** in the parks list on the left. "Here's the park, the hours it loses, and the towers responsible."
4. **Type an address** in the search bar (a judge's school, or somewhere they name). "And you can look up any address."

Backup link that opens straight to the park: `…/explore.html?city=nyc&park=Grand%20Army%20Plaza`

If the Wi-Fi or laptop fails, skip the demo. Slides 6 and 8 show the same screens.

---

## Likely judge questions

**How accurate is it?**
In New York, building heights are surveyed roof heights from NYC Open Data, and home counts come from the city's tax-lot database (PLUTO), so those grades are solid. In other cities, heights come from OpenStreetMap, and homes are estimated when units aren't mapped, so I label those grades as approximate.

**Why divide by homes and not by something else?**
Housing is the main public benefit cities point to when they allow taller buildings, so it's the fairest thing to weigh the shadow against. A tower full of homes is giving something back for its shadow, and a slim spire with 60 condos mostly isn't.

**Doesn't every building cast a shadow?**
Yes, which is why it's graded relative to neighbors and per home. A short building in a dense block casts some shade too. The question is how much shade each home costs.

**How long does the calculation take?**
The full-year calculation for New York runs right in the browser in about a minute, in background threads, so you can keep using the map while it works.

**Why not count shade on rooftops or private yards?**
Rooftops aren't public space, so they're excluded. Open private land like backyards should be too, but the data doesn't separate it out, so right now it counts as public ground. That's listed as a simplification on the site.

**What would you build next?**
Scoring proposed towers before they're approved. That's when the ledger would matter most.
