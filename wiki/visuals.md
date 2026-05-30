# Visual Aspect of mimi

This file will explain everything on the visual aspect of the website, excluding gameplay related aspects. This specifically means how each page looks in format, art, and layout. Non-game user interaction is also described in this file.

The website will officially support these dimensions:
- Monitor: 1920 x 1080 px

## Home tab

The home tab is established to provide the end user a welcoming experience and a perfect first impression.

- The background is a blurred gif that shows the gameplay. It should be darkened and established in the background. All objects on this page must sit over this background.
- The header includes the title, which is the name of the website on the top left. Additionally, "Magical Mirai 2026" is stated right below it in smaller font. On the top right, there is a button/switch to change the language from English to Japanese. English should be set by default.
- The body includes the "original layout", which includes three buttons: "Play", "Tutorial", and "Info". "Tutorial" will take the user to the "Tutorial" tab. Both "Play" and "Info" will replace items on this page.
    - "Play" will replace the "original layout" with buttons to each song. Each song button displays the song title prominently with the artist name in smaller text below; the song's BPM is shown as dimmed text to the right of the button. Selecting a song then shows the difficulty selection for that song. Each difficulty is shown as a split button divided by a diagonal separator: the left badge displays the numeric difficulty level in the difficulty's color (easy = green, medium = yellow, hard = red, expert = purple), and the right section displays the difficulty name in the standard button style. The left badge is a fixed width regardless of the level number. Each difficulty button navigates to the song tab with the chosen difficulty. Additionally, there will be a visually different "Back" button that returns the layout back to the "original layout".
    - "Info" will replace the "original layout" with information about the site and the authors. Additionally, there will be a "Back" button that returns the layout back to the "original layout".
    - The "Back" buttons for both the "Play" layout and "Info" layout must be the same in style and placement. 
- The footer includes a clickable image to this repository and a clickable image to Hakyll.

## Song tab

The song tab is a generalized description for each song. The difference between these tabs are specifically to the song link, and this information is provided in `/src/songs/{SONG_NAME}`, where `{SONG_NAME}` is the name of the song.

The objects in the page fits the screen perfectly. Users across all supported dimensions should not have to scroll to view any described element of the page.

- The background is a storyboard animation for the song. The TextAlive API is used to present the lyrics as it chronologically appears in the song. After completing a line, the entire line will disappear and a new line will begin. The storyboard supports highlight (`h`) entries that apply a technicolor glow to the currently active (being sung) character whose timing falls in the highlighted range; manual lyric (`l`) entries display independent text segments at specified positions with per-character timing. The entire storyboard background should be slightly dim and not blurred.
- The immediate top of the page is a slightly opaque but mostly transparent, thin, white bar for the progress of the song. In the beginning, this is 0% and will fill up proportionally as the song progresses, and the filled portion is the same white but significantly more opaque.
- Below the progress bar, on the right side, the language toggle and settings button are available in the same visual style and placement as the home tab. No persistent play/stop button is shown over the chart.
- Below the progress bar, on the left, is a description of the song: the song name, the author's name, and the mapper's name.
- In the center of the screen is the gameplay. There is a faint, slightly more opaque, white outline for where the game will take place. The first click, tap, or keyboard input on the game surface starts playback; if the browser blocks media playback, a minimal centered start prompt remains until the next gesture succeeds. Once started, the game continues until the song is completed, the player chooses Try Again from results, or the player leaves the song page.
    - Relative to the screen size, for tablet and monitor displays, the game sits at an aspect ratio of 4:3 inside the page. There is a small gap between the borders of the game and the top and bottom of the page. For phone displays, the aspect ratio is still 4:3. However, the gap between the borders is miniscule, and the back and fullscreen controls are pushed more towards the center to give the game area more space.
- On the bottom-right of the screen are two items:
    - A fullscreen toggle button (icon-only). In normal state it shows an expand icon (four outward-facing corner brackets); in fullscreen state it shows a compress icon (four inward-facing corner brackets). Hovering over the expand icon animates the corners outward; hovering over the compress icon animates them inward. Clicking toggles the browser fullscreen state.
    - The "Back" button. This button is the same "Back" button as the one described in the "home tab" and will redirect to the "home tab".

## Small Screen Warning (Song Tab)
When the viewport is smaller than 1800 px wide or 990 px tall on a song tab, a full-screen blurred overlay is shown with centered text asking the player to play in fullscreen or increase the window size. The language toggle and the fullscreen and back buttons (bottom-right footer) remain above the overlay and fully usable. The settings button is visually dimmed and non-interactive while the overlay is active.

## Settings / Options Panel
A settings button sits in the top-right header area of both the home and song tabs, next to the language toggle. Clicking it opens a modal overlay with collapsible accordion sections: Mods (Hidden mod toggle), Notes (approach rate slider with animated preview), and Cursor (size slider, HSV color picker, trail shape [Circle/Star/Square], trail decay [Fade/Scatter], trail fade speed slider, and animated cursor preview). All settings persist across sessions. Accordion open/closed states also persist across page navigation.

## Loading Screen (Song Tab)
When a song tab loads, a full-screen overlay is shown with a progress bar while assets load. Once all assets are ready, the screen fades out. If loading takes too long, the screen is dismissed automatically.

## Hit Feedback (Song Tab)
After each note is resolved, a brief label floats up from the note's position and fades out, indicating the judgement result.

## Score Display (Song Tab)
A live score counter is displayed in the top-right of the game area and updates on each hit.

## Combo Display (Song Tab)
A combo counter is displayed in the bottom-left of the game area. It shows the current consecutive hit count with a "COMBO" label beneath it. A brief pop animation plays when the combo increments. Both the score and combo displays are hidden until the song begins playing.

## Results Overlay (Song Tab)
After the song finishes, an overlay appears inside the game area. It shows the player's grade, score, accuracy, and a breakdown by judgement. Three actions are available: share the result, try again, or return to the home tab.

## Custom Cursor (Song Tab)
The default OS cursor is hidden over the game canvas and replaced by a custom shiny orb with a particle trail. The orb always renders above all other game elements. The cursor's size, color, and trail fade speed can be adjusted in the Cursor section of the Options panel.
