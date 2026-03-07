#!/usr/bin/env python3
"""
find-onsets.py

Two-pass track boundary detection using librosa.

Show structure (confirmed):
  [Opener song] → [Talk] → [Music set] → [Talk] → [Music set] → ... → [Talk] → [Closer song]

Pass 1 – Talk detection:
  Sliding-minimum RMS with adaptive threshold. Talk segments = regions that stay
  well below the music median for at least TALK_MIN_SECS seconds.
  Each gap between talk segments is a music section.

Pass 2 – Within-section onset detection:
  For each middle audio section, detect track boundaries using librosa spectral
  flux with MIN_TRACK_SECS minimum gap. Section starts are always included as
  track starts (they're definitive boundaries after talk).

Track assignment:
  Track 0  → audio section 1 (opener, startTime = 0)
  Track N-1 → audio section -1 (closer, startTime = section start)
  Tracks 1..N-2 → all detected starts in middle sections, assigned in order

Usage:
  python3 scripts/find-onsets.py 1975
  python3 scripts/find-onsets.py 1975 --dry-run
  python3 scripts/find-onsets.py 1975 --verbose
"""

import sys, json, os, warnings
import numpy as np
warnings.filterwarnings('ignore')
import librosa

ROOT      = os.path.join(os.path.dirname(__file__), '..')
DATA_FILE = os.path.join(ROOT, 'public', 'data', 'episodes.json')
AUDIO_DIR = os.path.join(ROOT, 'public', 'audio')

# ── Tuning ─────────────────────────────────────────────────────────────────────
ANALYSIS_SR         = 8000   # downsample for fast loading (Hz)

# Pass 1 – talk segment detection
TALK_WIN_SECS       = 0.5    # short RMS frame (fine resolution)
TALK_HOP_SECS       = 0.25   # 0.25s hop
TALK_SMOOTH_SECS    = 5.0    # sliding-minimum window: need 5s of sustained quiet
TALK_DB_BELOW_MUSIC = 6      # threshold: this many dB below music median
TALK_MIN_SECS       = 30     # discard low-energy regions shorter than this
TALK_MERGE_SECS     = 10     # merge talk segments within this gap

# Pass 2 – within-section boundary detection (RMS valley method)
# Assumes equal track distribution across sections unless TRACKS_PER_SECTION is set.
# The valley method finds the deepest energy dip in each expected inter-track window.
TRACKS_PER_SECTION  = 4      # tracks per middle section (16 middle tracks / 4 sections)
VALLEY_SMOOTH_SECS  = 3.0    # smooth RMS over this window before finding valley
VALLEY_SEARCH_PCT   = 0.40   # search ±this fraction of track window around expected boundary
# ──────────────────────────────────────────────────────────────────────────────


def detect_talk_segments(rms_db, times):
    """
    Find sustained low-energy regions (DJ talking between sets).
    Uses a sliding minimum to suppress brief loud transients within talk.
    Returns: (segments, threshold_db, music_median_db)
    """
    music_half   = rms_db[rms_db > np.percentile(rms_db, 50)]
    music_median = float(np.median(music_half))
    threshold_db = music_median - TALK_DB_BELOW_MUSIC

    hop_secs      = float(times[1] - times[0]) if len(times) > 1 else TALK_HOP_SECS
    smooth_frames = max(1, int(TALK_SMOOTH_SECS / hop_secs))
    smoothed      = np.array([
        np.min(rms_db[max(0, i - smooth_frames // 2): i + smooth_frames // 2 + 1])
        for i in range(len(rms_db))
    ])

    below = smoothed < threshold_db
    segments = []
    start = None
    for i, is_low in enumerate(below):
        if is_low and start is None:
            start = float(times[i])
        elif not is_low and start is not None:
            dur = float(times[i]) - start
            if dur >= TALK_MIN_SECS:
                segments.append((start, float(times[i])))
            start = None
    if start is not None and float(times[-1]) - start >= TALK_MIN_SECS:
        segments.append((start, float(times[-1])))

    # Merge nearby
    merged = []
    for seg in segments:
        if merged and seg[0] - merged[-1][1] < TALK_MERGE_SECS:
            merged[-1] = (merged[-1][0], seg[1])
        else:
            merged.append(list(seg))

    return [(s, e) for s, e in merged], threshold_db, music_median


def talk_to_sections(talk_segs, duration_secs):
    """
    Convert talk-segment list into music section (start, end) pairs.
    Each section is the audio between talk segments.
    """
    boundaries = [0.0]
    for ts, te in talk_segs:
        boundaries.append(ts)
        boundaries.append(te)
    boundaries.append(duration_secs)

    sections = []
    for i in range(0, len(boundaries) - 1, 2):
        sections.append((boundaries[i], boundaries[i + 1]))
    return sections


def detect_section_onsets(y, sr, sec_start, sec_end, n_tracks, verbose=False):
    """
    Find n_tracks-1 track boundaries within [sec_start, sec_end] using RMS
    valley detection. Assumes roughly equal-length tracks; searches for the
    deepest energy dip in a window centred on each expected boundary.

    This is more reliable than spectral onset detection for back-to-back punk
    tracks: any brief gap between songs (even 0.2s) shows up as a valley.
    """
    s0  = int(sec_start * sr)
    s1  = int(sec_end   * sr)
    seg = y[s0:s1]
    dur = sec_end - sec_start

    if n_tracks <= 1 or dur < 30:
        return []

    hop          = 256                         # ~32ms at 8kHz
    frame_length = 512
    rms   = librosa.feature.rms(y=seg, frame_length=frame_length, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)

    # Smooth to suppress within-song transients (VALLEY_SMOOTH_SECS window)
    smooth_frames = max(1, int(VALLEY_SMOOTH_SECS * sr / hop))
    smoothed      = np.convolve(rms, np.ones(smooth_frames) / smooth_frames, mode='same')

    n_boundaries = n_tracks - 1
    track_window = dur / n_tracks   # expected duration per track

    boundaries = []
    for b in range(n_boundaries):
        expected   = (b + 1) * track_window
        search_lo  = max(10, expected - VALLEY_SEARCH_PCT * track_window)
        search_hi  = min(dur - 10, expected + VALLEY_SEARCH_PCT * track_window)

        mask = (times >= search_lo) & (times < search_hi)
        if not mask.any():
            if verbose:
                print(f'    boundary {b+1}: no frames in search window [{fmt_time(sec_start+search_lo)}–{fmt_time(sec_start+search_hi)}]')
            continue

        min_idx   = int(np.argmin(smoothed[mask]))
        abs_idx   = int(np.where(mask)[0][min_idx])
        found_t   = float(times[abs_idx])
        valley_db = float(librosa.amplitude_to_db(np.array([smoothed[abs_idx]]), ref=np.max(smoothed))[0])

        if verbose:
            print(f'    boundary {b+1}: expected {fmt_time(sec_start+expected)}, '
                  f'valley at {fmt_time(sec_start+found_t)} ({valley_db:.1f} dB)')

        boundaries.append(sec_start + found_t)

    return boundaries


def fmt_time(secs):
    if secs is None:
        return '—'
    secs = int(round(secs))
    h = secs // 3600
    m = (secs % 3600) // 60
    s = secs % 60
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def main():
    args    = sys.argv[1:]
    ep_arg  = next((a for a in args if a.isdigit()), None)
    dry_run = '--dry-run' in args
    verbose = '--verbose' in args

    if not ep_arg:
        print('Usage: python3 scripts/find-onsets.py <episodeId> [--dry-run] [--verbose]',
              file=sys.stderr)
        sys.exit(1)

    ep_id = int(ep_arg)
    with open(DATA_FILE) as f:
        data = json.load(f)

    episode = next((e for e in data['episodes'] if e['id'] == ep_id), None)
    if not episode:
        print(f'Episode {ep_id} not found', file=sys.stderr)
        sys.exit(1)

    mp3 = os.path.join(AUDIO_DIR, f'mrr-radio-{ep_id}.mp3')
    if not os.path.exists(mp3):
        print(f'MP3 not found: {mp3}', file=sys.stderr)
        sys.exit(1)

    tracks      = sorted(episode.get('tracks', []), key=lambda t: t['trackIndex'])
    duration    = episode.get('durationSecs', 0)
    track_count = len(tracks)

    print(f'\nEpisode #{ep_id}: {track_count} tracks, {fmt_time(duration)} total')
    print(f'Loading audio at {ANALYSIS_SR} Hz...')
    y, sr = librosa.load(mp3, sr=ANALYSIS_SR, mono=True)
    print(f'Loaded {len(y)/sr:.0f}s\n')

    # ── Pass 1: Talk detection ─────────────────────────────────────────────────
    print('── Pass 1: Talk detection ───────────────────────────────────────────────')
    win      = int(TALK_WIN_SECS * sr)
    hop      = int(TALK_HOP_SECS * sr)
    rms      = librosa.feature.rms(y=y, frame_length=win, hop_length=hop)[0]
    rms_db   = librosa.amplitude_to_db(rms, ref=np.max)
    rms_t    = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)

    talk_segs, threshold_db, music_median = detect_talk_segments(rms_db, rms_t)
    audio_sections = talk_to_sections(talk_segs, duration)

    print(f'  Music baseline: {music_median:.1f} dB  |  talk threshold: {threshold_db:.1f} dB')
    print(f'  {len(talk_segs)} talk segment(s):')
    for ts, te in talk_segs:
        print(f'    {fmt_time(ts)} – {fmt_time(te)}  ({te - ts:.0f}s)')
    print(f'  → {len(audio_sections)} music section(s):')
    for i, (ss, se) in enumerate(audio_sections):
        print(f'    [{i+1}] {fmt_time(ss)} – {fmt_time(se)}  ({se - ss:.0f}s)')

    # Validate: expect at least opener + closer + 1 middle section
    if len(audio_sections) < 3:
        print('\n⚠  Too few sections detected. Adjust TALK_DB_BELOW_MUSIC and re-run.')
        sys.exit(1)

    opener_section = audio_sections[0]
    closer_section = audio_sections[-1]
    middle_sections = audio_sections[1:-1]

    # ── Pass 2: Within-section onset detection ────────────────────────────────
    print('\n── Pass 2: Within-section onset detection ───────────────────────────────')

    # Collect all middle track starts: each section start + within-section valleys
    all_middle_starts = []
    for i, (sec_start, sec_end) in enumerate(middle_sections):
        all_middle_starts.append(sec_start)  # section start = definite track start
        valleys = detect_section_onsets(y, sr, sec_start, sec_end,
                                        n_tracks=TRACKS_PER_SECTION, verbose=verbose)
        dur_str = fmt_time(sec_end - sec_start)
        print(f'  Section {i+2}: {fmt_time(sec_start)}–{fmt_time(sec_end)} ({dur_str})'
              f'  →  {len(valleys)} valley(s): '
              + (', '.join(fmt_time(v) for v in valleys) or 'none'))
        all_middle_starts.extend(valleys)

    all_middle_starts.sort()

    # ── Assign start times ────────────────────────────────────────────────────
    start_times   = {}
    start_methods = {}

    # Track 0: opener
    start_times[0]   = 0.0
    start_methods[0] = 'manual'

    # Track N-1: closer
    closer_idx = track_count - 1
    start_times[closer_idx]   = closer_section[0]
    start_methods[closer_idx] = 'talk-boundary'

    # Middle tracks: assign detected starts in order
    middle_tracks = [t for t in tracks if 0 < t['trackIndex'] < closer_idx]
    n_need  = len(middle_tracks)
    n_found = len(all_middle_starts)

    if n_found != n_need:
        print(f'\n  ⚠  Found {n_found} start times for {n_need} middle tracks.')
        if n_found < n_need:
            print(f'     Lower MIN_TRACK_SECS (currently {MIN_TRACK_SECS}s) or ONSET_DELTA and re-run.')
        else:
            print(f'     Raise MIN_TRACK_SECS (currently {MIN_TRACK_SECS}s) and re-run.')

    for i, track in enumerate(middle_tracks):
        if i < n_found:
            start_times[track['trackIndex']]   = all_middle_starts[i]
            start_methods[track['trackIndex']] = 'talk-boundary' if all_middle_starts[i] in [s for s, _ in middle_sections] else 'onset-librosa'
        else:
            start_times[track['trackIndex']]   = None
            start_methods[track['trackIndex']] = 'onset-librosa'

    # ── Compute durations and write fields back ───────────────────────────────
    for i, track in enumerate(tracks):
        idx   = track['trackIndex']
        start = start_times.get(idx)
        meth  = start_methods.get(idx, '?')

        next_start = None
        for j in range(idx + 1, track_count):
            ns = start_times.get(j)
            if ns is not None:
                next_start = ns
                break
        dur = None
        if start is not None:
            dur = (next_start - start) if next_start is not None else (duration - start)

        if idx == 0:
            conf = None
        elif meth == 'talk-boundary':
            conf = 0.90
        else:
            conf = 0.65
        if dur is not None and dur < 60 and conf:
            conf = min(conf, 0.40)

        if start is not None:
            track['startTime']       = round(start, 1)
            track['startTimeMethod'] = meth
            if conf is not None:
                track['startTimeConfidence'] = conf
            elif 'startTimeConfidence' in track:
                del track['startTimeConfidence']
        else:
            track.pop('startTime', None)
            track.pop('startTimeConfidence', None)
            track['startTimeMethod'] = meth
        track['durationSecs'] = round(dur, 1) if dur is not None else None

    # ── Results table (tracks interleaved with DJ segments) ───────────────────
    print('\n── Results ──────────────────────────────────────────────────────────────')
    print(f'  {"":52}  {"Start":>7}  {"End":>7}  {"Dur":>6}  Note')
    print('  ' + '─' * 85)

    # Build a flat timeline: tracks + DJ segments, sorted by start time
    timeline = []
    for track in tracks:
        s = track.get('startTime')
        d = track.get('durationSecs')
        e = (s + d) if (s is not None and d is not None) else None
        meth = track.get('startTimeMethod', '?')
        conf = track.get('startTimeConfidence')
        flag = ' ⚠' if (d is not None and d < 60) else ''
        conf_tag = f'conf={conf:.2f}' if conf is not None else 'fixed'
        timeline.append(('track', s, e, track, f'{conf_tag}{flag}'))
    for ts, te in talk_segs:
        timeline.append(('dj', ts, te, None, f'{te-ts:.0f}s'))

    timeline.sort(key=lambda x: (x[1] is None, x[1] or 0))

    for kind, start, end, track, note in timeline:
        start_str = fmt_time(start)
        end_str   = fmt_time(end)
        dur_secs  = (end - start) if (start is not None and end is not None) else None
        dur_str   = fmt_time(dur_secs)
        if kind == 'dj':
            label = f'  {"── DJ ──":<52}'
            print(f'{label}  {start_str:>7}  {end_str:>7}  {dur_str:>6}  {note}')
        else:
            idx   = track['trackIndex']
            name  = f'#{idx:<2} {track["artist"]} – {track["title"]}'
            print(f'  {name[:52]:<52}  {start_str:>7}  {end_str:>7}  {dur_str:>6}  {note}')

    sum_dur = sum(t.get('durationSecs') or 0 for t in tracks)
    diff    = abs(sum_dur - duration)
    ok      = '✓ OK' if diff < 10 else f'⚠ off by {diff:.0f}s'
    print(f'\n  Music sum: {fmt_time(sum_dur)} / {fmt_time(duration)} episode ({ok})')

    short = [t for t in tracks if t.get('durationSecs') and t['durationSecs'] < 60]
    if short:
        print(f'  ⚠  Under 1 minute — verify by ear:')
        for t in short:
            print(f'     #{t["trackIndex"]} {t["artist"]} ({fmt_time(t.get("durationSecs"))})')

    print()
    if not dry_run:
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        print('Written to episodes.json.')
    else:
        print('--dry-run: episodes.json not modified.')
    print()


if __name__ == '__main__':
    main()
