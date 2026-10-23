> [!NOTE]
> **Fork notes:** this is a fork of [secure-77/Perlite](https://github.com/secure-77/Perlite), originally based on v1.6.1 (`2869faa`), last merged with upstream v1.6.3 (`7649301`).
> The changes are for better Obsidian / ITS CSS Snippet compatibility (by SIRvb). The main changes are in `perlite/.src/PerliteParsedown.php`,
> `perlite/.js/perlite.js`, `perlite/.styles/perlite.css` and `perlite/helper.php`.

## Differences from upstream

### Markdown rendering (`PerliteParsedown.php`)
- **Callout options:** `> [!type|options]` now splits into `data-callout="type"` and `data-callout-metadata="options"`, as in Obsidian. This fixes all ITS callout options (cards, infobox, columns, `no-t`, `left`/`right` …), and default titles no longer show the options (e.g. "Cards|3").
- **Callout titles:** rendered inline, without a wrapping `<p>`, so subtitles (`**Title** _Subtitle_`) lay out correctly.
- **Image embeds:** use Obsidian's structure (`<span class="internal-embed image-embed" src alt><img></span>`) instead of a `<p>` nested inside a paragraph. This fixes cards splitting a title and its image into separate cells.
- **Image options:**
  - The text after `|` becomes the alt text, as in Obsidian (`![[img.png|right htiny]]`).
  - `|300` and `|300x200` set the size.
  - Fragment options work (`![[img.png#cap#wtiny|Caption]]`).
  - External images accept a size (`![alt|300](url)`) and an empty URL (`![alt|opts]()`).
- **Task lists:** uses upstream's task lists (since v1.6.4), rendered like Obsidian's reading view (`contains-task-list`, `task-list-item`, `data-task`), with nested tasks and alternate checkboxes (`[?]`, `[!]`, `[-]`, `[/]` …). The fork's own version was removed.
- **Footnotes:** uses upstream's footnote support (since v1.6.3, incl. inline `^[...]` footnotes); the fork adds hover previews (see Frontend) and hides `^block-id` markers.
- **Note embeds:**
  - `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]` are embedded in Obsidian's embed structure, so ITS Embed Adjustments work (`clean`, `no-title`, `nlk` …).
  - Notes are found the way Obsidian finds them, and only notes Perlite already serves can be embedded, so hidden folders stay hidden.
  - Nested embeds are limited to prevent loops.
  - Only works when the embed is on a line of its own.
- **Block IDs:** `^block-id` markers are hidden from the page.
- **cssclasses:** `cssclasses` / `cssclass` in frontmatter is passed to the frontend.
- **Empty tags:** empty non-void elements are output as `<div></div>` instead of `<div />`. Before, a title-only callout swallowed the rest of the page.
- **Link lookup:** a `[[link]]` or Markdown link to a note that doesn't exist relative to the linking note is looked up like Obsidian does: from the vault root, then by name anywhere in the vault (shortest path wins). A `.md` extension in the link is dropped. Links that already worked (relative `../` links, same-folder links) are unchanged. Before, `[[Note]]` or `[[Folder/Note.md]]` from another folder led to a blank page.
- **Wikilinks aren't reference definitions:** a line starting with `[[Note]]: …` (Dataview Serializer's `LIST` rows with a value) is shown as a link and text, like in Obsidian, instead of being read as a hidden Markdown link definition. Before, those rows were empty and later links to the same notes showed their full path in brackets.
- **HTML comments:** hidden like in Obsidian's reading view, also with `HTML_SAFE_MODE=true` (then they're dropped from the page instead of passed through).
- **Markdown links to notes:** `[text](Folder/My%20Note.md)` and `[![[image.png|opts]]](Note.md#Heading)` are internal links, like in Obsidian. They open in the same tab, with hover previews, built the same way as a `[[wikilink]]`. URLs (`https:`, `mailto:` …), `#anchor` links and links to files such as `.pdf` or images are unchanged. Before, these were treated as external links to the raw `.md` file, which Perlite's nginx config blocks.
- **Heading link text:** `[[Page#Heading]]` without an alias shows as "Page > Heading", like Obsidian. Links to a heading on the page being viewed (`[[#Heading]]` or `[[This Page#Heading]]`) show just the heading text and scroll within the page. Same-page links use upstream's `#Heading` URL format.
- **Links in tables:** wikilinks use upstream's fix for the escaped alias pipe (`[[Note\|Alias]]`); the fork applies the same to image and note embeds in tables (`![[image.png\|options]]`), which upstream doesn't handle.
- **Frontmatter:** uses upstream's Properties box, hidden by default; enable it per browser with **Settings → Show Properties**. A `title` property replaces the displayed title (page title, header, browser tab, hover previews, embed heading), e.g. `title: "Vestiges: Hearts Surpassing Heaven"` for characters a file name can't contain. URLs, the file tree, links and the edit link keep the file name.

### Frontend (`perlite.js`)
- **Heading IDs:** a heading whose generated ID clashes with an existing one gets an `h-` prefix. Before, a `# Settings` heading took over `#settings` and broke the settings cogwheel.
- **cssclasses:** applied to the page container on each page load and removed on the next one.
- **Callout folding:**
  - Clicking anywhere on the title bar toggles the callout, not just the arrow.
  - Only that callout toggles, not the callouts nested inside it.
  - Links in the title still work.
- **Image preview:** large images are scaled to fit the screen's width and height, the preview box shrinks around the image, and it refits when the window is resized.
- **Linked images:** clicking an image inside a link follows the link instead of opening the image preview. Images without a link still open the preview.
- **Heading links:** links to a heading (`[[Page#Heading]]`, `[text](Page.md#Heading)`, `[[Page#Chapter#Section]]`, same-page `[[#Heading]]`) scroll to it. Before, the page loaded without scrolling and threw an error. The heading is found by its text (ignoring case, spaces, `-` and `_`), so all of Perlite's link formats work. Perlite scrolls again once images above the heading have loaded.
- **Outline (table of contents):** clicking an outline link, in the sidebar or the mobile pop-up, scrolls to the heading the same way section links do and updates the URL. The mobile pop-up closes after a click. Headings that contain links or formatting are now listed, and headings inside embedded notes are left out, like Obsidian.
- **Footnote previews:** hovering a footnote reference shows the footnote in a popover, whether page previews are on or off. It stays open while the mouse is over it, so links inside work, and closes on scroll or click. Embedded notes show their own footnotes.
- **Linked mentions:** the "Linked mentions" row in the right sidebar is hidden when its count is 0, and resets on every page load so it never shows the previous page's count. The count comes from the graph data (Perlite's own index, or the Metadata Extractor plugin's `metadata.json` if present).
- **Trailing slash:** page URLs ending in `/` (e.g. `/Folder/Note/`) open the page instead of a blank one.
- **Edit in Obsidian:** the edit button sends the note's full path (`file=Folder/Note`), so notes with the same name (e.g. several `index.md`) open the right one.
- **Remembered sidebars:** whether the left and right sidebars are collapsed is saved in the browser (localStorage) and restored on every page load, desktop layout only. A small script in `index.php`'s `<head>` applies it before the page is drawn, so there's no flash.
- **Sidebar tags:** Fixed styling under themes like Elysian and added a setting to toggle showing Tags in the side bar.

- **List markup:** bulleted lists get Obsidian's reading-view markup (`ul.has-list-bullet` and a `span.list-bullet` in each item), so Obsidian's and the theme's bullet styles apply (e.g. Elysian's dashes) instead of the browser's dots.

### Styles (`perlite.css`)
- **Collapsed callouts:** always hidden, even when the theme sets a `display` on callout content (ITS columns and cards).
- **Callout titles:** removed the `.callout-title-inner * { display: inline !important }` rule, which blocked theme subtitle layouts.
- **Title-only callouts:** don't show an empty content box.
- **Image preview:** styles for the fit-to-screen preview.
- **External Link Icon Removal (Images Only):** Removed external-link icons from image links like `[![[_imgs/the_city/the_city_pretty.webp|sban hsmall]]](The%20City/index.md)`
- **Vault box hidden:** the vault name box and the Expand/Collapse all buttons above the file tree are hidden. Perlite serves a single vault, so the vault "switcher" did nothing.
- **Hidden buttons:** the Help button and the note's text-settings cog are hidden. The header's book button, which toggles the left ribbon, is hidden on desktop and kept on phones, where it opens the ribbon.
- **Status bar hidden:** the bottom-right status bar (backlinks, words, characters) is hidden.

### Site setup (`helper.php`)
- **CSS snippets:** the snippets enabled in the vault (`.obsidian/appearance.json` → `enabledCssSnippets`) are loaded from `.obsidian/snippets/`, after the theme.
- **`SITE_URL` is optional:** when both `SITE_URL` and `SITE_HOMEPAGE` are empty, the homepage icon and the `og:url` tag are left out, instead of falling back to the Perlite demo site.

### Page layout (`index.php`)
- **Reading view markup:** the content pane is marked `data-mode="preview"` (reading view) instead of `source`, and the page title sits in `.mod-header.mod-ui`, like Obsidian's reading view. Themes that style the reading-view title now apply (e.g. a title background that fits the text instead of spanning the page).

### Obsidian Leaflet maps (`leaflet.php`, `.js/leaflet/`)
- **```leaflet blocks** from the [Obsidian Leaflet](https://github.com/javalent/obsidian-leaflet) plugin are shown as interactive maps, read only, using the plugin's syntax and coordinates:
  - image maps (several `image:` layers, `bounds`) and real-world maps (`tileServer`, `osmLayer`, `tileOverlay`)
  - zoom options, `height`/`width`, `darkMode`, `recenter`, `noUI`, `noScrollZoom`, `showAllMarkers`, `zoomFeatures`, `coordinates`/`zoomTag`
  - markers placed on the map in Obsidian (read from `.obsidian/plugins/obsidian-leaflet-plugin/data.json`, matched by the map's `id`), with their saved overlays and drawn shapes
  - `marker:` lines, `markerFile`, `markerFolder` and `markerTag`/`filterTag` (front matter `location`, `mapmarker`, `mapmarkers`, `mapoverlay`), `overlay:`, `overlayTag`, `geojson`/`geojsonFolder`, `imageOverlay`
  - marker types and icons from the plugin's settings (and a `markers.json` next to the note), including layered icons and image icons
- Markers show their link and description on hover (the plugin's tooltip setting) and open the linked note or URL on click. With the plugin's "note preview" setting on, hovering a marker also shows Perlite's page preview.
- Controls: zoom, full screen, show all markers, reset zoom, layers, and a filter by marker type.
- Not available: editing (adding, moving or deleting markers, drawing), command markers, GPX files, `linksTo`/`linksFrom` (they need Dataview's index) and the initiative tracker.
- Leaflet 1.9.4, js-yaml and Font Awesome 5 (the plugin's icon set) are included and only loaded on pages with a map.
- `perlite/Dockerfile` copies `leaflet.php` into the image (the upstream Dockerfile copies each PHP file by name).

### Quartz-style graph (`.js/graph/`)
- **Graph view:** the graph of [Quartz](https://github.com/jackyzha0/quartz) (MIT), ported to Perlite: D3 physics with PixiJS (WebGL) drawing. Nodes grow with their number of links, labels fade in as you zoom, hovering highlights a note's connections, tags are ring-shaped nodes, and pages you've visited get their own colour (remembered per browser).
- **Local graph:** in the right sidebar (`SHOW_LOCAL_GRAPH=true`), showing the current note and its direct links; its corner button opens the global graph.
- **Global graph:** all notes, over the page (radial layout, unrelated notes dim on hover). Opened from the graph button in the left ribbon, the local graph's corner button or **Ctrl/Cmd + G**; closed with Escape or a click outside.
- Clicking a note opens it (Ctrl/Cmd-click: new tab); clicking a tag searches for it. Colours come from the theme's graph colours (`--graph-node`, `--graph-node-focused`, `--graph-node-tag`, `--graph-line`, `--graph-text`) and follow light / dark mode.
- **Settings → Quartz Graph** (on by default, remembered per browser): off brings back Perlite's original graph and its graph settings.
- **No plugin needed:** without the Metadata Extractor plugin's `metadata.json`, Perlite builds the graph from the notes itself, like Quartz (`buildVaultGraph()` in `helper.php`): wikilinks, embeds, links in front matter and Markdown links to notes, resolved like Obsidian; tags from front matter and text; code, `%%comments%%` and HTML comments (e.g. Dataview Serializer's query text) left out; hidden folders left out. It's cached in `TEMP_PATH` until a note changes, and the graph follows vault changes while browsing (each page load asks `content.php?graph` whether the data changed; it only resends it when it did). If `metadata.json` exists, it's used as before. D3 7.9 and PixiJS 8.6 are included and only loaded when a graph is shown.

### Dataview (`perlite.js`, `helper.php`)
- **Queries:** use the [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer) plugin in Obsidian. It runs your queries (`LIST`, `TABLE`, `TASK`, inline `=` expressions and DataviewJS) with Dataview and writes the results into the note as Markdown between HTML comments, which Perlite shows like any other content. Serializer's links (shortest name, vault path with `.md`, or Markdown links) resolve to the right notes.
- **Unconverted queries:** ```` ```dataview ```` and ```` ```dataviewjs ```` blocks are hidden, since Perlite can't run them. Convert them with Serializer's "Convert … Dataview queries" commands (DataviewJS by wrapping the code in `<!-- DataviewJSToSerialize: … -->`). Inline `` `=expression` `` queries stay as code until converted.
- **Inline fields:** `[key:: value]` and `(key:: value)` are shown like Dataview's reading view (key and value, or the value only; dates in Dataview's date format), with Dataview's classes so themes style them. A full-line `key:: value` stays as written, like in Obsidian.
- All of this only applies when Dataview is enabled in the vault (`.obsidian/community-plugins.json`); its settings (`prettyRenderInlineFields`, date formats) are read from `.obsidian/plugins/dataview/data.json`.

# Perlite
  
![GitHub release (latest by date)](https://img.shields.io/github/v/release/secure-77/perlite) ![GitHub](https://img.shields.io/github/license/secure-77/perlite) ![GitHub last commit](https://img.shields.io/github/last-commit/secure-77/Perlite)


A web based markdown viewer optimized for [Obsidian](https://obsidian.md/) Notes

Just put your whole Obsidian vault or markdown folder/file structure in your web directory. The page builds itself. 

Its an open source alternative to  [obsidian publish](https://obsidian.md/publish).

Read more about Perlite and staging tips on my blog post: [Perlite on Secure77](https://secure77.de/perlite).
If you want to discuss Perlite you can join the [Perlite Discord Server](https://discord.gg/pkJ347ssWT)


## Demo

[Perlite Demo](https://perlite.secure77.de/)


![Demo Screenshot](https://raw.githubusercontent.com/secure-77/Perlite/main/screenshots/screenshot.png "Demo Screenshot")

![Graph Screenshot](https://raw.githubusercontent.com/secure-77/Perlite/main/screenshots/graph.png "Graph Screenshot")

## Features

- Auto build up, based on your folder (vault) structure
- No Database required
- Obsidian Themes Support
- Fully Responsive
- No manual parsing or converting necessary
- Full interactive Graph
- LaTeX and Mermaid Support
- Link to Obsidian Vault
- Search
- Obsidian tags, links, images and preview Support
- Dark and Light Mode
- Obsidian Canvas support


## Install
Please make sure you read the [required Obsidian settings](perlite/Demo/Documentation/05-Obsidian-Settings.md) first!

You can download the latest release from github or git clone the project and use docker.

- For Docker, please check [Docker Setup](perlite/Demo/Documentation/01-Docker-Setup.md)
- For non Docker please check [Setup without Docker](perlite/Demo/Documentation/02-Setup-without-Docker.md)


## Documentation
Please check the [documentation](perlite/Demo/Documentation/00-Index.md), here you will find further information, for example:

- [.env Settings](perlite/Demo/Documentation/03-Env-Settings.md)
- [Browser Settings](perlite/Demo/Documentation/04-Browser-Settings.md)
- [Graph Setup](perlite/Demo/Documentation/06-Graph.md)
- [Themes](perlite/Demo/Documentation/07-Themes.md)
- [Troubleshooting & FAQ](perlite/Demo/Documentation/08-Troubleshooting-FAQ.md)


## Security
- The [Safemode](https://github.com/erusev/parsedown#security) from Parsedown is active, but I would not recommend to allow untrusted user input.
- You should prevent that the .md files are direct accessible via the browser (only the php engine need access to it) or at least make sure that the md files will be downloaded and not be rendered by browser
- You should prevent that the metadata.json file is direct accessible via the browser (only the php engine need access to it). The extracted metadata.json contains the whole obsidian structure, so this file could be sensitive if you plan to exclude some files or folders from Perlite. However, the parsing is done by the php engine and it checks for every path if the file really exists in the provided vault, so files you excluded from the vault will also not be visible in the graph, but they are still present in the metadata.json. This is why you should prevent access to it.


## Contributing
Want to contribute? Awesome! Please use the [dev branch](https://github.com/secure-77/Perlite/tree/dev) for pull requests.


## Why Perlite?
[Wiki](https://en.wikipedia.org/wiki/Perlite):
*Perlite is an amorphous volcanic glass ... typically formed by the hydration of obsidian.*


## Previous Versions and Changelog

- [Changelog](https://github.com/secure-77/Perlite/blob/main/Changelog.md)
- [Perlite 1.4.4 Demo](https://perlite.secure77.de/1.4.4)
- [Perlite 1.3 Demo](https://perlite.secure77.de/1.3)
