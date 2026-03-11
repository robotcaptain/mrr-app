# Responsive Layout Design

## Overview

Redesign MRR Radio PWA to work on both desktop and mobile with feature parity. The app uses a two-column mental model — left column for lists/search, right column for episode details — that adapts to screen size. A player drawer (separate from both columns) handles active playback.

## Breakpoint

- **Desktop**: >= 768px — two-column side-by-side layout
- **Mobile**: < 768px — single-column stacked layout with navigation stack

## Two-Column Model

### Left Column (Lists & Search)
Always contains episode lists or search results:
- Main episode list (default/home)
- Filtered episode list (by host, year, text search)
- Artist index (alphabetical artist list, overlays episode list)
- Artist view (episodes by a specific artist, overlays episode list)

### Right Column (Episode Detail)
Always shows a single episode's details:
- Artwork, caption, host, date
- "Play Episode" button
- Full tracklist with clickable artist names
- Empty state when nothing is selected ("Select an episode to view its tracklist")

### Player Drawer (Overlay)
Exclusively for the currently playing episode:
- Mini player bar fixed at bottom (visible when something is playing)
- Tap mini player → drawer slides up with full player controls + playing episode details + tracklist
- Swipe/click down to dismiss back to mini player
- On desktop, drawer overlays the right column only
- On mobile, drawer overlays the full screen

## Interaction Model

### Browse vs Play (key change from current)
Tapping an episode card **no longer auto-plays**. Instead:
1. Tap episode card → right column shows episode detail (browse mode)
2. Tap "Play Episode" button → playback starts, mini player appears
3. Continue browsing other episodes — mini player persists
4. Tap mini player → player drawer slides up showing the playing episode

### Artist Flow
1. Tap artist name (in tracklist or episode detail) → left column shows artist's episodes
2. Tap an episode from artist results → right column shows that episode's detail
3. Back button returns to artist episode list

## Desktop Layout (>= 768px)

```
+-----------------------------+--------------------------------------------+
|  MRR RADIO                  |                  Updated Mar 11  (sync)    |
+-----------------------------+--------------------------------------------+
|  [Search artists...]        |                                            |
|  [All Hosts v] [All Years v]|  (episode detail or empty state)           |
|-----------------------------|                                            |
|                             |  +------+  #1973 · Feb 18, 2026           |
|  #1975 · Mar 4   Erika E.  |  |thumb |  Rob                            |
|  #1974 · Feb 25  Jennifer   |  |      |  "Rob plays the best..."       |
| >#1973 · Feb 18  Rob        |  +------+                                 |
|  #1972 · Feb 11  Michael    |           > Play Episode                  |
|  ...                        |                                            |
|                             |  TRACKLIST                                 |
|  (scrolls independently)    |  1. PHYSIQUE - Punk Life                  |
|                             |  2. TORSO - No Sanctuary                  |
|                             |  ...                                       |
|                             |  (scrolls independently)                   |
+-----------------------------+--------------------------------------------+
|                             | [mini player: #1975 Erika E. >  12:34]    |
+-----------------------------+--------------------------------------------+
```

- Left panel: ~350px fixed width
- Right panel: fills remaining space
- Header spans full width
- Filters live at top of left panel
- Both panels scroll independently
- Mini player pinned to bottom of right panel area
- Artist index/artist view overlay the left panel, not the right

### Desktop Player Drawer
Slides up from mini player, overlays the right column only. Left panel remains visible and interactive.

## Mobile Layout (< 768px)

Single column with a navigation stack. "Left column" and "right column" content occupy the same screen space, with the right column pushing on top.

### Navigation Stack
- **Root**: Episode list (home)
- **Level 1+**: Episode detail, artist view, etc. stack on top
- Each screen has a back button; 2+ levels deep shows back + home

### Header States
```
Root:              MRR RADIO                         (sync)
One level deep:    <-  #1973 · Rob
Two+ levels deep:  <- (home)  ERIKA ELIZABETH
```

### Screens
1. **Episode list** — full screen, scrollable cards with filters at top
2. **Episode detail** — full screen, artwork + caption + play button + tracklist, back button
3. **Artist view** — full screen, list of episodes by artist, back button
4. **Artist index** — overlays episode list (same as current behavior)

### Mobile Player Drawer
- Mini player: fixed bar at bottom of screen (above safe area)
- Tap → drawer slides up full screen with player controls
- Swipe down to dismiss

## Component Map

| Component | Desktop | Mobile |
|-----------|---------|--------|
| EpisodeList | Left panel (always visible) | Full screen (root) |
| EpisodeDetail | Right panel | Full screen (pushed) |
| ArtistIndex | Overlays left panel | Overlays episode list |
| ArtistView | Overlays left panel | Full screen (pushed) |
| MiniPlayer | Bottom of right panel area | Bottom of screen |
| PlayerDrawer | Overlays right panel | Overlays full screen |
| NavStack | Not needed (left panel replaces in-place) | Manages back/home navigation |

## State

### Navigation State (mobile only)
```
navStack: [
  { type: 'episode-list' },                    // root, always present
  { type: 'artist-view', artist: 'ROB' },      // pushed
  { type: 'episode-detail', episodeId: 1973 },  // pushed
]
```
- Back: pop last entry
- Home: reset to just root entry

### App State (shared)
```
selectedEpisodeId: number | null   // what's shown in right column / detail view
playingEpisodeId: number | null    // what's in the player
drawerOpen: boolean                // player drawer expanded
```

## CSS Strategy

Use CSS-only layout switching where possible:
- Media query at 768px toggles between side-by-side and stacked
- Same HTML structure, different CSS layout
- Desktop: CSS grid with two columns
- Mobile: single column, nav stack manages visibility via classes

## Migration from Current

### What Changes
- Episode card tap: browse instead of auto-play
- Player sheet: becomes the player drawer (same component, renamed mental model)
- Add episode detail view (new component, or expand player-ui to handle non-playing episodes)
- Add navigation stack for mobile
- Add two-column grid for desktop
- Mini player positioning: right-column-bottom on desktop, screen-bottom on mobile

### What Stays the Same
- Episode card component (buildCard)
- Filter/search UI
- Artist index overlay
- Audio engine (player.js)
- Data layer (db.js, data-loader.js)
- Service worker
