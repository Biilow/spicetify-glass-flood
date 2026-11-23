# Flood

A Spicetify theme that takes its colour from whatever you're playing.

![Flood](preview.png)

- The playing song's cover, blurred, sits behind the whole app and fades when the song changes.
- The sidebar, main view, right panel and player bar are clear glass over it.
- Playlist, album, artist and Liked Songs pages fill with their own colour from top to bottom, fading into the song backdrop.
- Play buttons and highlights take the cover's accent colour.
- Right-click menus are frosted glass.

## It stays smooth

Most glass themes lag because every panel blurs whatever is behind it on every frame. Flood doesn't do that:

- The cover is blurred once per song into a 96px canvas and stretched. The panels are plain see-through colour, which costs nothing to draw.
- The only live blur is on right-click menus, which are small and only exist while open.
- The script runs when the song or the page changes. Nothing runs while you scroll, hover or drag.

On a 317-song playlist at 120 Hz, scroll frame times and hover response measured the same with Flood as with a plain theme.

## Install

**Marketplace:** search for Flood in the Themes tab and install it.

**Manually (macOS / Linux):**

```bash
git clone https://github.com/Biilow/spicetify-flood.git
cd spicetify-flood
./install.sh
```

**Manually (Windows):** copy `user.css`, `color.ini` and `theme.js` into a folder named `Flood` inside `%appdata%\spicetify\Themes`, then run:

```powershell
spicetify config current_theme Flood color_scheme Flood inject_css 1 replace_colors 1 inject_theme_js 1
spicetify apply
```

## Compatibility

Tested on Spotify 1.3.10 with Spicetify 2.46.7, alongside the Spicy Lyrics extension. It hooks onto Spotify's ids, test ids and readable class names rather than the hashed ones, so it should survive most Spotify updates. If something looks wrong after an update, open an issue with a screenshot.

## Uninstall

Pick another theme in Marketplace, or run:

```bash
spicetify config current_theme "" color_scheme ""
spicetify apply
```

## License

MIT
