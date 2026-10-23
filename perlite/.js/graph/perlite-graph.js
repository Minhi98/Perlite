/*!
 * Perlite: Quartz-style graph view.
 * A port of the graph component of Quartz (https://github.com/jackyzha0/quartz,
 * @quartz-community/graph, MIT License, (c) jackyzha0 and contributors):
 * D3 force simulation, PixiJS (WebGL) rendering, local graph (depth 1) and a
 * global graph (all notes), tags as nodes, drag / zoom,
 * Ctrl/Cmd + G.
 * Perlite changes:
 * - drawn like Obsidian's graph view, from the theme's Obsidian graph colours
 *   (.graph-view.color-*): node / tag / line / text colours, the hovered node
 *   and its links in the highlight colour with everything else faded, labels
 *   under the nodes in the default sans-serif, thin lines, bigger nodes for
 *   notes with more links, notes without links kept near the rest (centre
 *   pull, limited repulsion), starts zoomed to fit (Quartz's current-page and
 *   visited colours and its radial global layout dropped)
 * - hovering uses its own hit test (whole circle, at least HIT_MIN px; labels
 *   don't count); tags only with the "Show Tags" setting
 * - labels keep their on-screen size while zooming and are hidden where they
 *   would overlap a more important one; hovering shows the neighbours' labels
 * - no jump on page changes: the layout is computed before the first frame,
 *   starting from where the notes were in the previous graph
 * - redrawn when the theme, light / dark mode or CSS snippets change
 * Data comes from Perlite's graph (#allGraphNodes / #allGraphEdges: Perlite's
 * own index, or the Metadata Extractor plugin's metadata.json).
 */
(function () {
  'use strict';

  var d3 = window.d3;
  var PIXI = window.PIXI;

  var LOCAL_CONFIG = {
    drag: true, zoom: true, depth: 1, scale: 1.1, repelForce: 0.5, centerForce: 0.3,
    linkDistance: 60, fontSize: 0.6, opacityScale: 1, showTags: true, removeTags: [],
    focusOnHover: true, enableRadial: false, memory: 'local', gravity: 0.05, repelRange: 300
  };
  var GLOBAL_CONFIG = {
    drag: true, zoom: true, depth: -1, scale: 0.9, repelForce: 0.5, centerForce: 0.2,
    linkDistance: 30, fontSize: 0.6, opacityScale: 1, showTags: true, removeTags: [],
    focusOnHover: true, enableRadial: false, memory: 'global', gravity: 0.08, repelRange: 250
  };

  var HIT_MIN = 9;     // px: smallest hover / click radius of a node on screen
  var LABEL_GAP = 4;   // px between a node and its label
  var LABEL_PAD = 2;   // px kept free around each label
  var LABEL_HOVER_SHIFT = 6; // px the hovered node's label moves away (as in Obsidian)
  var PRESETTLE_MS = 150;    // time allowed to lay the graph out before the first frame

  // where the notes were in the last local / global graph, so the next one
  // starts from there (slug -> {x, y})
  var layoutMemory = { local: new Map(), global: new Map() };

  /* ---------- data: Perlite's graph -> Quartz's index ---------- */

  var cachedData = null;

  function decodeEntities(text) {
    var t = document.createElement('textarea');
    t.innerHTML = String(text);
    return t.value;
  }

  // { slug: { title, links: [slug], tags: [tag] } }, tags as "tags/<tag>" nodes
  function graphData() {
    if (cachedData) return cachedData;
    var nodesEl = document.getElementById('allGraphNodes');
    var edgesEl = document.getElementById('allGraphEdges');
    if (!nodesEl || !edgesEl) return null;
    var nodes, edges;
    try {
      nodes = JSON.parse(nodesEl.textContent || '[]');
      edges = JSON.parse(edgesEl.textContent || '[]');
    } catch (e) {
      return null;
    }
    var byId = {};
    var index = new Map();
    nodes.forEach(function (n) {
      var isTag = n.group === 'tag';
      var slug = isTag ? 'tags/' + decodeEntities(n.label).replace(/^#/, '') : decodeEntities(n.title).replace(/^\//, '');
      byId[n.id] = { slug: slug, isTag: isTag };
      if (!isTag) index.set(slug, { title: decodeEntities(n.label), links: [], tags: [] });
    });
    edges.forEach(function (e) {
      var from = byId[e.from], to = byId[e.to];
      if (!from || !to) return;
      // tag edges may point either way; the note is the source
      if (from.isTag && !to.isTag) { var t = from; from = to; to = t; }
      var page = index.get(from.slug);
      if (!page) return;
      if (to.isTag) {
        var tag = to.slug.substring(5);
        if (page.tags.indexOf(tag) === -1) page.tags.push(tag);
      } else if (page.links.indexOf(to.slug) === -1) {
        page.links.push(to.slug);
      }
    });
    cachedData = index;
    return index;
  }

  /* ---------- colours: the theme's Obsidian graph colours ---------- */

  function probeColor(classes, fallback) {
    var p = document.createElement('p');
    p.className = classes;
    p.style.position = 'absolute';
    p.style.visibility = 'hidden';
    document.body.appendChild(p);
    var color = getComputedStyle(p).color;
    p.remove();
    return color || fallback;
  }

  function themeColors() {
    var body = getComputedStyle(document.body);
    // Obsidian's graph view takes its colours from these classes (themes set
    // them through --graph-* variables); labels use the default sans-serif
    return {
      node: probeColor('graph-view color-fill', '#888888'),
      tag: probeColor('graph-view color-fill-tag', '#4caf50'),
      line: probeColor('graph-view color-line', '#555555'),
      text: probeColor('graph-view color-text', '#dadada'),
      highlight: probeColor('graph-view color-fill-highlight', '#7f6df2'),
      lineHighlight: probeColor('graph-view color-line-highlight', '#7f6df2'),
      font: body.getPropertyValue('--font-default').trim() || 'sans-serif'
    };
  }

  /* ---------- render (Quartz's renderGraph) ---------- */

  async function renderGraph(container, currentSlug, cfg, callbacks) {
    var data = graphData();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!data) return function () { };

    var width = container.offsetWidth;
    var height = Math.max(container.offsetHeight, 250);
    if (!width) return function () { };

    // tag nodes follow the "Show Tags" setting (off by default)
    var showTags = cfg.showTags && document.body.classList.contains('perlite-show-tags');
    var links = [];
    var tagSlugs = [];
    var validSlugs = new Set(data.keys());
    data.forEach(function (page, source) {
      page.links.forEach(function (target) {
        if (validSlugs.has(target)) links.push({ source: source, target: target });
      });
      if (showTags) {
        page.tags.forEach(function (tag) {
          if (cfg.removeTags.indexOf(tag) !== -1) return;
          var tagSlug = 'tags/' + tag;
          if (tagSlugs.indexOf(tagSlug) === -1) tagSlugs.push(tagSlug);
          links.push({ source: source, target: tagSlug });
        });
      }
    });

    // nodes within "depth" links of the current page (all for -1)
    var neighbourhood = new Set();
    if (cfg.depth >= 0) {
      var frontier = [currentSlug];
      var seen = new Set([currentSlug]);
      for (var depth = 0; depth <= cfg.depth && frontier.length > 0; depth++) {
        var next = [];
        frontier.forEach(function (slug) {
          neighbourhood.add(slug);
          links.forEach(function (l) {
            if (l.source === slug && !seen.has(l.target)) { seen.add(l.target); next.push(l.target); }
            if (l.target === slug && !seen.has(l.source)) { seen.add(l.source); next.push(l.source); }
          });
        });
        frontier = next;
      }
    } else {
      validSlugs.forEach(function (s) { neighbourhood.add(s); });
      tagSlugs.forEach(function (s) { neighbourhood.add(s); });
    }

    var nodes = [];
    var nodeBySlug = new Map();
    neighbourhood.forEach(function (slug) {
      var isTag = slug.startsWith('tags/');
      var page = data.get(slug);
      var node = {
        id: slug,
        text: isTag ? '#' + slug.substring(5) : (page ? page.title : slug),
        tags: isTag || !page ? [] : page.tags,
        vx: 0, vy: 0
      };
      nodes.push(node);
      nodeBySlug.set(slug, node);
    });
    var simLinks = [];
    links.forEach(function (l) {
      if (neighbourhood.has(l.source) && neighbourhood.has(l.target)) {
        var s = nodeBySlug.get(l.source), t = nodeBySlug.get(l.target);
        if (s && t) simLinks.push({ source: s, target: t });
      }
    });

    // start from where the notes were in the previous graph (the local graph
    // re-centred on the new page); new notes next to a note they link to, or
    // in d3's default spiral when there is none
    var memory = layoutMemory[cfg.memory] || new Map();
    var origin = cfg.depth >= 0 && memory.get(currentSlug) || { x: 0, y: 0 };
    var known = 0;
    nodes.forEach(function (n) {
      var p = memory.get(n.id);
      if (p) { n.x = p.x - origin.x; n.y = p.y - origin.y; known++; }
    });
    if (known > 0) {
      simLinks.forEach(function (l) {
        [[l.source, l.target], [l.target, l.source]].forEach(function (pair) {
          var n = pair[0], o = pair[1];
          if (n.x == null && o.x != null) {
            var a = Math.random() * 2 * Math.PI;
            n.x = o.x + Math.cos(a) * cfg.linkDistance;
            n.y = o.y + Math.sin(a) * cfg.linkDistance;
          }
        });
      });
    }

    var colors = themeColors();

    var app = new PIXI.Application();
    await app.init({
      width: width, height: height, antialias: true, backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1, autoDensity: true,
      // pointer handling is done below (hit test on the canvas), not by Pixi
      eventMode: 'none', eventFeatures: { move: false, globalMove: false, click: false, wheel: false }
    });
    container.appendChild(app.canvas);

    var stage = new PIXI.Container();
    app.stage.addChild(stage);

    var degree = new Map();
    simLinks.forEach(function (l) {
      degree.set(l.source.id, (degree.get(l.source.id) || 0) + 1);
      degree.set(l.target.id, (degree.get(l.target.id) || 0) + 1);
    });
    // notes with more links are bigger (as in Obsidian)
    function nodeRadius(n) {
      return Math.min(2 + 1.6 * Math.sqrt(degree.get(n.id) || 0), 16);
    }

    var simulation = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-100 * cfg.repelForce).distanceMax(cfg.repelRange))
      .force('center', d3.forceCenter().strength(cfg.centerForce))
      // every node is pulled towards the middle (like Obsidian's centre force),
      // and repulsion only reaches so far, so notes without links stay near
      // the rest instead of drifting off (Quartz only re-centres the whole graph)
      .force('x', d3.forceX(0).strength(cfg.gravity))
      .force('y', d3.forceY(0).strength(cfg.gravity))
      .force('link', d3.forceLink(simLinks).distance(cfg.linkDistance))
      .force('collide', d3.forceCollide().radius(nodeRadius).iterations(3));
    if (cfg.enableRadial) {
      var radius = Math.min(width, height) / 2 * 0.8;
      simulation.force('radial', d3.forceRadial(radius).strength(0.2));
    }

    var linkContainer = new PIXI.Container();
    var nodeContainer = new PIXI.Container();
    var labelContainer = new PIXI.Container();
    stage.addChild(linkContainer);
    stage.addChild(nodeContainer);
    stage.addChild(labelContainer);

    var nodeRenderData = [];
    var linkRenderData = [];
    var hoveredNodeId = null;
    var hoveredNeighbours = new Set();
    var dragStartTime = 0;
    var dragging = false;
    var currentTransform = d3.zoomIdentity;

    function nodeColor(n) {
      if (n.id === hoveredNodeId) return colors.highlight;
      if (n.id.startsWith('tags/')) return colors.tag;
      return colors.node;
    }

    function drawNode(n) {
      var d = n.simulationData;
      var color = nodeColor(d);
      if (n.drawnColor === color) return;
      n.drawnColor = color;
      n.gfx.clear();
      n.gfx.circle(0, 0, nodeRadius(d));
      n.gfx.fill({ color: color });
    }

    function updateHoverInfo(newHoveredId) {
      hoveredNodeId = newHoveredId;
      hoveredNeighbours = new Set();
      if (newHoveredId === null) {
        nodeRenderData.forEach(function (n) { n.active = false; });
        linkRenderData.forEach(function (l) { l.active = false; });
        return;
      }
      linkRenderData.forEach(function (l) {
        var d = l.simulationData;
        if (d.source.id === newHoveredId || d.target.id === newHoveredId) {
          hoveredNeighbours.add(d.source.id);
          hoveredNeighbours.add(d.target.id);
          l.active = true;
        } else {
          l.active = false;
        }
      });
      hoveredNeighbours.add(newHoveredId);
      nodeRenderData.forEach(function (n) {
        n.active = hoveredNeighbours.has(n.simulationData.id);
      });
    }

    // hovering: the node and its links in the highlight colour, notes that
    // aren't linked to it faded
    var FADED = 0.2;
    function renderLinks() {
      linkRenderData.forEach(function (l) {
        l.alpha = hoveredNodeId !== null && cfg.focusOnHover ? (l.active ? 1 : FADED) : 1;
        l.color = l.active ? colors.lineHighlight : colors.line;
      });
    }

    function renderNodes() {
      nodeRenderData.forEach(function (n) {
        n.gfx.alpha = hoveredNodeId !== null && cfg.focusOnHover ? (n.active ? 1 : FADED) : 1;
        drawNode(n);
      });
    }

    function renderPixiFromD3() {
      renderNodes();
      renderLinks();
    }

    nodes.forEach(function (n) {
      // labels are drawn at their on-screen size and scaled against the zoom
      var label = new PIXI.Text({
        text: n.text,
        style: { fontSize: cfg.fontSize * 22, fill: colors.text, fontFamily: colors.font },
        resolution: (window.devicePixelRatio || 1) * 2
      });
      label.anchor.set(0.5, 0);
      label.alpha = 0;
      labelContainer.addChild(label);

      var gfx = new PIXI.Graphics();
      gfx.eventMode = 'none';
      gfx.label = n.id;

      nodeContainer.addChild(gfx);
      nodeRenderData.push({
        simulationData: n, gfx: gfx, label: label, alpha: 1, active: false, drawnColor: null,
        labelW: label.width + LABEL_PAD * 2, labelH: label.height + LABEL_PAD * 2, box: null,
        side: 'below', shift: 0
      });
    });

    simLinks.forEach(function (l) {
      var gfx = new PIXI.Graphics();
      gfx.eventMode = 'none';
      linkContainer.addChild(gfx);
      linkRenderData.push({ simulationData: l, gfx: gfx, color: colors.line, alpha: 1, active: false });
    });

    function open(slug, evt) {
      if (callbacks && callbacks.open) callbacks.open(slug, evt);
    }

    function screenPos(n) {
      return {
        x: (n.x + width / 2) * currentTransform.k + currentTransform.x,
        y: (n.y + height / 2) * currentTransform.k + currentTransform.y
      };
    }

    // the node under a point of the canvas (CSS px): the nearest node whose
    // circle (at least HIT_MIN px) contains it; labels don't count
    function nodeAt(px, py) {
      var best = null, bestDist = Infinity;
      nodes.forEach(function (n) {
        if (n.x == null) return;
        var p = screenPos(n);
        var dist = Math.hypot(px - p.x, py - p.y);
        if (dist <= Math.max(nodeRadius(n) * currentTransform.k, HIT_MIN) && dist < bestDist) {
          best = n;
          bestDist = dist;
        }
      });
      return best;
    }

    function setHover(id) {
      if (id === hoveredNodeId) return;
      updateHoverInfo(id);
      renderPixiFromD3();
    }

    d3.select(app.canvas)
      .on('pointermove.hover', function (evt) {
        if (dragging) return;
        var p = d3.pointer(evt, app.canvas);
        var n = nodeAt(p[0], p[1]);
        setHover(n ? n.id : null);
        app.canvas.style.cursor = n ? 'pointer' : '';
      })
      .on('pointerleave.hover', function () {
        if (dragging) return;
        setHover(null);
        app.canvas.style.cursor = '';
      });

    if (cfg.drag) {
      var drag = d3.drag().container(app.canvas)
        .subject(function (evt) { return nodeAt(evt.x, evt.y); })
        .on('start', function (evt) {
          if (!evt.active) simulation.alphaTarget(1).restart();
          evt.subject.fx = evt.subject.x;
          evt.subject.fy = evt.subject.y;
          var x = (evt.x - currentTransform.x) / currentTransform.k - width / 2;
          var y = (evt.y - currentTransform.y) / currentTransform.k - height / 2;
          evt.subject.__dragOffset = { x: x - evt.subject.x, y: y - evt.subject.y };
          dragStartTime = Date.now();
          dragging = true;
          setHover(evt.subject.id);
        })
        .on('drag', function (evt) {
          var x = (evt.x - currentTransform.x) / currentTransform.k - width / 2;
          var y = (evt.y - currentTransform.y) / currentTransform.k - height / 2;
          evt.subject.fx = x - evt.subject.__dragOffset.x;
          evt.subject.fy = y - evt.subject.__dragOffset.y;
        })
        .on('end', function (evt) {
          if (!evt.active) simulation.alphaTarget(0);
          evt.subject.fx = null;
          evt.subject.fy = null;
          dragging = false;
          var p = evt.sourceEvent ? d3.pointer(evt.sourceEvent, app.canvas) : [-1, -1];
          var under = nodeAt(p[0], p[1]);
          setHover(under ? under.id : null);
          // a short press is a click: open the page
          if (Date.now() - dragStartTime < 500) open(evt.subject.id, evt.sourceEvent);
        });
      d3.select(app.canvas).call(drag);
    } else {
      d3.select(app.canvas).on('click.open', function (evt) {
        var p = d3.pointer(evt, app.canvas);
        var n = nodeAt(p[0], p[1]);
        if (n) open(n.id, evt);
      });
    }

    if (cfg.zoom) {
      var zoom = d3.zoom().extent([[0, 0], [width, height]]).scaleExtent([0.25, 8])
        .on('zoom', function (evt) {
          currentTransform = evt.transform;
          stage.scale.set(currentTransform.k, currentTransform.k);
          stage.position.set(currentTransform.x, currentTransform.y);
        });
      d3.select(app.canvas).call(zoom);
    }

    // start zoomed so the whole graph fits (as Obsidian does)
    function fitView() {
      if (!zoom || nodes.length === 0) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      nodes.forEach(function (n) {
        var r = nodeRadius(n);
        x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r);
        y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r);
      });
      // room for the labels: a margin at the sides and below
      var mx = 40, my = 28;
      var k = Math.min((width - 2 * mx) / Math.max(x1 - x0, 1), (height - 2 * my) / Math.max(y1 - y0, 1));
      k = Math.max(0.25, Math.min(k, 2));
      var cx = (x0 + x1) / 2 + width / 2, cy = (y0 + y1) / 2 + height / 2;
      d3.select(app.canvas).call(zoom.transform,
        d3.zoomIdentity.translate(width / 2 - cx * k, height / 2 - cy * k).scale(k));
    }

    var degreeOf = function (n) { return degree.get(n.simulationData.id) || 0; };

    // which labels show: they fade in as you zoom in (all of them on hover:
    // the hovered node and its neighbours), and a label that would overlap a
    // more important one (hovered, neighbour, current page, more links) is hidden
    function updateLabels() {
      var k = currentTransform.k;
      // fully shown from the default zoom, fading out as you zoom out
      var zoomAlpha = Math.min(1, Math.max(0, (k * cfg.opacityScale - 0.6) / 0.4));
      var hovering = hoveredNodeId !== null;
      var order = nodeRenderData.slice().sort(function (a, b) {
        return rank(b) - rank(a);
      });
      function rank(n) {
        var id = n.simulationData.id;
        if (id === hoveredNodeId) return 4e6;
        if (hovering && hoveredNeighbours.has(id)) return 3e6 + degreeOf(n);
        if (id === currentSlug) return 2e6;
        return degreeOf(n);
      }
      var grid = new Map();
      var CELL = 64;
      function cells(b, fn) {
        for (var cx = Math.floor(b[0] / CELL); cx <= Math.floor(b[2] / CELL); cx++) {
          for (var cy = Math.floor(b[1] / CELL); cy <= Math.floor(b[3] / CELL); cy++) {
            if (fn(cx + ',' + cy) === false) return false;
          }
        }
        return true;
      }
      order.forEach(function (n) {
        var d = n.simulationData;
        var id = d.id;
        var linked = hovering && hoveredNeighbours.has(id);
        var want = hovering && cfg.focusOnHover ? (linked ? 1 : zoomAlpha * FADED) : zoomAlpha;
        // the hovered node's label moves a little further away
        n.shift += ((id === hoveredNodeId ? LABEL_HOVER_SHIFT : 0) - n.shift) * 0.3;
        n.box = null;
        if (want > 0 && d.x != null) {
          // below the node (as in Obsidian), else above, right or left of it
          var p = screenPos(d);
          var off = nodeRadius(d) * k + LABEL_GAP + n.shift;
          var w = n.labelW, h = n.labelH, P = LABEL_PAD;
          var spots = [
            { side: 'below', b: [p.x - w / 2, p.y + off - P, p.x + w / 2, p.y + off + h - P] },
            { side: 'above', b: [p.x - w / 2, p.y - off - h + P, p.x + w / 2, p.y - off + P] },
            { side: 'right', b: [p.x + off - P, p.y - h / 2, p.x + off + w - P, p.y + h / 2] },
            { side: 'left', b: [p.x - off - w + P, p.y - h / 2, p.x - off + P, p.y + h / 2] }
          ];
          // the hovered node always gets a label (its neighbours come next)
          var must = id === hoveredNodeId;
          var spot = null;
          for (var si = 0; si < spots.length && !spot; si++) {
            var b = spots[si].b;
            // spots that would be cut off at the edge don't count
            var inside = b[0] >= 0 && b[1] >= 0 && b[2] <= width && b[3] <= height;
            var free = (id === hoveredNodeId && si === 0) || inside && cells(b, function (key) {
              var placed = grid.get(key);
              if (!placed) return true;
              for (var i = 0; i < placed.length; i++) {
                var o = placed[i];
                if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
              }
              return true;
            });
            if (free) spot = spots[si];
          }
          if (!spot && must) spot = spots[0];
          if (spot) {
            n.box = spot.b;
            if (n.side !== spot.side) {
              n.side = spot.side;
              n.label.anchor.set(spot.side === 'right' ? 0 : spot.side === 'left' ? 1 : 0.5,
                spot.side === 'below' ? 0 : spot.side === 'above' ? 1 : 0.5);
            }
            cells(spot.b, function (key) {
              if (!grid.has(key)) grid.set(key, []);
              grid.get(key).push(spot.b);
            });
          } else {
            want = 0;
          }
        }
        // ease towards the target so labels don't flicker while the layout settles
        n.label.alpha += (want - n.label.alpha) * 0.3;
        if (Math.abs(want - n.label.alpha) < 0.02) n.label.alpha = want;
        var s = 1 / k;
        n.label.scale.set(s, s);
        if (d.x != null) {
          var gap = nodeRadius(d) + (LABEL_GAP + n.shift) / k;
          var side = n.side;
          n.label.position.set(
            d.x + width / 2 + (side === 'right' ? gap : side === 'left' ? -gap : 0),
            d.y + height / 2 + (side === 'below' ? gap : side === 'above' ? -gap : 0));
        }
      });
    }

    var stopped = false;
    function animate() {
      if (stopped) return;
      nodeRenderData.forEach(function (n) {
        var x = n.simulationData.x, y = n.simulationData.y;
        if (x == null || y == null) return;
        n.gfx.position.set(x + width / 2, y + height / 2);
      });
      updateLabels();
      linkRenderData.forEach(function (l) {
        var d = l.simulationData;
        if (d.source.x == null || d.target.x == null) return;
        l.gfx.clear();
        l.gfx.moveTo(d.source.x + width / 2, d.source.y + height / 2);
        l.gfx.lineTo(d.target.x + width / 2, d.target.y + height / 2);
        l.gfx.stroke({ alpha: l.alpha, width: 1 / currentTransform.k, color: l.color });
      });
      requestAnimationFrame(animate);
    }

    // positions for scripts and tests (screen x/y of each node)
    container._perliteGraph = {
      nodes: function () {
        return nodes.map(function (n) {
          return { id: n.id, x: (n.x + width / 2) * currentTransform.k + currentTransform.x, y: (n.y + height / 2) * currentTransform.k + currentTransform.y };
        });
      },
      labels: function () {
        return nodeRenderData.map(function (n) { return { id: n.simulationData.id, alpha: n.label.alpha, box: n.box }; });
      },
      hovered: function () { return hoveredNodeId; },
      zoom: function () { return currentTransform.k; }
    };

    // lay the graph out before the first frame (Quartz animates it from random
    // positions, which makes the graph jump on every page change); notes kept
    // from the previous graph only need a nudge
    simulation.stop();
    if (known > nodes.length / 2) simulation.alpha(0.3);
    var settleUntil = performance.now() + PRESETTLE_MS;
    while (simulation.alpha() > 0.02 && performance.now() < settleUntil) {
      simulation.tick();
    }
    fitView();
    simulation.on('tick', function () { });
    simulation.restart();
    renderPixiFromD3();
    animate();

    function remember() {
      if (!layoutMemory[cfg.memory]) return;
      var m = layoutMemory[cfg.memory];
      m.clear();
      nodes.forEach(function (n) {
        if (n.x != null) m.set(n.id, { x: n.x, y: n.y });
      });
    }

    return function cleanup() {
      remember();
      stopped = true;
      simulation.stop();
      try { app.destroy(true); } catch (e) { }
    };
  }

  /* ---------- local graph (right sidebar) and global graph (overlay) ---------- */

  var GLOBAL_ICON = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 55 55" fill="currentColor"><path d="M49,0c-3.309,0-6,2.691-6,6c0,1.035,0.263,2.009,0.726,2.86l-9.829,9.829C32.542,17.634,30.846,17,29,17s-3.542,0.634-4.898,1.688l-7.669-7.669C16.785,10.424,17,9.74,17,9c0-2.206-1.794-4-4-4S9,6.794,9,9s1.794,4,4,4c0.74,0,1.424-0.215,2.019-0.567l7.669,7.669C21.634,21.458,21,23.154,21,25s0.634,3.542,1.688,4.897L10.024,42.562C8.958,41.595,7.549,41,6,41c-3.309,0-6,2.691-6,6s2.691,6,6,6s6-2.691,6-6c0-1.035-0.263-2.009-0.726-2.86l12.829-12.829c1.106,0.86,2.44,1.436,3.898,1.619v10.16c-2.833,0.478-5,2.942-5,5.91c0,3.309,2.691,6,6,6s6-2.691,6-6c0-2.967-2.167-5.431-5-5.910v-10.16c1.458-0.183,2.792-0.759,3.898-1.619l7.669,7.669C41.215,39.576,41,40.26,41,41c0,2.206,1.794,4,4,4s4-1.794,4-4s-1.794-4-4-4c-0.74,0-1.424,0.215-2.019,0.567l-7.669-7.669C36.366,28.542,37,26.846,37,25s-0.634-3.542-1.688-4.897l9.665-9.665C46.042,11.405,47.451,12,49,12c3.309,0,6-2.691,6-6S52.309,0,49,0z M11,9c0-1.103,0.897-2,2-2s2,0.897,2,2s-0.897,2-2,2S11,10.103,11,9z M6,51c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S8.206,51,6,51z M33,49c0,2.206-1.794,4-4,4s-4-1.794-4-4s1.794-4,4-4S33,46.794,33,49z M29,31c-3.309,0-6-2.691-6-6s2.691-6,6-6s6,2.691,6,6S32.309,31,29,31z M47,41c0,1.103-0.897,2-2,2s-2-0.897-2-2s0.897-2,2-2S47,39.897,47,41z M49,10c-2.206,0-4-1.794-4-4s1.794-4,4-4s4,1.794,4,4S51.206,10,49,10z"/></svg>';

  var localCleanup = null;
  var globalCleanup = null;
  var localToken = 0;
  var currentSlug = '';
  var callbacks = {};
  var resizeTimer = null;

  function localContainer(host) {
    var outer = host.querySelector(':scope > .graph-outer');
    if (!outer) {
      host.innerHTML = '';
      outer = document.createElement('div');
      outer.className = 'graph-outer perlite-quartz-graph';
      outer.innerHTML = '<div class="graph-container"></div><button class="global-graph-icon" aria-label="Global Graph" title="Global graph (Ctrl/Cmd + G)">' + GLOBAL_ICON + '</button>';
      host.appendChild(outer);
      outer.querySelector('.global-graph-icon').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleGlobal();
      });
      if (window.ResizeObserver) {
        var lastWidth = 0;
        new ResizeObserver(function () {
          var w = outer.offsetWidth;
          if (w && Math.abs(w - lastWidth) > 4) {
            var first = lastWidth === 0;
            lastWidth = w;
            if (first) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { renderLocal(host, currentSlug); }, 200);
          }
        }).observe(outer);
      }
    }
    return outer.querySelector('.graph-container');
  }

  var lastLocalHost = null;

  function renderLocal(host, slug) {
    currentSlug = slug;
    lastLocalHost = host;
    if (!host || !host.offsetParent) return; // hidden: rendered when shown
    var token = ++localToken;
    if (localCleanup) { localCleanup(); localCleanup = null; }
    var container = localContainer(host);
    renderGraph(container, slug, LOCAL_CONFIG, callbacks).then(function (cleanup) {
      if (token === localToken) localCleanup = cleanup;
      else cleanup();
    }).catch(function (e) { console.error('[Graph] Local render error:', e); });
  }

  function globalOverlay() {
    var outer = document.querySelector('.global-graph-outer.perlite-quartz-graph');
    if (!outer) {
      outer = document.createElement('div');
      outer.className = 'global-graph-outer perlite-quartz-graph';
      outer.innerHTML = '<div class="global-graph-container"></div>';
      document.body.appendChild(outer);
      outer.addEventListener('click', function (e) {
        if (!e.target.closest('.global-graph-container')) closeGlobal();
      });
    }
    return outer;
  }

  function isGlobalOpen() {
    var outer = document.querySelector('.global-graph-outer.perlite-quartz-graph');
    return !!(outer && outer.classList.contains('active'));
  }

  function openGlobal(slug) {
    if (slug !== undefined) currentSlug = slug;
    var outer = globalOverlay();
    outer.classList.add('active');
    if (globalCleanup) { globalCleanup(); globalCleanup = null; }
    renderGraph(outer.querySelector('.global-graph-container'), currentSlug, GLOBAL_CONFIG, callbacks).then(function (cleanup) {
      globalCleanup = cleanup;
    }).catch(function (e) { console.error('[Graph] Global render error:', e); });
  }

  function closeGlobal() {
    var outer = document.querySelector('.global-graph-outer.perlite-quartz-graph');
    if (outer) outer.classList.remove('active');
    if (globalCleanup) { globalCleanup(); globalCleanup = null; }
  }

  function toggleGlobal(slug) {
    if (isGlobalOpen()) closeGlobal();
    else openGlobal(slug);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isGlobalOpen()) {
      closeGlobal();
    }
  });

  /* ---------- follow theme changes ---------- */

  // the graph's colours are read when it's drawn, so redraw it when they
  // change: switching theme or light / dark mode, CSS snippets, accent colour.
  // A newly enabled stylesheet may still be loading, so check a few times.
  var themeKey = null;
  var themeTimer = null;

  function checkTheme() {
    var key = JSON.stringify(themeColors());
    if (themeKey !== null && key !== themeKey) {
      themeKey = key;
      cachedColorsChanged();
    } else {
      themeKey = key;
    }
  }

  function cachedColorsChanged() {
    if (lastLocalHost && lastLocalHost.isConnected && lastLocalHost.querySelector('.graph-container')) {
      renderLocal(lastLocalHost, currentSlug);
    }
    if (isGlobalOpen()) openGlobal();
  }

  function watchTheme() {
    var tries = 0;
    clearInterval(themeTimer);
    checkTheme();
    themeTimer = setInterval(function () {
      checkTheme();
      if (++tries >= 20) clearInterval(themeTimer);
    }, 100);
  }

  function isStyleNode(node) {
    return node && (node.nodeName === 'LINK' || node.nodeName === 'STYLE');
  }

  if (window.MutationObserver) {
    // stylesheets enabled, disabled, added or removed anywhere in the page
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (isStyleNode(m.target) ||
          Array.prototype.some.call(m.addedNodes, isStyleNode) ||
          Array.prototype.some.call(m.removedNodes, isStyleNode)) {
          watchTheme();
          return;
        }
      }
    }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'href', 'media']
    });
    // light / dark mode and settings stored as classes or inline styles
    new MutationObserver(watchTheme).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    new MutationObserver(watchTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  // a stylesheet that finished loading
  document.addEventListener('load', function (e) {
    if (isStyleNode(e.target)) watchTheme();
  }, true);

  window.PerliteQuartzGraph = {
    setCallbacks: function (cb) { callbacks = cb || {}; },
    renderLocal: renderLocal,
    openGlobal: openGlobal,
    closeGlobal: closeGlobal,
    toggleGlobal: toggleGlobal,
    isGlobalOpen: isGlobalOpen,
    clearLocal: function (host) {
      localToken++;
      if (localCleanup) { localCleanup(); localCleanup = null; }
      if (host) host.innerHTML = '';
    },
    invalidate: function () {
      // new graph data: re-read it on the next render
      cachedData = null;
    },
    rerender: function (host) {
      cachedData = null;
      renderLocal(host, currentSlug);
      if (isGlobalOpen()) openGlobal();
    }
  };
})();
