/*!
 * Perlite: read-only rendering of Obsidian Leaflet maps (```leaflet code blocks)
 * Follows the behaviour of the Obsidian Leaflet plugin by Jeremy Valentine
 * (https://github.com/javalent/obsidian-leaflet, MIT License): block parameters,
 * image / real-world maps, markers (code block, notes, markers saved in the
 * plugin's data.json), marker types and icons, overlays, drawn shapes, GeoJSON.
 * Editing (adding / moving markers, drawing) is not available here.
 */
(function () {
  'use strict';

  var L = window.L;
  var jsyaml = window.jsyaml;
  var FA = window['fontawesome-svg-core'];

  var DEFAULT_TILE_SERVER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
  var DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  var OVERLAY_TAG_REGEX = /^(\d+(?:\.\d+)?)\s?(\w*)/;

  var DEFAULT_BLOCK_PARAMETERS = {
    darkMode: 'false', defaultZoom: 5, distanceMultiplier: 1, drawColor: '#3388ff',
    geojson: [], geojsonColor: '#3388ff', height: '500px', image: 'real', imageOverlay: [],
    layers: [], marker: [], commandMarker: [], markerFile: [], markerFolder: [], markerTag: [],
    filterTag: [], linksTo: [], linksFrom: [], maxZoom: 10, minZoom: 1, osmLayer: true,
    overlay: [], overlayColor: 'blue', scale: 1, showAllMarkers: false, tileServer: [],
    zoomDelta: 1, zoomFeatures: false
  };

  var DEFAULT_SETTINGS = {
    defaultMarker: { type: 'default', iconName: 'map-marker', color: '#dddddd', transform: { size: 6, x: 0, y: -2 } },
    markerIcons: [], color: '#dddddd', lat: 39.983334, long: -82.98333, notePreview: false,
    layerMarkers: true, displayMarkerTooltips: 'hover', displayOverlayTooltips: true,
    defaultUnitType: 'imperial', defaultTile: DEFAULT_TILE_SERVER, defaultTileDark: DEFAULT_TILE_SERVER,
    defaultAttribution: DEFAULT_ATTRIBUTION, defaultTileSubdomains: 'a,b,c,d'
  };

  // length units (meters per unit), like the "convert" package the plugin uses
  var UNITS = {
    mm: 0.001, millimeter: 0.001, millimeters: 0.001, millimetre: 0.001, millimetres: 0.001,
    cm: 0.01, centimeter: 0.01, centimeters: 0.01, centimetre: 0.01, centimetres: 0.01,
    m: 1, meter: 1, meters: 1, metre: 1, metres: 1,
    km: 1000, kilometer: 1000, kilometers: 1000, kilometre: 1000, kilometres: 1000,
    in: 0.0254, inch: 0.0254, inches: 0.0254,
    ft: 0.3048, foot: 0.3048, feet: 0.3048,
    yd: 0.9144, yard: 0.9144, yards: 0.9144,
    mi: 1609.344, mile: 1609.344, miles: 1609.344,
    nmi: 1852, NM: 1852, nauticalmile: 1852, nauticalmiles: 1852,
    au: 149597870700, ly: 9460730472580800, pc: 30856775814913673
  };
  function toMeters(value, unit) {
    var f = UNITS[unit] || UNITS[String(unit || '').toLowerCase()] || 1;
    return Number(value) * f;
  }
  function convertLength(value, from, to) {
    var t = UNITS[to] || UNITS[String(to || '').toLowerCase()] || 1;
    return toMeters(value, from || 'm') / t;
  }
  function formatNumber(n, digits) {
    return new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: digits }).format(n);
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // repeated keys (several "marker:" lines) are allowed: the plugin reads
  // those lines from the source itself
  function parseYaml(text) {
    return jsyaml.load(text, { json: true });
  }

  // parseLink() of the plugin: [[path]] / [text](path) -> path
  function parseLink(link) {
    if (!link) return undefined;
    var m = String(link).match(/(?:\[.*\]\(|\[\[)(.+)(?:\)|\]\])/);
    if (m) return m[1];
    return String(link).replace(/(\[|\])/g, '');
  }

  // papaparse-like split of one CSV line (quotes allowed)
  function parseCSVLine(line) {
    var out = [], cur = '', quoted = false;
    line = String(line);
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { quoted = false; }
        else { cur += c; }
      } else if (c === '"' && cur === '') {
        quoted = true;
      } else if (c === ',') {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  /**
   * getParamsFromSource() of the plugin: YAML with links pulled out first,
   * several "image:" lines become layers, markers etc. may be repeated lines
   */
  function getParamsFromSource(source) {
    var params = {};
    var links = source.match(/(?:\[.*\]\(|\[\[)[^\[\]]*(?:\)|\]\])/g) || [];
    links.forEach(function (link, i) {
      source = source.replace(link, 'LEAFLET_INTERNAL_LINK_' + i);
    });
    try {
      params = parseYaml(source);
    } catch (e) {
      console.error('Obsidian Leaflet: YAML Parsing failed\n' + e);
      params = {};
      source.split('\n').forEach(function (l) {
        var kv = l.split(/:\s?/);
        if (kv[0]) params[kv[0]] = kv.slice(1).join(':');
      });
    }
    if (!params || typeof params !== 'object') params = {};

    if (links.length) {
      var stringified = JSON.stringify(params);
      links.forEach(function (link, i) {
        var token = new RegExp('LEAFLET_INTERNAL_LINK_' + i + '(?!\\d)', 'g');
        var escaped = JSON.stringify(link).slice(1, -1);
        stringified = stringified.replace(token, function () { return escaped; });
        source = source.replace(token, function () { return link; });
      });
      params = JSON.parse(stringified);
    }

    var image, layers;
    if ((source.match(/^\bimage\b:[\s\S]*?$/gm) || []).length > 1) {
      layers = (source.match(/^\bimage\b:([\s\S]*?)$/gm) || []).map(function (p) {
        return p.split('image: ')[1];
      });
    }
    if (typeof params.image === 'string') image = [params.image];
    else if (Array.isArray(params.image)) image = params.image.slice();
    else image = ['real'];
    params.layers = layers || image.slice();
    params.image = params.layers[0];

    var obj = { marker: [], markerFile: [], markerFolder: [], markerTag: [], filterTag: [], commandMarker: [], geojson: [], linksTo: [], linksFrom: [], overlay: [] };
    if (new RegExp('(' + Object.keys(obj).join('|') + ')').test(source)) {
      Object.keys(obj).forEach(function (type) {
        var r = new RegExp('^\\b' + type + '\\b:\\s?([\\s\\S]*?)$', 'gm');
        var lines = source.match(r) || [];
        var split = function (p) { return (p.split(new RegExp('(?:' + type + '):\\s?'))[1] || '').trim(); };
        if (type === 'filterTag' || type === 'markerTag') {
          if (lines.length > 1) obj[type] = lines.map(function (p) { return split(p).split(/,\s?/); });
          else if (Array.isArray(params[type])) obj[type] = params[type].map(function (p) { return Array.isArray(p) ? p : [p]; });
          else if (params[type] !== undefined && params[type] !== null) obj[type] = [[String(params[type])]];
        } else if (type === 'markerFile') {
          if (lines.length > 1) obj[type] = lines.map(split);
          else if (Array.isArray(params[type])) obj[type] = flat(params[type]);
          else if (params[type] !== undefined && params[type] !== null) obj[type] = [String(params[type])];
        } else {
          if (lines.length > 1) {
            obj[type] = lines.map(function (p) {
              try { return parseYaml(split(p)); } catch (e) { return split(p); }
            });
          } else if (Array.isArray(params[type])) obj[type] = params[type];
          else if (params[type] !== undefined && params[type] !== null) obj[type] = [params[type]];
        }
      });
    }
    Object.keys(obj).forEach(function (k) { params[k] = obj[k]; });
    return params;
  }

  function flat(arr) {
    var out = [];
    (function walk(a) { a.forEach(function (x) { if (Array.isArray(x)) walk(x); else out.push(x); }); })(arr);
    return out;
  }

  function stringifyLinkish(v) {
    if (v == null) return '';
    if (Array.isArray(v)) {
      // "[[Note]]" written without the placeholder trick becomes [["Note"]]
      return '[[' + flat(v).join('') + ']]';
    }
    return String(v);
  }

  /* ---------- icons ---------- */

  function faDefinition(icons, name) {
    var data = icons[name];
    if (!data) return null;
    return { prefix: 'fas', iconName: name, icon: [data[0], data[1], [], '', data[2]] };
  }

  function faHtml(icons, name, params) {
    var def = faDefinition(icons, name);
    if (!def) return '';
    return FA.icon(def, params || {}).html[0];
  }

  // parseIcon() / generateMarkerMarkup() of the plugin
  function buildMarkerIcons(settings, localTypes, icons) {
    var defaultMarker = settings.defaultMarker;
    var result = {};
    var makeNode = function (icon, params) {
      if (icon.isImage) {
        var img = document.createElement('img');
        img.src = icon.imageUrl;
        img.className = 'full-width-height';
        return img;
      }
      var def = faDefinition(icons, icon.iconName) || faDefinition(icons, 'map-marker');
      if (!def) return document.createElement('span');
      return FA.icon(def, params).node[0];
    };

    var defaultParams = { classes: ['full-width-height'], styles: { color: defaultMarker.color, opacity: String(defaultMarker.alpha == null ? 1 : defaultMarker.alpha) } };
    var defaultHtml = makeNode(defaultMarker, defaultParams).outerHTML;
    result['default'] = { type: 'default', html: defaultHtml, markerIcon: defaultMarker };

    var parse = function (icon) {
      icon = Object.assign({}, icon);
      if (!icon.transform) icon.transform = defaultMarker.transform;
      if (!icon.iconName) icon.iconName = defaultMarker.iconName;
      var params = icon.layer && !defaultMarker.isImage
        ? { transform: icon.transform, mask: faDefinition(icons, defaultMarker.iconName) }
        : {};
      params.classes = ['full-width-height'];
      var node = makeNode(icon, params);
      node.style.color = icon.color ? icon.color : defaultMarker.color;
      node.style.opacity = String(icon.alpha != null ? icon.alpha : (defaultMarker.alpha != null ? defaultMarker.alpha : 1));
      return { type: icon.type, html: node.outerHTML, markerIcon: icon };
    };
    (settings.markerIcons || []).concat(localTypes || []).forEach(function (icon) {
      if (icon && icon.type) result[icon.type] = parse(icon);
    });
    result.__parse = parse;
    return result;
  }

  /* ---------- the map ---------- */

  var maps = [];

  function cleanupDetached() {
    maps = maps.filter(function (m) {
      if (document.body.contains(m.el)) return true;
      try { m.resize && m.resize.disconnect(); m.map.remove(); } catch (e) { }
      return false;
    });
  }

  function getHeight(el, height) {
    height = String(height);
    if (!/\d+(px|%)/.test(height)) return '500px';
    var perc = height.match(/(\d+)%/);
    if (perc) {
      var view = el.closest('.markdown-preview-view') || document.body;
      var cs = getComputedStyle(view);
      var h = view.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return (h * Number(perc[1]) / 100) + 'px';
    }
    return height;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var i = new Image();
      i.onload = function () { resolve({ w: i.naturalWidth || i.width, h: i.naturalHeight || i.height }); };
      i.onerror = reject;
      i.src = url;
    });
  }

  function layerId(layerString) {
    var url = layerString;
    try { url = decodeURIComponent(layerString); } catch (e) { }
    return encodeURIComponent(url);
  }

  function normalizeLayer(layer) {
    if (!layer) return null;
    var decoded = layer;
    try { decoded = decodeURIComponent(layer); } catch (e) { }
    return decoded === layer ? encodeURIComponent(layer) : layer;
  }

  function linkDisplayText(text) {
    return String(text).replace(/(\^)/, ' > ^').replace(/#/, ' > ').split('|').pop();
  }

  function render(container) {
    container.classList.add('is-rendering');
    var codeEl = container.querySelector('code');
    var source = codeEl ? codeEl.textContent : '';
    var note = container.getAttribute('data-note') || '';

    var params;
    try {
      params = Object.assign({}, DEFAULT_BLOCK_PARAMETERS, getParamsFromSource(source));
    } catch (e) {
      return renderError(container, e.message);
    }

    // everything the server has to resolve
    var links = [], notes = [], folders = [], geojson = [], geojsonFolders = [];
    var isImage = params.image !== 'real';
    if (isImage) {
      params.layers.forEach(function (l) { links.push(String(parseLink(stringifyLinkish(l)) || '').split('|')[0]); });
    }
    var imageOverlays = [];
    (Array.isArray(params.imageOverlay) ? params.imageOverlay : []).forEach(function (o) {
      if (!Array.isArray(o) || !o.length) return;
      var img = stringifyLinkish(o[0]);
      imageOverlays.push({ img: img, bounds: o.slice(1) });
      links.push(String(parseLink(img) || '').split('|')[0]);
    });
    params.marker.forEach(function (m) {
      var row = parseCSVLine(stringifyLinkish(m));
      if (row[3] && row[3].trim()) links.push(parseLink(row[3].trim()));
    });
    flat([].concat(params.geojson || [])).filter(Boolean).forEach(function (g) {
      var parts = String(g).replace(/(\[|\])/g, '').split('|');
      geojson.push(parts[0]);
      if (parts[2]) links.push(parts[2]);
    });
    if (params.geojsonFolder) geojsonFolders = [].concat(params.geojsonFolder).map(String);
    params.markerFile.forEach(function (f) { notes.push(parseLink(stringifyLinkish(f))); });
    params.markerFolder.forEach(function (f) { folders.push(String(f)); });

    var request = {
      note: note, id: params.id != null ? String(params.id) : null,
      links: links.filter(Boolean), notes: notes.filter(Boolean), folders: folders,
      markerTag: params.markerTag, filterTag: params.filterTag,
      coordinates: typeof params.coordinates === 'string' && params.coordinates.length ? parseLink(params.coordinates) : null,
      geojson: geojson, geojsonFolders: geojsonFolders
    };

    return fetch(window.uriPath + 'leaflet.php', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
    }).then(function (r) { return r.json(); }).then(function (data) {
      return build(container, params, data, { imageOverlays: imageOverlays, note: note });
    }).catch(function (e) {
      console.error(e);
      renderError(container, e && e.message ? e.message : String(e));
    });
  }

  function renderError(container, message) {
    container.classList.remove('is-rendering');
    var pre = document.createElement('pre');
    pre.id = 'leaflet-error';
    pre.textContent = '```leaflet\nThere was an error rendering the map:\n\n' + message + '\n```';
    container.innerHTML = '';
    container.appendChild(pre);
  }

  function build(container, params, data, extra) {
    var settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    settings.defaultMarker = Object.assign({}, DEFAULT_SETTINGS.defaultMarker, settings.defaultMarker || {});
    var icons = data.icons || {};
    var markerIcons = buildMarkerIcons(settings, data.localTypes, icons);
    var resolved = data.links || {};
    var isImage = params.image !== 'real';

    var zoom = {
      min: +params.minZoom, max: +params.maxZoom, delta: +params.zoomDelta,
      default: +params.defaultZoom
    };
    var unit = params.unit || (settings.defaultUnitType === 'imperial' ? 'mi' : 'km');
    var scale = isImage ? (Number(params.scale) || 1) : convertLength(1, 'm', unit);

    var contentEl = document.createElement('div');
    contentEl.className = 'perlite-leaflet-map';
    container.innerHTML = '';
    container.appendChild(contentEl);
    container.style.width = params.width || '100%';
    var height = getHeight(container, params.height);
    container.style.height = height;
    contentEl.style.height = height;
    contentEl.style.width = '100%';
    container.classList.remove('is-rendering');

    var noUI = params.noUI === true || params.noUI === 'true';
    var map = L.map(contentEl, {
      crs: isImage ? L.CRS.Simple : L.CRS.EPSG3857,
      maxZoom: zoom.max, minZoom: zoom.min,
      scrollWheelZoom: !(params.noScrollZoom === true || params.noScrollZoom === 'true'),
      zoomDelta: zoom.delta, zoomSnap: zoom.delta,
      zoomControl: !noUI,
      wheelPxPerZoomLevel: 60 * (1 / zoom.delta),
      worldCopyJump: !isImage
    });
    map.createPane('base-layer');
    map.createPane('geojson');
    map.createPane('drawing');
    map.createPane('image-overlay');

    var state = {
      map: map, el: container, params: params, isImage: isImage, groups: [], current: null,
      markers: [], overlays: [], displaying: {}, zoom: zoom, unit: unit, scale: scale,
      settings: settings, markerIcons: markerIcons, note: extra.note
    };
    maps.push(state);

    var darkMode = String(params.darkMode) === 'true';
    var layerControl = null;
    var ensureLayerControl = function () {
      if (!layerControl) {
        layerControl = L.control.layers({}, {}, { position: 'topright' });
        if (!noUI) layerControl.addTo(map);
      }
      return layerControl;
    };

    var newGroup = function (baseLayer, id, alias, dims) {
      var g = { id: id, alias: alias, layer: baseLayer, dims: dims, group: L.layerGroup([baseLayer]), types: {}, overlays: L.layerGroup() };
      g.overlays.addTo(g.group);
      state.groups.push(g);
      return g;
    };

    var layersReady;
    if (isImage) {
      layersReady = params.layers.reduce(function (p, layerString, index) {
        return p.then(function () {
          var linkText = parseLink(stringifyLinkish(layerString)) || '';
          var parts = String(linkText).split('|');
          var target = resolved[parts[0]] || {};
          if (!target.url) {
            if (index === 0) throw new Error('Could not find the map image ' + parts[0]);
            return;
          }
          return loadImage(target.url).then(function (dims) {
            var bounds;
            if (params.bounds && params.bounds.length) {
              bounds = L.latLngBounds(params.bounds);
            } else {
              bounds = L.latLngBounds(map.unproject([0, dims.h], zoom.max - 1), map.unproject([dims.w, 0], zoom.max - 1));
            }
            var overlay = L.imageOverlay(target.url, bounds, { className: darkMode ? 'dark-mode' : '', pane: 'base-layer' });
            var alias = parts[1] && parts[1].length ? parts[1] : null;
            newGroup(overlay, layerId(stringifyLinkish(layerString)), alias, [dims.w, dims.h]);
          });
        });
      }, Promise.resolve());
    } else {
      var tileServer = document.body.classList.contains('theme-light') ? settings.defaultTile : settings.defaultTileDark;
      var subdomains = String(settings.defaultTileSubdomains || 'a,b,c,d').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var tileLayers = [];
      [].concat(params.tileServer || []).filter(Boolean).forEach(function (t) {
        var p = String(t).split('|');
        if (p[0]) tileLayers.push({ id: p[0], data: p[0], alias: p[1] });
      });
      var paramSubdomains = [].concat(params.tileSubdomains || []).map(function (s) { return String(s).split(','); });
      paramSubdomains = flat(paramSubdomains).map(function (s) { return s.trim(); }).filter(Boolean);
      if (params.osmLayer !== false && params.osmLayer !== 'false' || !tileLayers.length) {
        tileLayers.unshift({ id: 'real', data: tileServer, alias: tileServer === 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' ? 'OpenStreetMap' : 'Tile Server', osm: true });
      }
      tileLayers.forEach(function (t) {
        var layer = L.tileLayer(t.data, {
          attribution: /stamen-tiles/.test(t.data) ? DEFAULT_ATTRIBUTION : settings.defaultAttribution,
          subdomains: t.osm ? subdomains : (paramSubdomains.length ? paramSubdomains : subdomains),
          className: darkMode ? 'dark-mode' : ''
        });
        newGroup(layer, t.id, t.alias, null);
      });
      layersReady = Promise.resolve();
    }

    return layersReady.then(function () {
      if (!state.groups.length) throw new Error('The map has no layers.');
      state.current = state.groups[0];
      var bounds = function () {
        return isImage ? state.current.layer.getBounds() : map.getBounds();
      };

      if (state.groups.length > 1) {
        state.groups.forEach(function (g, i) {
          ensureLayerControl().addBaseLayer(g.group, g.alias || (isImage ? 'Layer ' + (i + 1) : (g.alias || 'Layer ' + (i + 1))));
        });
      }

      /* markers */
      var groupFor = function (layer) {
        var id = normalizeLayer(layer);
        if (!id) return state.groups[0];
        for (var i = 0; i < state.groups.length; i++) {
          if (state.groups[i].id === id) return state.groups[i];
        }
        return state.groups[0];
      };
      var typeGroup = function (g, type) {
        if (!g.types[type]) {
          g.types[type] = L.layerGroup();
          if (state.displaying[type] !== false) g.types[type].addTo(g.group);
        }
        return g.types[type];
      };

      var addMarker = function (m) {
        var type = m.type, iconInfo;
        if (type && typeof type === 'object') {
          iconInfo = markerIcons.__parse({ type: 'custom', iconName: type.icon || 'map-marker', layer: type.layer == null ? true : type.layer, color: type.color });
          type = 'custom';
        } else {
          if (!markerIcons[type] || type === '__parse') type = 'default';
          iconInfo = markerIcons[type];
        }
        if (!(type in state.displaying)) state.displaying[type] = true;
        var loc = L.latLng(m.loc);
        var g = groupFor(m.layer);
        var link = m.link;
        var markerIcon = iconInfo.markerIcon || {};
        var marker = {
          id: m.id, type: type, loc: loc, link: link, description: m.description, group: g,
          minZoom: m.minZoom != null ? m.minZoom : (markerIcon.minZoom != null ? markerIcon.minZoom : null),
          maxZoom: m.maxZoom != null ? m.maxZoom : (markerIcon.maxZoom != null ? markerIcon.maxZoom : null),
          tooltip: m.tooltip || settings.displayMarkerTooltips, target: m.target || null
        };
        var html = iconInfo.html;
        var url = marker.target && marker.target.url;
        if (settings.notePreview && url && marker.target.type === 'note') {
          // the page preview on hover (same as other internal links)
          html = '<a class="internal-link perlite-leaflet-marker-link" href="' + escapeHtml(url) + '">' + html + '</a>';
        }
        var divIcon = L.divIcon({ html: html, className: 'leaflet-div-icon' });
        marker.leaflet = L.marker(loc, { icon: divIcon, keyboard: false, bubblingMouseEvents: true });
        marker.leaflet.on('add', function () {
          var el = marker.leaflet.getElement();
          if (el) {
            el.dataset.link = String(marker.link);
            el.dataset.mutable = String(!!m.mutable);
            el.dataset.type = marker.type;
          }
          if (marker.tooltip === 'always') openMarkerPopup(state, marker, true);
        });
        bindMarker(state, marker);
        state.markers.push(marker);
        updateMarkerVisibility(state, marker);
        return marker;
      };
      state.typeGroup = typeGroup;

      var savedMarkers = (data.saved && data.saved.markers) || [];
      var immutable = immutableMarkers(params, data, settings, resolved, extra.note);

      savedMarkers.concat(immutable.markers).forEach(function (m) {
        if (!m.target) m.target = markerTarget(m.link, resolved, extra.note, data);
        addMarker(m);
      });

      /* overlays */
      var savedOverlays = (data.saved && data.saved.overlays) || [];
      savedOverlays.concat(immutable.overlays).forEach(function (o) {
        addOverlay(state, o, groupFor(o.layer));
      });
      sortOverlays(state);

      /* drawn shapes (on every layer, like the plugin's drawing pane) */
      var drawingLayer = L.layerGroup([], { pane: 'drawing' }).addTo(map);
      ((data.saved && data.saved.shapes) || []).forEach(function (shape) {
        addShape(state, drawingLayer, shape);
      });

      /* features */
      var featureLayer = L.featureGroup();
      var features = [];
      var geojsonEntries = flat([].concat(params.geojson || [])).filter(Boolean).map(function (g) {
        var p = String(g).replace(/(\[|\])/g, '').split('|');
        var alias = p[1] && p[1].length ? p[1] : p[0];
        return { key: p[0], alias: alias, note: p[2] };
      });
      geojsonEntries.forEach(function (g) {
        var file = (data.geojson || {})[g.key];
        if (file) features.push({ data: file.data, alias: g.alias, note: g.note });
      });
      (data.geojsonFolders || []).forEach(function (f) {
        features.push({ data: f.data, alias: f.path.substring(f.path.lastIndexOf('/') + 1, f.path.lastIndexOf('.')) });
      });
      features.reverse();
      if (features.length) {
        var geoGroup = L.featureGroup().addTo(featureLayer);
        features.forEach(function (f, i) {
          try {
            var geo = buildGeoJSON(state, f, params.geojsonColor || '#3388ff', resolved);
            geo.addTo(geoGroup);
            ensureLayerControl().addOverlay(geo, f.alias && f.alias.length ? f.alias : 'GeoJSON ' + (i + 1));
          } catch (e) {
            console.error('There was an error adding GeoJSON to map', e);
          }
        });
      }

      /* image overlays and tile overlays (off until switched on in the layers control) */
      extra.imageOverlays.forEach(function (o) {
        var p = String(parseLink(o.img) || '').split('|');
        var target = resolved[p[0]];
        if (!target || !target.url) return;
        var b = o.bounds && o.bounds.length ? o.bounds : bounds();
        var image = L.imageOverlay(target.url, b, { pane: 'image-overlay' });
        ensureLayerControl().addOverlay(image, p[1] || target.name || p[0]);
      });
      var tileOverlayLayer = L.featureGroup();
      [].concat(params.tileOverlay || []).filter(Boolean).forEach(function (overlay, i) {
        var p = String(overlay).split('|');
        var layer = L.tileLayer(p[0]);
        if (p[2] === 'on') layer.addTo(tileOverlayLayer);
        ensureLayerControl().addOverlay(layer, p[1] && p[1].length ? p[1] : 'Layer ' + (i + 1));
      });

      /* initial view */
      var coords = initialCoordinates(params, data, settings, isImage);
      var initial = coords.coords;
      if (isImage && !(params.bounds && params.bounds.length)) {
        var c = bounds().getCenter();
        initial = [initial[0] * c.lat / 50, initial[1] * c.lng / 50];
      }
      state.initial = initial;
      map.setView(initial, zoom.default, { animate: false });
      if (features.length && (params.zoomFeatures === true || params.zoomFeatures === 'true')) {
        map.fitBounds(featureLayer.getBounds());
        var fc = featureLayer.getBounds().getCenter();
        state.initial = [fc.lat, fc.lng];
        zoom.default = map.getBoundsZoom(featureLayer.getBounds());
      }
      if (coords.zoomDistance) {
        var distance = isImage ? convertLength(coords.zoomDistance.value, coords.zoomDistance.unit, unit) / scale : toMeters(coords.zoomDistance.value, coords.zoomDistance.unit);
        var circle = L.circle(state.initial, { radius: distance, fillOpacity: 0, opacity: 0 }).addTo(map);
        zoom.default = map.getBoundsZoom(circle.getBounds());
        circle.remove();
      }
      map.setView(state.initial, zoom.default, { animate: false });
      featureLayer.addTo(state.current.group);
      state.current.group.addTo(map);
      tileOverlayLayer.addTo(map);

      if (params.recenter === true || params.recenter === 'true') {
        map.setMaxBounds(bounds());
      }

      map.on('baselayerchange', function (e) {
        map.setMaxBounds(null);
        state.groups.forEach(function (g) { if (g.group === e.layer) state.current = g; });
        featureLayer.addTo(state.current.group);
        resetView(state);
        if (params.recenter === true || params.recenter === 'true') map.setMaxBounds(bounds());
      });
      map.on('zoomend', function () {
        state.markers.forEach(function (m) { updateMarkerVisibility(state, m); });
      });
      state.markers.forEach(function (m) { updateMarkerVisibility(state, m); });

      if (!noUI) buildControls(state, icons, contentEl);

      if (params.showAllMarkers === true || params.showAllMarkers === 'true') {
        zoomAllMarkers(state);
      }

      state.resize = new ResizeObserver(function () {
        if (params.preserveAspect === true || params.preserveAspect === 'true') {
          var b = container.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) {
            if (state.aspect == null) state.aspect = b.width / b.height;
            contentEl.style.height = (b.width / state.aspect) + 'px';
          }
        }
        map.invalidateSize();
      });
      state.resize.observe(container);
      container.classList.add('is-rendered');
    });
  }

  /* ---------- markers ---------- */

  // where a marker's link goes: a note (with heading), an external URL or nothing
  function markerTarget(link, resolved, note, data) {
    if (!link) return null;
    var text = String(link).replace('^', '#^').split('|')[0];
    if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) {
      return { type: 'external', url: /^www\./i.test(text) ? 'https://' + text : text };
    }
    if (text.startsWith('#')) {
      return { type: 'note', url: window.location.pathname + '#' + text.slice(1).replace(/ /g, '-') };
    }
    var r = resolved[String(link)] || resolved[parseLink(link)] || resolved[text];
    if (r && r.url) return r;
    return null;
  }

  function immutableMarkers(params, data, settings, resolved, note) {
    var markers = [], overlays = [];
    (params.marker || []).forEach(function (marker) {
      var row = parseCSVLine(stringifyLinkish(marker));
      var type = row[0], lat = row[1], long = row[2], link = row[3], description = row[4], minZoom = row[5], maxZoom = row[6], layer = row[7];
      if (!type || !type.length || type === 'undefined') type = 'default';
      if (!lat || isNaN(Number(lat)) || !long || isNaN(Number(long))) return;
      var num = function (v) { return v == null || v.length === 0 || isNaN(Number(v)) ? undefined : Number(v); };
      if (!description || !description.length || description === 'undefined') description = undefined;
      markers.push({
        type: type.trim(), loc: [Number(lat), Number(long)], link: link ? parseLink(link.trim()) : undefined,
        layer: layer, mutable: false, description: description, minZoom: num(minZoom), maxZoom: num(maxZoom), tooltip: 'hover'
      });
    });

    var tagSetOf = function (file, fm) {
      var tags = {};
      var add = function (t) {
        if (!t) return;
        String(t).split(/[\s,]+/).forEach(function (x) { if (x) tags[('#' + x.replace(/^#/, '')).toLowerCase()] = true; });
      };
      if (fm) { [].concat(fm.tags || [], fm.tag || []).forEach(add); }
      (file.tags || []).forEach(add);
      return tags;
    };
    var iconForTag = function (tags) {
      var found = (settings.markerIcons || []).find(function (icon) {
        return (icon.tags || []).some(function (t) { return tags[(t[0] === '#' ? t : '#' + t).toLowerCase()]; });
      });
      return found ? found.type : null;
    };

    (data.files || []).forEach(function (file) {
      var fm = {};
      try { fm = file.frontmatter ? (parseYaml(file.frontmatter) || {}) : {}; } catch (e) { fm = {}; }
      if (typeof fm !== 'object') fm = {};
      if (!fm.location && !fm.mapoverlay && !fm.mapmarkers && !(params.overlayTag && params.overlayTag in fm)) return;
      var tags = tagSetOf(file, fm);
      var target = { type: 'note', url: file.url, name: file.name, path: file.path };
      var linkText = file.name;
      if (fm.location) {
        var locations = fm.location;
        if (locations.length && !Array.isArray(locations[0])) locations = [locations];
        locations.forEach(function (location) {
          var lat = location[0], long = location[1];
          lat = typeof lat === 'number' ? lat : Number(String(lat).split('%')[0]);
          long = typeof long === 'number' ? long : Number(String(long).split('%')[0]);
          if (isNaN(lat) || isNaN(long)) return;
          var min, max;
          if (fm.mapzoom) {
            min = isNaN(Number(fm.mapzoom[0])) ? undefined : Number(fm.mapzoom[0]);
            max = isNaN(Number(fm.mapzoom[1])) ? undefined : Number(fm.mapzoom[1]);
          }
          markers.push({ type: fm.mapmarker || iconForTag(tags) || 'default', loc: [lat, long], link: linkText, target: target, mutable: false, minZoom: min, maxZoom: max });
        });
      }
      if (Array.isArray(fm.mapmarkers)) {
        fm.mapmarkers.forEach(function (mm) {
          if (!Array.isArray(mm)) return;
          var num = function (v) { return isNaN(Number(v)) || v == null ? undefined : Number(v); };
          markers.push({ type: mm[0] || iconForTag(tags) || 'default', loc: [mm[1][0], mm[1][1]], link: linkText, target: target, description: mm[2], mutable: false, minZoom: num(mm[3]), maxZoom: num(mm[4]) });
        });
      }
      if (fm.mapoverlay) {
        var arr = Array.isArray(fm.mapoverlay[0]) ? fm.mapoverlay : [fm.mapoverlay];
        arr.forEach(function (o) {
          var color = o[0] || params.overlayColor || 'blue', loc = o[1] || [0, 0], length = o[2] || '1 m', desc = o[3];
          var match = String(length).match(OVERLAY_TAG_REGEX);
          if (!match) return;
          overlays.push({ color: color, loc: loc, radius: Number(match[1]), unit: match[2] || undefined, desc: desc != null ? desc : file.name + ' overlay', mutable: false });
        });
      }
      if (params.overlayTag && params.overlayTag in fm) {
        var match = String(fm[params.overlayTag]).match(OVERLAY_TAG_REGEX);
        var location = fm.location;
        if (match && location) {
          if (Array.isArray(location) && !Array.isArray(location[0])) location = [location];
          overlays.push({ color: params.overlayColor, loc: location[0], radius: Number(match[1]), unit: match[2] || undefined, desc: file.name + ': ' + params.overlayTag, mutable: false });
        }
      }
    });

    var list = params.overlay || [];
    var arr = Array.isArray(list[0]) ? list : (list.length && typeof list[0] !== 'string' ? [list] : list);
    arr.filter(function (o) { return o && o.length; }).forEach(function (overlay) {
      try {
        var parts = typeof overlay === 'string' ? overlay.split(/,(?![^\[]*\])/) : overlay;
        var color = parts[0], latlng = parts[1], length = parts[2], desc = parts[3];
        if (typeof color === 'string') color = color.replace(/^\[/, '').trim();
        if (typeof desc === 'string') desc = desc.replace(/\]$/, '').trim();
        latlng = typeof latlng === 'string' ? latlng.replace(/(\[|\])/g, '').split(',') : latlng;
        var match = String(length).trim().match(OVERLAY_TAG_REGEX);
        if (!match) return;
        overlays.push({ color: color, loc: [Number(latlng[0]), Number(latlng[1])], radius: Number(match[1]), unit: match[2] || undefined, desc: desc, mutable: false });
      } catch (e) { }
    });
    return { markers: markers, overlays: overlays };
  }

  function updateMarkerVisibility(state, marker) {
    var zoom = state.map.getZoom();
    var min = marker.minZoom != null ? marker.minZoom : state.zoom.min;
    var max = marker.maxZoom != null ? marker.maxZoom : state.zoom.max;
    var show = (marker.minZoom == null && marker.maxZoom == null) || (min <= zoom && zoom <= max);
    var group = state.typeGroup(marker.group, marker.type);
    if (show && !group.hasLayer(marker.leaflet)) group.addLayer(marker.leaflet);
    if (!show && group.hasLayer(marker.leaflet)) {
      group.removeLayer(marker.leaflet);
      if (marker.popup) state.map.closePopup(marker.popup);
    }
  }

  function markerPopupContent(marker) {
    var t = marker.target;
    if (t && t.type === 'external') {
      return '<a class="external-link" href="' + escapeHtml(t.url) + '" target="_blank" rel="noopener">' + escapeHtml(marker.link) + '</a>';
    }
    var linkHtml = '';
    if (marker.link) {
      var text = escapeHtml(linkDisplayText(marker.link));
      linkHtml = t && t.url
        ? '<a class="internal-link" href="' + escapeHtml(t.url) + '">' + text + '</a>'
        : '<span class="internal-link">' + text + '</span>';
    }
    if (marker.link && marker.description) {
      return '<div><span>' + escapeHtml(marker.description) + '</span><br><br>' + linkHtml + '</div>';
    }
    if (marker.link) return linkHtml;
    if (marker.description) return '<span>' + escapeHtml(marker.description) + '</span>';
    return null;
  }

  function openMarkerPopup(state, marker, permanent) {
    var content = markerPopupContent(marker);
    if (!content) return;
    var global = state.settings.displayMarkerTooltips;
    if (!permanent) {
      if (marker.tooltip === 'never') return;
      if (marker.tooltip !== 'always' && marker.tooltip !== 'hover' && global === 'never') return;
    }
    var el = marker.leaflet.getElement();
    var h = el ? el.getBoundingClientRect().height : 25;
    if (!marker.popup) {
      marker.popup = L.popup({ className: 'leaflet-marker-link-popup', autoClose: !permanent, closeButton: false, closeOnClick: false, autoPan: false, offset: L.point(0, -h / 2) });
    }
    marker.popup.setLatLng(marker.leaflet.getLatLng()).setContent(content);
    if (!state.map.hasLayer(marker.popup)) state.map.openPopup(marker.popup);
    if (permanent) return;
    var popupEl = marker.popup.getElement();
    if (popupEl && !popupEl._perliteBound) {
      popupEl._perliteBound = true;
      popupEl.addEventListener('mouseenter', function () { clearTimeout(marker.closeTimer); });
      popupEl.addEventListener('mouseleave', function () { scheduleClose(state, marker); });
    }
  }

  function scheduleClose(state, marker) {
    clearTimeout(marker.closeTimer);
    if (marker.tooltip === 'always') return;
    marker.closeTimer = setTimeout(function () {
      if (marker.popup) state.map.closePopup(marker.popup);
    }, 500);
  }

  function navigate(url, evt) {
    if (!url) return;
    var newTab = evt && (evt.ctrlKey || evt.metaKey);
    if (newTab) window.open(url, '_blank');
    else window.location.href = url;
  }

  function bindMarker(state, marker) {
    marker.leaflet.on('mouseover', function () {
      clearTimeout(marker.closeTimer);
      openMarkerPopup(state, marker, false);
    });
    marker.leaflet.on('mouseout', function () { scheduleClose(state, marker); });
    marker.leaflet.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      var t = marker.target;
      if (!t || !t.url) return;
      var orig = e.originalEvent || {};
      // a marker wrapped in a link (page preview on hover) follows it by itself
      if (orig.target && orig.target.closest && orig.target.closest('a.perlite-leaflet-marker-link')) return;
      if (t.type === 'external') window.open(t.url, '_blank', 'noopener');
      else navigate(t.url, orig);
    });
  }

  function zoomAllMarkers(state) {
    var shown = state.markers.filter(function (m) { return m.group === state.current && state.displaying[m.type] !== false; });
    if (!shown.length) { state.map.fitWorld(); return; }
    var group = L.featureGroup(shown.map(function (m) { return L.marker(m.loc); }));
    state.map.fitBounds(group.getBounds(), { maxZoom: state.map.getBoundsZoom(group.getBounds()) });
  }

  function resetView(state) {
    state.map.invalidateSize();
    if (state.params.showAllMarkers === true || state.params.showAllMarkers === 'true') {
      zoomAllMarkers(state);
      return;
    }
    state.map.setView(state.initial, state.zoom.default);
  }

  /* ---------- overlays ---------- */

  function addOverlay(state, o, group) {
    if (!o || !o.loc) return;
    var radiusInMeters = toMeters(o.radius, o.unit || 'm');
    // image maps: the radius in map units (the overlay's unit in the map's unit,
    // divided by "scale"), as the plugin sizes overlays while drawing / editing
    var radius = state.isImage ? convertLength(o.radius, o.unit || 'm', state.unit) / state.scale : radiusInMeters;
    var circle = L.circle(L.latLng(o.loc), { radius: radius, color: o.color });
    var overlay = { data: o, leaflet: circle, radiusInMeters: radiusInMeters };
    var description = function () {
      var radius = convertLength(o.radius, o.unit || 'm', state.unit);
      var text = formatNumber(radius, 1) + ' ' + state.unit;
      return o.desc ? o.desc + ' (' + text + ')' : text;
    };
    var popup = null, timer = null;
    var open = function () {
      if (!state.settings.displayOverlayTooltips && o.tooltip !== 'always') return;
      if (o.tooltip === 'never') return;
      if (!popup) popup = L.popup({ className: 'leaflet-marker-link-popup', closeButton: false, autoClose: true, closeOnClick: false, autoPan: false });
      var el = circle.getElement();
      var h = el ? el.getBoundingClientRect().height : 0;
      popup.options.offset = L.point(0, -h / 2 + 10);
      popup.setLatLng(circle.getLatLng()).setContent(escapeHtml(description()));
      state.map.openPopup(popup);
    };
    circle.on('mouseover', function (e) { L.DomEvent.stopPropagation(e); clearTimeout(timer); open(); });
    circle.on('mouseout', function () { clearTimeout(timer); timer = setTimeout(function () { if (popup) state.map.closePopup(popup); }, 500); });
    circle.on('click', open);
    circle.addTo(group.overlays);
    state.overlays.push(overlay);
  }

  function sortOverlays(state) {
    state.overlays.sort(function (a, b) { return b.radiusInMeters - a.radiusInMeters; });
    state.overlays.forEach(function (o) { if (o.leaflet._map) o.leaflet.bringToFront(); });
    state.map.once('layeradd', function () {
      state.overlays.forEach(function (o) { if (o.leaflet._map) o.leaflet.bringToFront(); });
    });
  }

  /* ---------- drawn shapes ---------- */

  var arrowCount = 0;
  function addShape(state, drawingLayer, shape) {
    if (!shape || !Array.isArray(shape.vertices)) return;
    var latlngs = shape.vertices.map(function (v) { return L.latLng(v.lat, v.lng); });
    var options = { pane: 'drawing', color: shape.color, fillColor: shape.color };
    var layer;
    if (shape.type === 'polygon') {
      layer = L.polygon(latlngs, options);
    } else if (shape.type === 'rectangle') {
      layer = L.rectangle(L.latLngBounds(latlngs), options);
    } else if (shape.type === 'polyline') {
      var coords = latlngs;
      if (shape.arrows && latlngs.length) {
        // one extra point in the middle of each segment carries the arrow
        coords = [latlngs[0]];
        for (var i = 1; i < latlngs.length; i++) {
          coords.push(L.latLngBounds(latlngs[i - 1], latlngs[i]).getCenter(), latlngs[i]);
        }
        options.smoothFactor = 0;
      }
      layer = L.polyline(coords, options);
      if (shape.arrows) {
        var id = 'perlite-leaflet-arrow-' + (++arrowCount);
        layer.on('add', function () {
          var path = layer.getElement();
          var svg = path && path.ownerSVGElement;
          if (!svg) return;
          var defs = svg.querySelector('defs');
          if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.prepend(defs); }
          if (!svg.querySelector('#' + id)) {
            var m = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            [['id', id], ['viewBox', '0 0 10 10'], ['refX', '5'], ['refY', '5'], ['markerUnits', 'strokeWidth'], ['markerWidth', '5'], ['markerHeight', '5'], ['orient', 'auto'], ['fill', shape.color]].forEach(function (a) { m.setAttribute(a[0], a[1]); });
            var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            if (shape.reversed) p.setAttribute('transform', 'rotate(180 5 5)');
            m.appendChild(p);
            defs.appendChild(m);
          }
          path.setAttribute('marker-mid', 'url(#' + id + ')');
        });
      }
    }
    if (layer) layer.addTo(drawingLayer);
  }

  /* ---------- GeoJSON ---------- */

  function buildGeoJSON(state, feature, color, resolved) {
    var noteTarget = feature.note ? markerTarget(feature.note, resolved) : null;
    var tooltip = function (title, description) {
      var html = '<div style="text-align: left;"><div style="display: flex; justify-content: space-between;"><label style="text-align: left;' + (description ? ' font-weight: bolder;' : '') + '">' + escapeHtml(title) + '</label></div>';
      if (description) html += '<p style="margin: 0.25rem 0; text-align: left;">' + escapeHtml(description) + '</p>';
      return html + '</div>';
    };
    var popup = L.popup({ className: 'leaflet-marker-link-popup', closeButton: false, autoClose: true, closeOnClick: false, autoPan: false });
    var timer = null;
    var show = function (latlng, html) {
      clearTimeout(timer);
      popup.setLatLng(latlng).setContent(html);
      state.map.openPopup(popup);
    };
    var hide = function () { clearTimeout(timer); timer = setTimeout(function () { state.map.closePopup(popup); }, 500); };

    var geo = L.geoJSON(feature.data, {
      pane: 'geojson',
      pointToLayer: function (point, latlng) {
        var type = point && point.properties && point.properties['marker-symbol'] || 'default';
        var icon = state.markerIcons[type] && type !== '__parse' ? state.markerIcons[type] : state.markerIcons['default'];
        var marker = L.marker(latlng, { pane: 'geojson', icon: L.divIcon({ html: icon.html, className: 'leaflet-div-icon' }) });
        marker.setZIndexOffset(1000);
        var props = point && point.properties || {};
        var title = props.title || props.name || null;
        if (title || feature.note) {
          marker.on('mouseover', function () { show(latlng, tooltip(title || feature.note)); });
          marker.on('mouseout', hide);
        }
        if (props.description) {
          marker.on('click', function (e) { L.DomEvent.stop(e); show(latlng, tooltip(title || feature.note, props.description)); });
        }
        return marker;
      },
      style: function (f) {
        if (!f || !f.properties) return {};
        var p = f.properties;
        return {
          color: p.stroke != null ? p.stroke : color,
          opacity: p['stroke-opacity'] != null ? p['stroke-opacity'] : 0.6,
          weight: p['stroke-width'] != null ? p['stroke-width'] : 2,
          fillColor: p.fill != null ? p.fill : null,
          fillOpacity: p['fill-opacity'] != null ? p['fill-opacity'] : 0.2
        };
      },
      onEachFeature: function (f, layer) {
        if (f.geometry && f.geometry.type === 'Point') return;
        var p = f.properties || {};
        var title = p.title || p.name || null;
        if (!title && !p.description) return;
        layer.on('mouseover', function () { show(layer.getBounds().getCenter(), tooltip(title || '')); });
        layer.on('mouseout', hide);
        layer.on('click', function (e) {
          if (e.originalEvent && (e.originalEvent.ctrlKey || e.originalEvent.metaKey)) { state.map.fitBounds(layer.getBounds()); return; }
          if (p.description) show(e.latlng, tooltip(title || '', p.description));
        });
      }
    });
    if (noteTarget && noteTarget.url) {
      geo.on('click', function (e) { navigate(noteTarget.url, e.originalEvent); });
    }
    return geo;
  }

  /* ---------- initial coordinates ---------- */

  function initialCoordinates(params, data, settings, isImage) {
    var latitude = params.lat, longitude = params.long, zoomDistance = null;
    var coordinates = params.coordinates;
    if (typeof coordinates === 'string' && coordinates.length) {
      var file = data.coordinates;
      if (file) {
        var fm = {};
        try { fm = parseYaml(file.frontmatter) || {}; } catch (e) { }
        if (Array.isArray(fm.location)) {
          var loc = Array.isArray(fm.location[0]) ? fm.location[0] : fm.location;
          latitude = loc[0];
          longitude = loc[1];
        }
        if (params.zoomTag && fm[params.zoomTag] != null) {
          var m = String(fm[params.zoomTag]).match(OVERLAY_TAG_REGEX);
          if (m) zoomDistance = { value: Number(m[1]), unit: m[2] || 'm' };
        }
      }
    } else if (Array.isArray(coordinates) && coordinates.length === 2) {
      latitude = coordinates[0];
      longitude = coordinates[1];
    }
    var lat = Number(String(latitude).split('%', 1)[0]);
    var lng = Number(String(longitude).split('%', 1)[0]);
    if (latitude == null || isNaN(lat)) lat = isImage ? 50 : settings.lat;
    if (longitude == null || isNaN(lng)) lng = isImage ? 50 : settings.long;
    return { coords: [lat, lng], zoomDistance: zoomDistance };
  }

  /* ---------- controls ---------- */

  function faControl(icons, iconName, cls, tooltip, onClick, position) {
    var Control = L.Control.extend({
      onAdd: function () {
        var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control ' + cls);
        var a = L.DomUtil.create('a', cls + '-icon', div);
        a.href = '#';
        a.setAttribute('role', 'button');
        if (tooltip) a.setAttribute('aria-label', tooltip), a.title = tooltip;
        a.innerHTML = faHtml(icons, iconName);
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); onClick(e, a); });
        return div;
      }
    });
    return new Control({ position: position || 'topleft' });
  }

  function buildControls(state, icons, contentEl) {
    var map = state.map;
    var container = state.el;
    // full screen
    if (container.requestFullscreen) {
      faControl(icons, 'expand', 'leaflet-control-fullscreen', 'Toggle Full Screen', function (e, a) {
        if (document.fullscreenElement === container) document.exitFullscreen();
        else container.requestFullscreen();
      }).addTo(map);
      document.addEventListener('fullscreenchange', function () {
        var btn = container.querySelector('.leaflet-control-fullscreen-icon');
        if (btn) btn.innerHTML = faHtml(icons, document.fullscreenElement === container ? 'compress' : 'expand');
        setTimeout(function () { map.invalidateSize(); }, 50);
      });
    }
    // filter markers by type
    var types = Object.keys(state.displaying);
    if (types.length) {
      var Filter = L.Control.extend({
        onAdd: function () {
          var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-expandable');
          var a = L.DomUtil.create('a', 'leaflet-control-expandable-icon', div);
          a.href = '#';
          a.setAttribute('aria-label', 'Filter Markers');
          a.title = 'Filter Markers';
          a.innerHTML = faHtml(icons, 'filter');
          var list = L.DomUtil.create('div', 'leaflet-control-expandable-list', div);
          var buttons = L.DomUtil.create('div', 'leaflet-control-expandable-button-group', list);
          var all = L.DomUtil.create('button', '', buttons); all.textContent = 'All';
          var none = L.DomUtil.create('button', '', buttons); none.textContent = 'None';
          var ul = L.DomUtil.create('div', 'input-container', list);
          var inputs = {};
          var setType = function (type, on) {
            state.displaying[type] = on;
            state.groups.forEach(function (g) {
              var tg = g.types[type];
              if (!tg) return;
              if (on) tg.addTo(g.group); else g.group.removeLayer(tg);
            });
            if (inputs[type]) inputs[type].checked = on;
          };
          Object.keys(state.displaying).forEach(function (type, i) {
            var li = L.DomUtil.create('div', 'input-item', ul);
            var id = 'leaflet-control-expandable-item-label-' + Math.random().toString(16).slice(2);
            var input = L.DomUtil.create('input', '', li);
            input.type = 'checkbox';
            input.id = id;
            input.checked = state.displaying[type] !== false;
            var label = L.DomUtil.create('label', '', li);
            label.setAttribute('for', id);
            var iconDiv = L.DomUtil.create('div', 'leaflet-control-expandable-icon', label);
            iconDiv.innerHTML = type === 'custom' ? '' : (state.markerIcons[type] || state.markerIcons['default']).html;
            var text = L.DomUtil.create('div', '', label);
            text.textContent = type[0].toUpperCase() + type.slice(1).toLowerCase();
            input.addEventListener('click', function () { setType(type, input.checked); });
            inputs[type] = input;
          });
          all.onclick = function (e) { e.stopPropagation(); Object.keys(inputs).forEach(function (t) { setType(t, true); }); };
          none.onclick = function (e) { e.stopPropagation(); Object.keys(inputs).forEach(function (t) { setType(t, false); }); };
          L.DomEvent.disableClickPropagation(div);
          L.DomEvent.disableScrollPropagation(div);
          L.DomEvent.on(div, 'mouseenter', function () { div.classList.add('expanded'); });
          L.DomEvent.on(div, 'mouseleave', function () { div.classList.remove('expanded'); });
          L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); div.classList.toggle('expanded'); });
          map.on('click', function () { div.classList.remove('expanded'); });
          return div;
        }
      });
      new Filter({ position: 'topright' }).addTo(map);
    }
    // show all markers, reset zoom
    faControl(icons, 'map-marked-alt', 'leaflet-control-zoom-markers', 'Show All Markers', function () { zoomAllMarkers(state); }).addTo(map);
    faControl(icons, 'bullseye', 'leaflet-control-reset-zoom', 'Reset Zoom', function () { resetView(state); }).addTo(map);
  }

  /* ---------- entry ---------- */

  window.perliteRenderLeafletMaps = function (root) {
    cleanupDetached();
    var blocks = (root || document).querySelectorAll('.perlite-leaflet:not(.is-rendered):not(.is-rendering)');
    blocks.forEach(function (block) { render(block); });
  };
})();
