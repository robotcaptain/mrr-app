# Artist Index Design
_2026-03-07_

## Overview

When the user taps the search bar, a full-screen artist index overlay appears. The user can scroll or type to find an artist, then tap to open the existing ArtistView panel.

## Trigger

Focusing the search bar (tap) opens the overlay immediately. The search bar placeholder changes to "Search artists..." while the overlay is active.

## Overlay

- Full-screen dark panel, same visual style as the existing artist/side panels
- Slides up from below the filter bar
- Scrollable, alphabetically sorted list of all artists
- Each row: artist name (left) + muted episode count `(3)` on the right, omitted if count = 1
- "No artists found" message when filter matches nothing

## Typing

- Typing in the search bar filters the artist list in real time (substring match, case-insensitive)
- Existing episode-list search behavior is unchanged — it only applies when the overlay is dismissed with a query

## Tap an artist

- Dismisses the overlay
- Opens the existing `ArtistView` panel (same as tapping an artist name anywhere in the app)

## Dismiss

- Tap cancel button or outside the overlay
- Overlay slides away, search bar clears and loses focus

## Data

- New `getAllArtists()` function in `db.js`
- Iterates the `artist` index in IndexedDB, counting unique `episodeId` values per artist
- Returns `[{ artist, episodeCount }]` sorted alphabetically
- Built once on first overlay open, cached in memory for the session

## Files Affected

- `js/db.js` — add `getAllArtists()`
- `js/ui/artist-index.js` — new component for the overlay
- `js/app.js` — wire up overlay open/close with search bar focus/blur
- `app.css` — styles for the overlay and artist rows
- `index.html` — add overlay container element
