<?php

/*
 * Data for Obsidian Leaflet maps (https://github.com/javalent/obsidian-leaflet)
 * rendered by perlite.js: resolves the links a ```leaflet block uses, reads the
 * front matter of marker notes, the map's saved markers / overlays / shapes and
 * the marker types from the plugin's data.json, and the Font Awesome icons they
 * need. Read only; only notes Perlite shows and files inside the vault.
 */

use Perlite\PerliteParsedown;

require_once __DIR__ . '/vendor/autoload.php';
include('helper.php');

header('Content-Type: application/json; charset=utf-8');

$request = json_decode(file_get_contents('php://input'), true);
if (!is_array($request)) {
	$request = array();
}

// notes Perlite shows (fills $avFiles, respects HIDE_FOLDERS)
menu($rootDir);

$note = is_string($request['note'] ?? null) ? $request['note'] : '';
if (!in_array($note, $avFiles, true)) {
	$note = '';
}
$noteDir = ($note !== '' && strrpos($note, '/') !== false) ? substr($note, 0, strrpos($note, '/')) : '';

echo json_encode(leafletData($request, $note, $noteDir), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);


function leafletData(array $request, string $note, string $noteDir)
{
	$settings = leafletPluginData();

	// marker types: plugin settings + markers.json next to the note
	$localTypes = array();
	if ($note !== '') {
		$markersJson = vaultReadFile(ltrim($noteDir . '/markers.json', '/'));
		if ($markersJson !== null) {
			$decoded = json_decode($markersJson, true);
			if (is_array($decoded)) {
				$localTypes = array_values(array_filter($decoded, 'is_array'));
			}
		}
	}

	$saved = null;
	$id = $request['id'] ?? null;
	if (is_string($id) || is_int($id)) {
		foreach (($settings['mapMarkers'] ?? array()) as $mapData) {
			if (is_array($mapData) && isset($mapData['id']) && (string) $mapData['id'] === (string) $id) {
				$saved = array(
					'markers' => $mapData['markers'] ?? array(),
					'overlays' => $mapData['overlays'] ?? array(),
					'shapes' => $mapData['shapes'] ?? array(),
					'locked' => $mapData['locked'] ?? false,
				);
				break;
			}
		}
	}

	$keys = array(
		'defaultMarker', 'markerIcons', 'color', 'lat', 'long', 'notePreview', 'layerMarkers',
		'displayMarkerTooltips', 'displayOverlayTooltips', 'defaultUnitType', 'defaultTile',
		'defaultTileDark', 'defaultAttribution', 'defaultTileSubdomains', 'enableDraw'
	);
	$publicSettings = array();
	foreach ($keys as $key) {
		if (array_key_exists($key, $settings)) {
			$publicSettings[$key] = $settings[$key];
		}
	}

	// links used by the block (images, marker links, geojson, coordinates notes)
	$links = array();
	foreach (array_slice(stringList($request['links'] ?? array()), 0, 500) as $link) {
		$links[$link] = resolveVaultLink($link, $noteDir);
	}

	// links of the markers saved on the map (placed in Obsidian)
	foreach (($saved['markers'] ?? array()) as $marker) {
		if (!is_array($marker) || !empty($marker['command']) || !is_string($marker['link'] ?? null) || $marker['link'] === '') {
			continue;
		}
		$link = $marker['link'];
		if (!isset($links[$link]) && !str_starts_with($link, '#') && count($links) < 2000) {
			$target = str_replace('^', '#^', explode('|', $link)[0]);
			$links[$link] = resolveVaultLink($target, $noteDir);
		}
	}

	// notes whose front matter places markers (markerFile, markerFolder,
	// markerTag, coordinates), narrowed by filterTag
	$files = array();
	$wanted = array();
	foreach (array_slice(stringList($request['notes'] ?? array()), 0, 500) as $link) {
		$target = resolveVaultLink($link, $noteDir);
		if ($target['type'] === 'note') {
			$wanted[$target['path']] = $link;
		}
	}
	foreach (array_slice(stringList($request['folders'] ?? array()), 0, 50) as $folder) {
		foreach (notesInFolder($folder, $noteDir) as $path) {
			if (!isset($wanted[$path])) {
				$wanted[$path] = null;
			}
		}
	}
	$markerTag = tagGroups($request['markerTag'] ?? array());
	$filterTag = tagGroups($request['filterTag'] ?? array());
	if ($markerTag || $filterTag) {
		global $avFiles;
		$noteTags = array();
		foreach (array_unique($avFiles) as $path) {
			$noteTags[$path] = noteTags($path);
		}
		foreach ($markerTag as $group) {
			foreach ($noteTags as $path => $tags) {
				if (!array_diff($group, $tags) && !isset($wanted[$path])) {
					$wanted[$path] = null;
				}
			}
		}
		if ($filterTag && $wanted) {
			foreach (array_keys($wanted) as $path) {
				$keep = false;
				foreach ($filterTag as $group) {
					if (!array_diff($group, $noteTags[$path] ?? noteTags($path))) {
						$keep = true;
						break;
					}
				}
				if (!$keep) {
					unset($wanted[$path]);
				}
			}
		}
	}
	foreach (array_slice($wanted, 0, 2000, true) as $path => $requested) {
		$files[] = noteMarkerData($path, $requested, $noteDir);
	}

	// the note named in "coordinates" (its location / zoomTag set the view)
	$coordinates = null;
	if (is_string($request['coordinates'] ?? null) && $request['coordinates'] !== '') {
		$target = resolveVaultLink($request['coordinates'], $noteDir);
		if ($target['type'] === 'note') {
			$coordinates = noteMarkerData($target['path'], $request['coordinates'], $noteDir);
		}
	}

	// geojson files (explicit links and geojsonFolder)
	$geojson = array();
	foreach (array_slice(stringList($request['geojson'] ?? array()), 0, 200) as $link) {
		$target = resolveVaultLink($link, $noteDir);
		if ($target['type'] === 'file' && in_array(strtolower(pathinfo($target['path'], PATHINFO_EXTENSION)), array('json', 'geojson'), true)) {
			$raw = vaultReadFile(ltrim($target['path'], '/'));
			$data = $raw !== null ? json_decode($raw, true) : null;
			if ($data !== null) {
				$geojson[$link] = array('path' => $target['path'], 'data' => $data);
			}
		}
	}
	$geojsonFolders = array();
	foreach (array_slice(stringList($request['geojsonFolders'] ?? array()), 0, 20) as $folder) {
		foreach (filesInFolder($folder, $noteDir, array('json', 'geojson')) as $path) {
			$raw = vaultReadFile(ltrim($path, '/'));
			$data = $raw !== null ? json_decode($raw, true) : null;
			if ($data !== null) {
				$geojsonFolders[] = array('path' => $path, 'data' => $data);
			}
		}
	}

	// Font Awesome icons for the marker types (and the plugin's UI icons)
	$iconNames = array('map-marker', 'info-circle', 'expand', 'compress', 'map-marked-alt', 'bullseye', 'filter', 'layer-group');
	foreach (array_merge(array($publicSettings['defaultMarker'] ?? array()), $publicSettings['markerIcons'] ?? array(), $localTypes) as $type) {
		if (is_array($type) && !empty($type['iconName']) && is_string($type['iconName'])) {
			$iconNames[] = $type['iconName'];
		}
	}
	foreach (($saved['markers'] ?? array()) as $marker) {
		if (is_array($marker) && is_array($marker['type'] ?? null) && is_string($marker['type']['icon'] ?? null)) {
			$iconNames[] = $marker['type']['icon'];
		}
	}
	foreach (stringList($request['icons'] ?? array()) as $name) {
		$iconNames[] = $name;
	}

	return array(
		'settings' => $publicSettings,
		'localTypes' => $localTypes,
		'saved' => $saved,
		'links' => (object) $links,
		'files' => $files,
		'coordinates' => $coordinates,
		'geojson' => (object) $geojson,
		'geojsonFolders' => $geojsonFolders,
		'icons' => (object) faIcons(array_unique($iconNames)),
	);
}


// the Leaflet plugin's settings (<vault>/.obsidian/plugins/obsidian-leaflet-plugin/data.json)
function leafletPluginData()
{
	global $rootDir;
	$file = $rootDir . '/.obsidian/plugins/obsidian-leaflet-plugin/data.json';
	if (!is_file($file)) {
		return array();
	}
	$data = json_decode((string) file_get_contents($file), true);
	return is_array($data) ? $data : array();
}

function stringList($value)
{
	if (!is_array($value)) {
		return array();
	}
	return array_values(array_filter($value, function ($v) {
		return is_string($v) && $v !== '' && strlen($v) < 2000;
	}));
}

function normalizePath(string $path)
{
	$out = array();
	foreach (explode('/', str_replace('\\', '/', $path)) as $seg) {
		if ($seg === '' || $seg === '.') {
			continue;
		}
		if ($seg === '..') {
			array_pop($out);
			continue;
		}
		$out[] = $seg;
	}
	return '/' . implode('/', $out);
}

// all files of the vault ("/Folder/file.png"), without hidden (dot) folders
function vaultFiles()
{
	global $rootDir;
	static $files = null;
	if ($files !== null) {
		return $files;
	}
	$files = array();
	$base = realpath($rootDir);
	if ($base === false) {
		return $files;
	}
	$it = new RecursiveIteratorIterator(
		new RecursiveCallbackFilterIterator(
			new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
			function ($current) {
				return substr($current->getFilename(), 0, 1) !== '.';
			}
		)
	);
	foreach ($it as $file) {
		if ($file->isFile()) {
			$files[] = str_replace('\\', '/', substr($file->getPathname(), strlen($base)));
		}
		if (count($files) > 50000) {
			break;
		}
	}
	return $files;
}

// read a file inside the vault (no hidden folders, no escaping the vault)
function vaultReadFile(string $relative)
{
	global $rootDir;
	$path = normalizePath($relative);
	foreach (explode('/', ltrim($path, '/')) as $seg) {
		if ($seg !== '' && $seg[0] === '.') {
			return null;
		}
	}
	$full = $rootDir . $path;
	if (!is_file($full) || filesize($full) > 20 * 1024 * 1024) {
		return null;
	}
	return file_get_contents($full);
}

function fileURL(string $path)
{
	global $uriPath, $startDir;
	$urlPath = ($startDir !== '' ? $startDir : '') . $path;
	return $uriPath . implode('/', array_map('rawurlencode', explode('/', ltrim($urlPath, '/'))));
}

function noteURL(string $path, string $subpath = '')
{
	global $uriPath;
	$url = $uriPath . PerliteParsedown::slugPath(ltrim($path, '/'));
	if ($subpath !== '') {
		$url .= '#' . str_replace(' ', '-', $subpath);
	}
	return $url;
}

// the note a link points to, like Obsidian: relative to the current note, from
// the vault root, then by name anywhere (shortest path wins)
function findNote(string $file, string $noteDir)
{
	global $avFiles;
	$file = preg_replace('/\.md$/i', '', trim($file));
	if ($file === '') {
		return null;
	}
	foreach (array($noteDir . '/' . $file, '/' . $file) as $candidate) {
		$candidate = normalizePath($candidate);
		if (in_array($candidate, $avFiles, true)) {
			return $candidate;
		}
	}
	$suffix = strtolower('/' . ltrim(normalizePath($file), '/'));
	$best = null;
	foreach ($avFiles as $f) {
		if (substr(strtolower($f), -strlen($suffix)) === $suffix && ($best === null || strlen($f) < strlen($best))) {
			$best = $f;
		}
	}
	return $best;
}

function findFile(string $file, string $noteDir)
{
	$files = vaultFiles();
	foreach (array($noteDir . '/' . $file, '/' . $file) as $candidate) {
		$candidate = normalizePath($candidate);
		if (in_array($candidate, $files, true)) {
			return $candidate;
		}
	}
	$suffix = strtolower('/' . ltrim(normalizePath($file), '/'));
	$best = null;
	foreach ($files as $f) {
		if (substr(strtolower($f), -strlen($suffix)) === $suffix && ($best === null || strlen($f) < strlen($best))) {
			$best = $f;
		}
	}
	return $best;
}

// [[Link#sub|alias]], [alias](Link), Link, https://... -> what it points to
function resolveVaultLink(string $link, string $noteDir)
{
	$raw = trim($link);
	$alias = null;
	if (preg_match('/^!?\[\[(.+?)\]\]$/s', $raw, $m)) {
		$raw = $m[1];
	} else if (preg_match('/^!?\[(.*?)\]\((.+)\)$/s', $raw, $m)) {
		$alias = $m[1] !== '' ? $m[1] : null;
		$raw = $m[2];
	}
	$parts = explode('|', str_replace('\\|', '|', $raw), 2);
	$target = trim($parts[0]);
	if (isset($parts[1]) && trim($parts[1]) !== '') {
		$alias = trim($parts[1]);
	}

	if (preg_match('#^(https?:)?//#i', $target) || str_starts_with($target, 'data:image/')) {
		return array('type' => 'external', 'url' => $target, 'alias' => $alias);
	}
	if (preg_match('#^obsidian://open\?#i', $target)) {
		parse_str(parse_url($target, PHP_URL_QUERY) ?? '', $q);
		$target = is_string($q['file'] ?? null) ? $q['file'] : '';
	}

	$target = rawurldecode($target);
	$subpath = '';
	if (str_contains($target, '#')) {
		[$target, $subpath] = explode('#', $target, 2);
		$subpath = ltrim($subpath, '#');
	}
	$name = basename($target);

	$ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
	if ($target === '') {
		return array('type' => 'missing', 'alias' => $alias);
	}
	if ($ext === '' || $ext === 'md') {
		$note = findNote($target, $noteDir);
		if ($note !== null) {
			return array('type' => 'note', 'path' => $note, 'url' => noteURL($note, $subpath), 'name' => basename($note), 'subpath' => $subpath, 'alias' => $alias);
		}
	}
	$file = findFile($target, $noteDir);
	if ($file !== null) {
		return array('type' => 'file', 'path' => $file, 'url' => fileURL($file), 'name' => pathinfo($file, PATHINFO_FILENAME), 'alias' => $alias);
	}
	return array('type' => 'missing', 'name' => $name, 'alias' => $alias);
}

// a folder parameter -> folder path and depth (like the plugin: "./" is the
// note's folder, each trailing "/" limits the depth)
function folderAndDepth(string $folder, string $noteDir)
{
	$folder = trim($folder);
	if (preg_match('/^\[\[(.+?)\]\]$/', $folder, $m)) {
		$folder = $m[1];
	}
	if ($folder !== '' && $folder[0] === '.') {
		$folder = $noteDir . substr($folder, 1);
	}
	$depth = str_ends_with($folder, '/') ? 2 : PHP_INT_MAX;
	while (str_ends_with($folder, '/')) {
		$folder = substr($folder, 0, -1);
		$depth++;
	}
	return array(normalizePath($folder), $depth);
}

function notesInFolder(string $folder, string $noteDir)
{
	global $avFiles;
	[$path, $depth] = folderAndDepth($folder, $noteDir);
	if (in_array($path, $avFiles, true)) {
		return array($path); // a single note
	}
	$prefix = rtrim($path, '/') . '/';
	$found = array();
	foreach ($avFiles as $f) {
		if (str_starts_with($f, $prefix) || $prefix === '/') {
			$rest = substr($f, strlen($prefix));
			// depth counts the folder itself: 1 = direct children
			if (substr_count($rest, '/') + 1 < $depth) {
				$found[] = $f;
			}
		}
	}
	return array_values(array_unique($found));
}

function filesInFolder(string $folder, string $noteDir, array $extensions)
{
	[$path, $depth] = folderAndDepth($folder, $noteDir);
	$prefix = rtrim($path, '/') . '/';
	$found = array();
	foreach (vaultFiles() as $f) {
		if (!in_array(strtolower(pathinfo($f, PATHINFO_EXTENSION)), $extensions, true)) {
			continue;
		}
		if ($f === $path || str_starts_with($f, $prefix) || $prefix === '/') {
			$rest = substr($f, strlen($prefix));
			if (substr_count($rest, '/') + 1 < $depth) {
				$found[] = $f;
			}
		}
	}
	return $found;
}

// front matter (raw YAML, parsed in the browser like the block) and tags of a note
function noteMarkerData(string $path, $requested, string $noteDir)
{
	global $rootDir;
	$content = '';
	if (is_file($rootDir . $path . '.md')) {
		$content = (string) file_get_contents($rootDir . $path . '.md');
	}
	$frontmatter = '';
	$body = $content;
	if (preg_match('/^---\s*\R(.*?)\R---\s*(\R|$)/s', $content, $m)) {
		$frontmatter = $m[1];
		$body = substr($content, strlen($m[0]));
	}
	// inline #tags of the text (front matter tags are read in the browser)
	$body = preg_replace('/^(```|~~~).*?^\1/ms', '', $body);
	preg_match_all('/(?<=^|\s)#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/u', $body, $tags);

	return array(
		'path' => $path,
		'requested' => $requested,
		'name' => basename($path),
		'url' => noteURL($path),
		'frontmatter' => $frontmatter,
		'tags' => array_values(array_unique($tags[1])),
	);
}

// markerTag / filterTag: [["a", "b"], ["c"]] -> lower case tags without "#"
function tagGroups($value)
{
	$groups = array();
	if (!is_array($value)) {
		return $groups;
	}
	foreach ($value as $group) {
		$group = is_array($group) ? $group : array($group);
		$tags = array();
		foreach ($group as $tag) {
			if (is_string($tag) && trim($tag) !== '') {
				$tags[] = mb_strtolower(ltrim(trim($tag), '#'));
			}
		}
		if ($tags) {
			$groups[] = $tags;
		}
	}
	return $groups;
}

// tags of a note (front matter and text), lower case without "#"
function noteTags(string $path)
{
	global $rootDir;
	$content = is_file($rootDir . $path . '.md') ? (string) file_get_contents($rootDir . $path . '.md') : '';
	$tags = array();
	$body = $content;
	if (preg_match('/^---\s*\R(.*?)\R---\s*(\R|$)/s', $content, $m)) {
		$body = substr($content, strlen($m[0]));
		$lines = preg_split('/\R/', $m[1]);
		foreach ($lines as $i => $line) {
			if (!preg_match('/^tags?\s*:\s*(.*)$/i', $line, $t)) {
				continue;
			}
			$value = trim($t[1]);
			if ($value === '') {
				for ($j = $i + 1; $j < count($lines) && preg_match('/^\s*-\s*(.+)$/', $lines[$j], $item); $j++) {
					$tags[] = trim($item[1], " \t'\"");
				}
			} else {
				foreach (preg_split('/[\s,]+/', trim($value, '[]')) as $tag) {
					$tags[] = trim($tag, " \t'\"");
				}
			}
		}
	}
	$body = preg_replace('/^(```|~~~).*?^\1/ms', '', $body);
	preg_match_all('/(?<=^|\s)#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/u', $body, $inline);
	$tags = array_merge($tags, $inline[1]);
	return array_values(array_unique(array_filter(array_map(function ($t) {
		return mb_strtolower(ltrim($t, '#'));
	}, $tags), 'strlen')));
}

// Font Awesome 5 solid icon data [width, height, path] (same icon set as the plugin)
function faIcons(array $names)
{
	static $all = null;
	if ($all === null) {
		$all = json_decode((string) @file_get_contents(__DIR__ . '/.src/fa-solid-icons.json'), true) ?: array();
	}
	$out = array();
	foreach ($names as $name) {
		if (is_string($name) && isset($all[$name])) {
			$out[$name] = $all[$name];
		}
	}
	return $out;
}
