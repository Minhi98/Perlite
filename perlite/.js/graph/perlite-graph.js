/*!
 * Perlite: Quartz-style graph view.
 * A port of the graph component of Quartz (https://github.com/jackyzha0/quartz,
 * @quartz-community/graph, MIT License, (c) jackyzha0 and contributors):
 * D3 force simulation, PixiJS (WebGL) rendering, local graph (depth 1) and a
 * global graph (all notes, radial layout, focus on hover), tags as nodes,
 * visited pages, labels that fade in with zoom, drag / zoom, Ctrl/Cmd + G.
 * Data comes from Perlite's graph (#allGraphNodes / #allGraphEdges, built from
 * the Metadata Extractor plugin's metadata.json); colours from the theme's
 * Obsidian graph colours.
 */
(function () {
  'use strict';

  var d3 = window.d3;
  var PIXI = window.PIXI;

  var LOCAL_CONFIG = {
    drag: true, zoom: true, depth: 1, scale: 1.1, repelForce: 0.5, centerForce: 0.3,
    linkDistance: 30, fontSize: 0.6, opacityScale: 1, showTags: true, removeTags: [],
    focusOnHover: false, enableRadial: false
  };
  var GLOBAL_CONFIG = {
    drag: true, zoom: true, depth: -1, scale: 0.9, repelForce: 0.5, centerForce: 0.2,
    linkDistance: 30, fontSize: 0.6, opacityScale: 1, showTags: true, removeTags: [],
    focusOnHover: true, enableRadial: true
  };

  var VISITED_KEY = 'perlite-graph-visited';

  function getVisited() {
    try {
      return new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || '[]'));
    } catch (e) {
      return new Set();
    }
  }

  function addVisited(slug) {
    if (!slug) return;
    try {
      var visited = getVisited();
      visited.add(slug);
      localStorage.setItem(VISITED_KEY, JSON.stringify(Array.from(visited)));
    } catch (e) { }
  }

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
    return {
      current: probeColor('graph-view color-fill-focused', '#c792ea'),   // Quartz --secondary
      visited: probeColor('graph-view color-fill-highlight', '#82aaff'), // Quartz --tertiary
      tagStroke: probeColor('graph-view color-fill-tag', '#82aaff'),
      node: probeColor('graph-view color-fill', '#6c6c6c'),              // Quartz --gray
      line: probeColor('graph-view color-line', '#d4d4d4'),              // Quartz --lightgray
      text: probeColor('graph-view color-text', '#1a1a1a'),              // Quartz --dark
      tagFill: body.getPropertyValue('--background-primary').trim() || '#f5f5f5', // Quartz --light
      font: body.getPropertyValue('--font-interface').trim() || body.fontFamily || 'inherit'
    };
  }

  /* ---------- render (Quartz's renderGraph) ---------- */

  async function renderGraph(container, currentSlug, cfg, callbacks) {
    var data = graphData();
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!data) return function () { };

    var visited = getVisited();
    var width = container.offsetWidth;
    var height = Math.max(container.offsetHeight, 250);
    if (!width) return function () { };

    var links = [];
    var tagSlugs = [];
    var validSlugs = new Set(data.keys());
    data.forEach(function (page, source) {
      page.links.forEach(function (target) {
        if (validSlugs.has(target)) links.push({ source: source, target: target });
      });
      if (cfg.showTags) {
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
        x: Math.random() * width - width / 2,
        y: Math.random() * height - height / 2,
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

    var colors = themeColors();

    var app = new PIXI.Application();
    await app.init({
      width: width, height: height, antialias: true, backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1, autoDensity: true, eventMode: 'static'
    });
    container.appendChild(app.canvas);

    var stage = new PIXI.Container();
    app.stage.addChild(stage);

    var degree = new Map();
    simLinks.forEach(function (l) {
      degree.set(l.source.id, (degree.get(l.source.id) || 0) + 1);
      degree.set(l.target.id, (degree.get(l.target.id) || 0) + 1);
    });
    function nodeRadius(n) {
      return 2 + Math.sqrt(degree.get(n.id) || 0);
    }

    var simulation = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-100 * cfg.repelForce))
      .force('center', d3.forceCenter().strength(cfg.centerForce))
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
      if (n.id === currentSlug) return colors.current;
      if (visited.has(n.id) || n.id.startsWith('tags/')) return colors.visited;
      return colors.node;
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

    function renderLinks() {
      linkRenderData.forEach(function (l) {
        l.alpha = hoveredNodeId !== null ? (l.active ? 1 : 0.2) : 1;
        l.color = l.active ? colors.node : colors.line;
      });
    }

    function renderLabels() {
      var defaultScale = 1 / cfg.scale;
      var activeScale = defaultScale * 1.1;
      nodeRenderData.forEach(function (n) {
        if (hoveredNodeId === n.simulationData.id) {
          n.label.alpha = 1;
          n.label.scale.set(activeScale);
        } else {
          n.label.scale.set(defaultScale);
        }
      });
    }

    function renderNodes() {
      nodeRenderData.forEach(function (n) {
        n.gfx.alpha = hoveredNodeId !== null && cfg.focusOnHover ? (n.active ? 1 : 0.2) : 1;
      });
    }

    function renderPixiFromD3() {
      renderNodes();
      renderLinks();
      renderLabels();
    }

    nodes.forEach(function (n) {
      var isTag = n.id.startsWith('tags/');
      var label = new PIXI.Text({
        text: n.text,
        style: { fontSize: cfg.fontSize * 15, fill: colors.text, fontFamily: colors.font },
        resolution: (window.devicePixelRatio || 1) * 4
      });
      label.anchor.set(0.5, 1.2);
      label.alpha = 0;
      label.scale.set(1 / cfg.scale);
      labelContainer.addChild(label);

      var gfx = new PIXI.Graphics();
      gfx.circle(0, 0, nodeRadius(n));
      gfx.fill({ color: isTag ? colors.tagFill : nodeColor(n) });
      if (isTag) gfx.stroke({ width: 2, color: colors.tagStroke });
      gfx.eventMode = 'static';
      gfx.cursor = 'pointer';
      gfx.label = n.id;

      var savedAlpha = 0;
      gfx.on('pointerover', function () {
        updateHoverInfo(n.id);
        savedAlpha = label.alpha;
        if (!dragging) renderPixiFromD3();
      });
      gfx.on('pointerleave', function () {
        updateHoverInfo(null);
        label.alpha = savedAlpha;
        if (!dragging) renderPixiFromD3();
      });

      nodeContainer.addChild(gfx);
      nodeRenderData.push({ simulationData: n, gfx: gfx, label: label, color: nodeColor(n), alpha: 1, active: false });
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

    if (cfg.drag) {
      var findNode = function (evt) {
        var x = (evt.x - currentTransform.x) / currentTransform.k;
        var y = (evt.y - currentTransform.y) / currentTransform.k;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var dx = x - n.x - width / 2, dy = y - n.y - height / 2;
          if (Math.sqrt(dx * dx + dy * dy) < nodeRadius(n) + 5) return n;
        }
        return null;
      };
      var drag = d3.drag().container(app.canvas).subject(findNode)
        .on('start', function (evt) {
          if (!evt.active) simulation.alphaTarget(1).restart();
          evt.subject.fx = evt.subject.x;
          evt.subject.fy = evt.subject.y;
          var x = (evt.x - currentTransform.x) / currentTransform.k - width / 2;
          var y = (evt.y - currentTransform.y) / currentTransform.k - height / 2;
          evt.subject.__dragOffset = { x: x - evt.subject.x, y: y - evt.subject.y };
          dragStartTime = Date.now();
          dragging = true;
          hoveredNodeId = evt.subject.id;
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
          updateHoverInfo(null);
          renderPixiFromD3();
          // a short press is a click: open the page
          if (Date.now() - dragStartTime < 500) open(evt.subject.id, evt.sourceEvent);
        });
      d3.select(app.canvas).call(drag);
    } else {
      nodeRenderData.forEach(function (n) {
        n.gfx.on('click', function (e) { open(n.simulationData.id, e); });
      });
    }

    if (cfg.zoom) {
      var zoom = d3.zoom().extent([[0, 0], [width, height]]).scaleExtent([0.25, 4])
        .on('zoom', function (evt) {
          currentTransform = evt.transform;
          stage.scale.set(currentTransform.k, currentTransform.k);
          stage.position.set(currentTransform.x, currentTransform.y);
          // labels fade in as you zoom in
          var scale = currentTransform.k * cfg.opacityScale;
          var scaledOpacity = Math.max((scale - 1) / 3.75, 0);
          var activeLabels = nodeRenderData.filter(function (n) { return n.active; }).map(function (n) { return n.label; });
          labelContainer.children.forEach(function (label) {
            if (activeLabels.indexOf(label) === -1) label.alpha = scaledOpacity;
          });
        });
      d3.select(app.canvas).call(zoom);
    }

    var stopped = false;
    function animate() {
      if (stopped) return;
      nodeRenderData.forEach(function (n) {
        var x = n.simulationData.x, y = n.simulationData.y;
        if (x == null || y == null) return;
        n.gfx.position.set(x + width / 2, y + height / 2);
        if (n.label) n.label.position.set(x + width / 2, y + height / 2);
      });
      linkRenderData.forEach(function (l) {
        var d = l.simulationData;
        if (d.source.x == null || d.target.x == null) return;
        l.gfx.clear();
        l.gfx.moveTo(d.source.x + width / 2, d.source.y + height / 2);
        l.gfx.lineTo(d.target.x + width / 2, d.target.y + height / 2);
        l.gfx.stroke({ alpha: l.alpha, width: 1, color: l.color });
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
        return nodeRenderData.map(function (n) { return { id: n.simulationData.id, alpha: n.label.alpha }; });
      }
    };

    simulation.on('tick', function () { });
    simulation.restart();
    renderPixiFromD3();
    animate();

    return function cleanup() {
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

  function renderLocal(host, slug) {
    currentSlug = slug;
    addVisited(slug);
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
