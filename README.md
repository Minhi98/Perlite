> [!NOTE]
> **Fork notes:** this is a fork of [secure-77/Perlite](https://github.com/secure-77/Perlite), based on v1.6.1 (`2869faa`).
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
- **Task lists:**
  - Rendered as Obsidian's `<ul class="contains-task-list"><li class="task-list-item" data-task="…">`.
  - Any checkbox character works (alternate checkboxes: `[?]`, `[!]`, `[-]`, `[/]` …).
  - A task item no longer wipes out the rest of its list (this broke kanban and checks callouts).
- **Footnotes:**
  - `text[^1]` references and `[^1]: …` definitions are supported, with a numbered list at the end of the page and return links.
  - Named footnotes and indented continuation lines work.
- **Note embeds:**
  - `![[Note]]`, `![[Note#Heading]]` and `![[Note#^block]]` are embedded in Obsidian's embed structure, so ITS Embed Adjustments work (`clean`, `no-title`, `nlk` …).
  - Notes are found the way Obsidian finds them, and only notes Perlite already serves can be embedded, so hidden folders stay hidden.
  - Nested embeds are limited to prevent loops.
  - Only works when the embed is on a line of its own.
- **Block IDs:** `^block-id` markers are hidden from the page.
- **cssclasses:** `cssclasses` / `cssclass` in frontmatter is passed to the frontend.
- **Empty tags:** empty non-void elements are output as `<div></div>` instead of `<div />`. Before, a title-only callout swallowed the rest of the page.

### Frontend (`perlite.js`)
- **Heading IDs:** a heading whose generated ID clashes with an existing one gets an `h-` prefix. Before, a `# Settings` heading took over `#settings` and broke the settings cogwheel.
- **cssclasses:** applied to the page container on each page load and removed on the next one.
- **Callout folding:**
  - Clicking anywhere on the title bar toggles the callout, not just the arrow.
  - Only that callout toggles, not the callouts nested inside it.
  - Links in the title still work.
- **Image preview:** large images are scaled to fit the screen's width and height, the preview box shrinks around the image, and it refits when the window is resized.

### Styles (`perlite.css`)
- **Collapsed callouts:** always hidden, even when the theme sets a `display` on callout content (ITS columns and cards).
- **Callout titles:** removed the `.callout-title-inner * { display: inline !important }` rule, which blocked theme subtitle layouts.
- **Title-only callouts:** don't show an empty content box.
- **Image preview:** styles for the fit-to-screen preview.
- **External Link Icon Removal (Images Only):** Removed external-link icons from image links like `[![[_imgs/the_city/the_city_pretty.webp|sban hsmall]]](The%20City/index.md)`

### Site setup (`helper.php`)
- **CSS snippets:** the snippets enabled in the vault (`.obsidian/appearance.json` → `enabledCssSnippets`) are loaded from `.obsidian/snippets/`, after the theme.
- **`SITE_URL` is optional:** when both `SITE_URL` and `SITE_HOMEPAGE` are empty, the homepage icon and the `og:url` tag are left out, instead of falling back to the Perlite demo site.

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


## Install
Please make sure you read the [required settings](https://github.com/secure-77/Perlite/wiki/03---Perlite-Settings#required-settings) first!

You can download the latest release from github or git clone the project and use docker.

- For non Docker please check [Setup](https://github.com/secure-77/Perlite/wiki/01---Setup-(no-Docker))
- For Docker, please check [Docker Setup](https://github.com/secure-77/Perlite/wiki/02---Setup-Docker)


## Wiki
Please check the [wiki](https://github.com/secure-77/Perlite/wiki), here you will find further information, for example:

- [Themes](https://github.com/secure-77/Perlite/wiki/Themes)
- [Graph Setup and Settings](https://github.com/secure-77/Perlite/wiki/Graph)
- [Perlite Settings](https://github.com/secure-77/Perlite/wiki/03---Perlite-Settings)
- [Troubleshooting](https://github.com/secure-77/Perlite/wiki/Troubleshooting)


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
