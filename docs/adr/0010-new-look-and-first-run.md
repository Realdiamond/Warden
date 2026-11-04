# 0010 — New look, night mode and a first-run setup

Status: accepted (M10)

## Context

A review of every screen of the Android app found three problems. The first impression was weak:
the app opened on all of Lagos, incidents were small hexagons that were hard to see on a busy,
colourful street map, and nothing said what the colours meant or whether it was safe nearby.
Nobody was asked to add trusted contacts until they pressed SOS, and only then learned that
Warden could not alert anyone. And the screens used small grey text and plain outlined boxes,
with no dark mode, which matters for an app opened at night or during an SOS.

The founder approved a mockup (the "Warden App Redesign" canvas) and asked for it to be built.

## Decision

- **One set of colours, by day and by night.** `apps/mobile/src/lib/theme.ts` holds two palettes.
  Green means safe and trusted; red is kept for danger (SOS, 112, emergencies). Severity colours on
  the map (red, amber, blue) also differ in lightness, and every marker carries an icon, so colour
  is never the only clue. A test checks every text colour against its background at 4.5:1 or more
  in both palettes. Night mode follows the phone unless the person picks light or dark in
  Settings. Screens build their styles per palette (`useStyles`), so nothing stays light at night.
- **Atkinson Hyperlegible** (Next, and Mono for numbers, times, phone numbers and PINs), made by
  the Braille Institute to be easy to read for people with low vision. It helps on cheap screens in
  bright sun. The fonts are bundled into the build by the `expo-font` plugin under the SIL Open
  Font License, so text never waits for a download. Android does not pick weights of a custom
  font by itself, so `components/text.tsx` maps each style's weight to the right font file.
- **The map opens where the person is.** If location is already allowed, the app waits up to 1.5
  seconds for a position and opens at street level there; otherwise it opens on the city. It never
  asks for location just to open the map.
- **A "near you" line.** At the top of the map: danger (an emergency still going on within 1 km),
  take care (anything else going on within 1 km) or quiet, with the number of reports in the
  chosen time window. It is worked out on the phone from the incidents the map already loaded, so
  the server learns nothing new. When the person is not on screen or the map is zoomed out, it
  counts the reports in view instead.
- **Markers, counts and groups.** Incidents are drawn as coloured markers with their category icon
  at the public area centre the server already returns, with a report count when more than one
  person reported. Below zoom 12 they group into numbered circles coloured by their most serious
  incident; tapping one zooms in. The shaded areas still show from zoom 12, and labels from 12.5.
  Marker icons are white images rendered from the app's own icon font (MaterialCommunityIcons) at
  1x, 2x and 3x in `assets/map-icons`, listed in `components/mapIcons.ts`; map text uses the map
  style's own font. Nothing more exact than before is shown.
- **Calm maps.** OpenFreeMap's grey "positron" style by day and its "dark" style at night, so
  incident colours stand out. Both can be changed per build.
- **First-run setup.** Seven screens: welcome (with language), what stays private, location,
  trusted contacts, a safety PIN, home, and a short "how SOS works". Every step after the welcome
  can be skipped. Everything is saved through the stores the Safety and Places screens already use,
  so nothing new leaves the phone. Contacts are typed in rather than read from the address book,
  so Warden needs no contacts permission. The setup PIN is four digits on Warden's own keypad,
  entered twice; the duress PIN is offered but optional. People who already have contacts or
  places skip the setup.
- **Plainer words.** Report groups have plainer names in the app ("Theft and burglary" for
  property crime); the shared taxonomy, the console and the data API keep theirs. The group with
  the private categories says on its tile that those reports never appear on the map. The SOS
  screen lists the contacts by name but does not claim a text was delivered or read, because the
  server does not report that.

## Consequences

- The app grows by about 300 KB of fonts and 70 KB of map icons.
- The screens were checked in a phone-sized browser preview of the real code and with an Android
  bundle build, not on a phone. Fonts in sunlight, night mode in the dark and the first-run setup
  with people who have not seen the app still need trying on real low-end phones.
- New text has a draft Pidgin version that needs the same native-speaker check as the rest.
- A category with a new icon needs its marker image added (`assets/map-icons`); until then its
  markers show no icon, but keep their colour and label.
- Builds made before M10 keep the old map style; the change reaches testers with the next APK.
