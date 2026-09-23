/// <reference path="jquery.min.js" />

/*!
  * Perlite (https://github.com/secure-77/Perlite)
  * Author: sec77 (https://secure77.de)
  * Licensed under MIT (https://github.com/secure-77/Perlite/blob/main/LICENSE)
*/


//// load default settings


// define home file
var homeFile = "README";

if ($('#index').data('option')) {
  homeFile = $('#index').data('option');
}

// define uri path
var uriPath = '/'

if ($('#uri_path').data('option')) {
  uriPath = $('#uri_path').data('option');
}

// disable pophovers
if ($('#disablePopHovers').data('option') == true && localStorage.getItem("disablePopUp") === null) {

  $('#disablePopUp').addClass('is-enabled')
  localStorage.setItem('disablePopUp', 'true');

}

// show toc
if ($('#showTOC').data('option') == false || localStorage.getItem("showTOC") === false) {

  localStorage.setItem("showTOC", "false")
  $('#outline').css('display', 'none')
}

if ($('#showLocalGraph').data('option') == false || localStorage.getItem("showLocalGraph") === false) {

  localStorage.setItem("showLocalGraph", "false")
  $('#localGraph').css('display', 'none')
}


/**
 * unslugURL
 * @param {String} targetPath
 */
function unslugURL(targetPath) {

  // "/Folder/Note/" is the same page as "/Folder/Note"
  if (targetPath.length > 1) {
    targetPath = targetPath.replace(/\/+$/, '');
  }

  decodedURI = decodeURIComponent(targetPath);
  decodedURI = decodedURI.replaceAll('-', ' ')
  decodedURI = decodedURI.replaceAll('~', '-')
  decodedURI = decodedURI.replaceAll('%80', '~')

  // when perlite is in subdirectory remove it for content retrieval 
  if (decodedURI.startsWith(uriPath)) {
    decodedURI = decodedURI.substring(uriPath.length - 1)
  }

  return decodedURI;
}

/**
 * slugURL
 * @param {String} targetPath
 */
function slugURL(targetPath) {

  encodedURI = decodeURIComponent(targetPath)
  encodedURI = encodedURI.replaceAll('~', '%80')
  encodedURI = encodedURI.replaceAll('-', '~')
  encodedURI = encodedURI.replaceAll(' ', '-')

  // remove absolute path
  if (encodedURI.substring(0, 1) == '/') {
    encodedURI = encodedURI.substring(1)
  }

  // when perlite is in subdirectory remove it for content retrieval 
  if (encodedURI.startsWith(uriPath)) {
    encodedURI = encodedURI.substring(uriPath.length - 1)
  }


  return encodedURI;
}



/**
 * scroll to anchor
 * @param {String} aid
 */
function scrollToAnchor(aid, instant) {
  var target = findAnchorTarget(aid);
  if (!target) {
    return false;
  }
  target.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
  return true;
}

/**
 * find the element a #hash points to in the note: an exact id / name first
 * (footnotes, copied heading links), then a heading whose text matches.
 * Heading matching ignores case, spaces, "-" and "_" (links use "My-Header",
 * the outline uses "My_Header", copied links "my-header", Obsidian "My%20Header").
 * @param {String} aid
 */
function normalizeAnchor(text) {
  return text.replace(/[\s_-]+/g, ' ').trim().toLowerCase();
}

function looseAnchor(text) {
  return normalizeAnchor(text).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

function findAnchorTarget(aid) {
  var raw = String(aid || '').replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch (e) { }
  var root = document.getElementById('mdContent');
  if (!raw || !root) {
    return null;
  }
  // nested heading links ([[Page#Chapter#Section]]) go to the last heading
  if (raw.indexOf('#') !== -1 && !document.getElementById(raw)) {
    raw = raw.split('#').filter(Boolean).pop() || raw;
  }

  var byId = document.getElementById(raw);
  if (byId && root.contains(byId)) {
    return byId;
  }
  var named = Array.from(root.querySelectorAll('a[name]')).find(function (a) {
    return a.getAttribute('name') === raw;
  });
  if (named) {
    return named.closest('h1, h2, h3, h4, h5, h6') || named;
  }

  // headings of this note first, then ones inside embedded notes
  var headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  headings.sort(function (a, b) {
    return (a.closest('.markdown-embed') ? 1 : 0) - (b.closest('.markdown-embed') ? 1 : 0);
  });
  var headingText = function (h) {
    var copy = h.cloneNode(true);
    copy.querySelectorAll('.copy-icon').forEach(function (c) { c.remove(); });
    return copy.textContent;
  };
  var want = normalizeAnchor(raw);
  var match = headings.find(function (h) { return normalizeAnchor(headingText(h)) === want; });
  if (!match) {
    want = looseAnchor(raw);
    match = want ? headings.find(function (h) { return looseAnchor(headingText(h)) === want; }) : null;
  }
  return match || null;
}


/**
 * get markdown content
 * @param {String} str
 * @param {Boolean} home
 * @param {Boolean} popHover
 * @param {String} anchor
 */
function getContent(str, home = false, popHover = false, anchor = "") {

  // reset content if request is empty
  if (str.length == 0) {
    document.getElementById("mdContent").innerHTML = "";
    document.getElementsByClassName("modal-body")[0].innerHTML = "";
    return;
  } else {

    requestPath = uriPath + "content.php?mdfile=" + str;

    if (home) {
      if ($("div.no-mobile").css("display") == "none") {
        return
      }
      requestPath = uriPath + "content.php?home";

    }

    mdContent = $("#mdContent")[0]


    $.ajax({
      url: requestPath, success: function (result) {

        if (popHover == false) {

          // set content
          $("#mdContent").html(result);

          // cssclasses from the note's front matter -> page container (like Obsidian)
          var previewView = $("#mdContent").closest(".markdown-preview-view");
          previewView.removeClass(previewView.data("perliteCssclasses") || "");
          var noteClasses = $("#mdContent > .perlite-cssclasses").data("cssclasses") || "";
          previewView.addClass(noteClasses).data("perliteCssclasses", noteClasses);

          // set word and char count
          $("#wordCount").text($(".wordCount").text() + ' words');
          $("#charCount").text($(".charCount").text() + ' characters');

          // set Browser, document title and nav path
          var title = $("div.mdTitleHide").first().text();
          if (title) {

            //hrefTitle = '<a href=?link=' + encodeURIComponent(title) + '>' + title + '</a>'
            title = title.substring(1)
            var notePath = title; // full path in the vault, e.g. "Settings/The City/index"
            titleElements = title.split('/')
            title = titleElements.splice(-1)
            parentTitle = titleElements.join(' / ')
            if (parentTitle) {
              parentTitle = parentTitle + ' / ';
            }
            $("div.view-header-title-parent").text(parentTitle);
            $("div.view-header-title").text(title);
            $(".inline-title").text(title);

            $("title").text(title + ' - ' + $("p.vault").text() + ' - ' + $("p.perliteTitle").text());

            // set edit button url: the full path, not just the file name, so notes
            // with the same name (e.g. several index.md) open the right one
            $('.clickable-icon.view-action[aria-label="Click to edit"]')
              .attr("href", "obsidian://open?vault=" + encodeURIComponent($("p.vault").text()) + "&file=" + encodeURIComponent(notePath))
          }

          // Outlines
          // built from the note's headings (including ones that contain links or
          // formatting); headings inside embedded notes are left out, like Obsidian
          var toc = "";
          var level = 0;
          var escapeHtml = function (text) {
            return $('<div>').text(text).html().replace(/"/g, '&quot;');
          };

          document.querySelectorAll('#mdContent h1, #mdContent h2, #mdContent h3, #mdContent h4, #mdContent h5, #mdContent h6').forEach(function (heading) {

            if (heading.closest('.markdown-embed')) {
              return;
            }
            var titleText = heading.textContent.trim();
            if (!titleText) {
              return;
            }
            var openLevel = parseInt(heading.tagName.substring(1));

            if (openLevel > level) {
              toc += (new Array(openLevel - level + 1)).join('<div class="tree-item tree-item-children">');
            } else if (openLevel < level) {
              toc += (new Array(level - openLevel + 1)).join("</div>");
            }

            level = openLevel;

            var anchor = titleText.replace(/ /g, "_");
            toc += '<div class="tree-item-self is-clickable toc-item"><a href="#' + escapeHtml(anchor) + '">' + escapeHtml(titleText)
              + '</a></div>';

            if (!heading.querySelector(':scope > a[name]')) {
              var named = document.createElement('a');
              named.setAttribute('name', anchor);
              heading.insertBefore(named, heading.firstChild);
            }
          });

          if (level) {
            toc += (new Array(level + 1)).join("</div></div>");
          }

          document.getElementById("toc").innerHTML = toc;


          // add Image Click popup
          $(".pop").on("click", function () {

            // an image inside a link ([![[img.png]]](Note.md)) follows the link
            if ($(this).closest("a").length) {
              return;
            }

            var path = $(this).find("img").attr("src");
            result = '<div class="modal-body imgModalBody"><img src="' + path + '" class="imagepreview"></div>';
            $("#img-content").html(result);
            $(".modal").css("width", "unset");
            $(".modal").css("height", "unset");
            $(".modal").css("max-width", "100%");
            $(".modal").css("max-height", "100%");
            $(".img-modal-title").text("Image preview");
            $("#img-modal").css("display", "flex");

            // fit the preview to the screen (CSS limits width and height), then
            // pin that width so the dialog shrinks around the image
            var previewImg = $("#img-content img.imagepreview")[0];
            if (previewImg) {
              window.fitImagePreview = function () {
                if (!previewImg.isConnected || $("#img-modal").css("display") === "none") {
                  return;
                }
                previewImg.style.width = "";
                var fittedWidth = previewImg.getBoundingClientRect().width;
                if (fittedWidth) {
                  previewImg.style.width = fittedWidth + "px";
                }
              };
              if (previewImg.complete) {
                window.fitImagePreview();
              } else {
                previewImg.onload = window.fitImagePreview;
              }
            }

          });


          // trigger graph render on side bar
          renderGraph(false, str);

          //resize graph on windows rezise
          $(window).resize(function () {
            renderGraph(false, str, false);
          });


          // update the url
          if (home == false) {

            target = slugURL(str)
            window.history.pushState({}, "", location.protocol + '//' + location.host + uriPath + target + anchor);

          }

          // add Tag section
          $('#mytags').html("")
          $('.tag').each(function (index) {
            const count = index + 1;
            const originalHTML = $(this).prop('outerHTML');
            const countTag = '<div class="tree-item-flair-outer"><span class="tree-item-flair" id="nodeCount">' + count + '</span></div>';
            $('#mytags').append(originalHTML);
          });

          // hide them when no tags are found
          if ($('#mytags').html() == "") {
            $('#tags_container').css('display', 'none')
          } else {
            $('#tags_container').css('display', 'block')
          }


          // on Tag click -> start search
          $('.tag').click(function (e) {

            e.preventDefault();

            target = $(e.target);
            $('.workspace-tab-header[data-type="search"]').click();
            $('*[type="search"]').val(this.text);
            search(this.text);

            // on mobile go to search
            if ($(window).width() < 990) {

              $('.workspace').addClass('is-left-sidedock-open');
              $('.mod-left-split').removeClass('is-sidedock-collapse');
              $('.mod-left').removeClass('is-collapsed');
              $('.workspace-ribbon.side-dock-ribbon.mod-left').css('display', 'flex');

            }

          });

          // Toogle Front Matter Meta Container
          $('.metadata-properties-heading').click(function (e) {

            e.preventDefault();

            if ($('.metadata-container').hasClass('is-collapsed')) {
              $('.metadata-container').removeClass('is-collapsed');
            } else {
              $('.metadata-container').addClass('is-collapsed');
            }

          });

          // Toogle Collapsable Callout Container
          // (whole title bar toggles like Obsidian; only this callout, not nested ones)
          $('.callout.is-collapsible > .callout-title').off('click.perliteCallout').on('click.perliteCallout', function (e) {

            // let links inside the title work normally
            if ($(e.target).closest('a').length) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();

            var callout = $(this).parent();
            var collapsed = !callout.hasClass('is-collapsed');

            callout.toggleClass('is-collapsed', collapsed);
            callout.children('.callout-content').toggleClass('is-collapsed-callout', collapsed);
            $(this).children('.callout-fold').toggleClass('is-collapsed', collapsed);

          });

          // popHover (on hover internal links)
          target = $('.disablePopUp')

          if (!target.hasClass('is-enabled')) {

            var currentMousePos = { x: -1, y: -1 };
            $(document).mousemove(function (event) {
              currentMousePos.x = event.pageX;
              currentMousePos.y = event.pageY;
            });

            stopThis = false;
            // enter the hover box
            $('.popover.hover-popover').mouseenter(function (e) {
              stopThis = true
              $('.popover.hover-popover').css('display', 'unset');
            })
            // leave the hover box
            $('.popover.hover-popover').mouseleave(function (e) {
              e.preventDefault();

              hoverTimer = setTimeout(function () {

                $('.popover.hover-popover').css('display', 'none');
                stopThis = false;

              }, 500);
            })

            // leave the link
            $('.internal-link').mouseleave(function (e) {
              e.preventDefault();

              hoverTimer = setTimeout(function () {

                if (stopThis == false) {
                  $('.popover.hover-popover').css('display', 'none');
                }
              }, 1200);
            })

            $('.internal-link').mouseenter(function (e) {
              e.preventDefault();

              // update position for hover element
              $('.popover.hover-popover').css({ top: currentMousePos.y, left: currentMousePos.x });

              const urlParams = new URLSearchParams(this.href.split('?')[1]);
              if (urlParams.has('link')) {
                var target = urlParams.get('link');
                target = encodeURIComponent(target);
              } else {
                target = unslugURL(this.pathname)
                target = encodeURIComponent(target);                      
              }


              if (this.href.split('#').length > 1) {
                return;
              }

              // get content of link
              if (target) {
                getContent(target, false, true)
              }

            });

          }


          //check setting if metadata is collapsed or not
          if ($('.metadataOption').hasClass('is-enabled')) {
            $('.metadata-properties-heading').trigger('click')
          }
          mdContent = $("#mdContent")[0]

        // handle pop up and hover
        } else {

          
          if (result.trim() == "") {
            return;
          }
          // set content
          $("#mdHoverContent").html(result);
          $("#popUpContent").html(result);

          // set title
          var title = $("div.mdTitleHide").eq(1).text() || "";
          title = title.substring(1)
          titleElements = title.split('/')
          title = titleElements.splice(-1)
          $(".inline-title.pophover-title").text(title);
          $(".popup-modal-title").text(title);


          // show pophover
          $('.popover.hover-popover').css('display', 'unset');

          mdContent = $("#mdHoverContent")[0]

        }

        // highlight code
        hljs.highlightAll();

        var snippets = document.getElementsByTagName('pre');
        var numberOfSnippets = snippets.length;
        for (var i = 0; i < numberOfSnippets; i++) {
          //code = snippets[i].getElementsByTagName('code')[0].innerText;

          snippets[i].classList.add('hljs'); // append copy button to pre tag

          snippets[i].innerHTML = '<button class="copy-code-button">Copy</button>' + snippets[i].innerHTML; // append copy button

          snippets[i].getElementsByClassName('copy-code-button')[0].addEventListener("click", function () {
            this.innerText = 'Copying..';
            button = this;
            code = $(button).next()[0].innerText
            navigator.clipboard.writeText(code).then(function () {
              button.innerText = 'Copied!';
            }, function (err) {
              button.innerText = 'Cant Copy!';
              console.error('Async: Could not copy Code: ', err);
            });

            setTimeout(function () {
              button.innerText = 'Copy';
            }, 1000)

          });
        }


      // Add copyable anchors to all headings (h1–h6)
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
        
        // Skip if heading already has a copy icon
        if (heading.querySelector(".copy-icon")) return;
        
        // Ensure each heading has an ID (generate one if missing)
        if (!heading.id) {
          let headingId = heading.textContent
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^\w-]/g, "");
          // don't reuse an id that already exists (e.g. a "Settings" heading
          // would hijack the #settings modal and break the cogwheel)
          if (headingId && document.getElementById(headingId)) {
            headingId = "h-" + headingId;
            let n = 2;
            while (document.getElementById(headingId + (n > 2 ? "-" + (n - 1) : ""))) n++;
            if (n > 2) headingId += "-" + (n - 1);
          }
          heading.id = headingId;
        }

        // Create the copy icon
        const copyLink = document.createElement("span");
        copyLink.className = "copy-icon";
        copyLink.textContent = "#";
        copyLink.title = "Copy link to clipboard";

        // Append the icon to the heading
        heading.appendChild(copyLink);

        // Add click event to copy link
        copyLink.addEventListener("click", (event) => {
          event.preventDefault();
          const url = `${window.location.origin}${window.location.pathname}#${heading.id}`;
          navigator.clipboard.writeText(url);

          // Visual feedback
          copyLink.classList.add("copied");
          copyLink.textContent = "✅";
          setTimeout(() => {
            copyLink.textContent = "#";
            copyLink.classList.remove("copied");
          }, 1000);
        });
      });


        // run mobile settings
        isMobile();

        //render LaTeX (Katex)
        renderMathInElement(mdContent,
          {
            delimiters: [
              { left: "$$", right: "$$", display: true },
              { left: "\\[", right: "\\]", display: true },
              { left: "$", right: "$", display: false },
              { left: "\\(", right: "\\)", display: false }
            ]
          }
        );

        // clean internal links in mermaid elements
        var mermaids = document.getElementsByClassName("language-mermaid");

        for (var i = 0; i < mermaids.length; i++) {

          var mermaidLinks = mermaids[i].getElementsByTagName('a');

          for (f = 0; f < mermaidLinks.length;) {

            var linkElement = mermaidLinks[f]

            if (linkElement.getAttribute("href").startsWith(uriPath)) {

              var textonly = '[[' + linkElement.innerHTML + ']]';
              linkElement.replaceWith(textonly)
            }

          }

        }

        //render mermaid
        mermaid.init(undefined, document.querySelectorAll(".language-mermaid"));

        //scroll to anchor

        if (anchor != "" && popHover == false) {
          var anchorId = anchor.substring(1);
          scrollToAnchor(anchorId);

          // images above the heading can finish loading later and push it down:
          // scroll again once they have loaded (for up to 3 seconds)
          var pendingImages = $('#mdContent img').filter(function () { return !this.complete; });
          if (pendingImages.length) {
            var waitUntil = Date.now() + 3000;
            var remaining = pendingImages.length;
            pendingImages.one('load error', function () {
              remaining--;
              if (remaining === 0 && Date.now() < waitUntil) {
                scrollToAnchor(anchorId, true);
              }
            });
          }
        }


      }
    });
  }
};

/**
 * Gets the state of the graph setting inputs as a list.
 * The options in order are: \
 * [showNoLinks, showTags, sizeDepsOnConns]
 * @returns {Array}
 */
function getGraphConfig() {
  var showNoLinks = !$(".graphNoLinkOption").hasClass('is-enabled')
  var showTags = $(".graphShowTagsOption").hasClass("is-enabled")
  var sizeDepsOnConns = $(".graphSizeDepsOnConnsOption").hasClass("is-enabled")

  return [showNoLinks, showTags, sizeDepsOnConns];
}

/**
 * vis js stuff
 * @param {Boolean} modal
 * @param {String} path
 * @param {Boolean} filter_emptyNodes
 * @param {Boolean} show_tags
 * @param {Boolean} sizeDepsOnConns
 */
/**
 * set the "Linked mentions" count in the right sidebar; the row is hidden when it is 0
 * @param {Number} count
 */
function setLinkedMentionsCount(count) {
  var flair = $('#nodeCount');
  flair.text(count);
  flair.closest('.tree-item-self').css('display', count > 0 ? '' : 'none');
}

function renderGraph(modal, path = "", filter_emptyNodes = false, show_tags = true, sizeDepsOnConns = false) {

  // start each page at 0 (hidden) so a page without graph data never shows the previous page's count
  if (!modal) {
    setLinkedMentionsCount(0);
  }

  // no graph found exit
  if ($("#allGraphNodes").length == 0 || $("#allGraphNodes").text == '[]') {
    console.log("Graph: no data found")
    document.getElementById("random_note").style.display = "none";
    return;
  }


  var visNodes = document.getElementById('allGraphNodes').textContent;
  var visEdges = document.getElementById('allGraphEdges').textContent;

  var jsonNodes = JSON.parse(visNodes);
  var jsonEdges = JSON.parse(visEdges);

  var currId = 0;
  path = decodeURIComponent(path);
  if (path == 'home') {
    path = '/' + homeFile;
  }


  // reset backlings count

  $('#backlinksCount').text(0);

  // get current node
  for (const x in jsonNodes) {
    if (path == ('/' + (jsonNodes[x]['title']).replace('&amp;', '&'))) {
      currId = jsonNodes[x]['id'];
      break;
    }
    else if (modal == false) {
      currId = -1;
    }
  }

  // cancel graph display if no node was found
  if (currId == -1) {
    return;
  }

  // Graph Defaults

  nodeSize = parseInt($('.slider.nodeSize').val())
  varLinkDistance = parseInt($('.slider.linkDistance').val())
  varLinkThickness = parseFloat($('.slider.linkThickness').val())
  varGraphStyle = $('#graphStyleDropdown').val()


  var options = {
    interaction: {
      hover: true,
    },
    layout: {
      improvedLayout: true,
      clusterThreshold: 10000,
    },
    physics: {
      solver: 'forceAtlas2Based',
      solver: 'barnesHut',
      enabled: true,
      stabilization: {
        enabled: true,
        iterations: 1000,
        updateInterval: 10,
        onlyDynamicEdges: false,
        fit: true
      }
    },
    // configure: {
    //   enabled: true,
    //   filter: 'nodes,edges',
    //   container: container,
    //   showButton: true
    // } ,
    edges: {
      length: varLinkDistance,
      width: varLinkThickness,
      color: getComputedStyle(document.querySelector('.graph-view.color-line')).color,
      smooth: {
        type: varGraphStyle,
        enabled: true,
      }
    },

    nodes: {
      shape: 'dot',
      size: nodeSize,
      scaling: {
        min: 10,
        max: 30
      },
      font: {
        size: 16,
        color: getComputedStyle(document.querySelector('.graph-view.color-text')).color,
      },
      borderWidth: 1,
      color: {
        background: getComputedStyle(document.querySelector('.graph-view.color-fill')).color,
        border: getComputedStyle(document.querySelector('.graph-view.color-fill')).color,
        highlight: {
          border: getComputedStyle(document.querySelector('.graph-view.color-fill')).color,
          background: getComputedStyle(document.querySelector('.graph-view.color-fill')).color,
        },
        hover: {
          border: getComputedStyle(document.querySelector('.graph-view.color-fill')).color,
          background: getComputedStyle(document.querySelector('.graph-view.color-fill-highlight')).color,
        },
      },
    },

    groups: {
      tag: {
        color: {
          background: getComputedStyle(document.querySelector('.graph-view.color-fill-tag')).color,
          border: getComputedStyle(document.querySelector('.graph-view.color-fill-tag')).color,
          highlight: {
            border: getComputedStyle(document.querySelector('.graph-view.color-fill-tag')).color,
            background: getComputedStyle(document.querySelector('.graph-view.color-fill-tag')).color,
          },
        }
      }
    }
  };

  var network;

  // show the whole graph
  if (modal) {

    var container_modal = document.getElementById('graph_all');

    var nodes = new vis.DataSet(jsonNodes);
    var edges = new vis.DataSet(jsonEdges);

    edgeView = edges;
    nodeView = nodes;

    if (filter_emptyNodes) {
      nodeView = new vis.DataView(nodes, {
        filter: function (node) {
          connEdges = edgeView.get({
            filter: function (edge) {
              if (node.id == currId) {
                return true;
              }
              return (
                (edge.to == node.id) || (edge.from == node.id));
            }
          });
          return connEdges.length > 0;
        }
      });

    }

    // filter out tags
    if (!show_tags) {
      nodeView = new vis.DataView(nodes, {
        filter: function (node) {
          return !(node.group && node.group === "tag");
        }
      })
    }

    // overwrite scaling function to make all nodes the same size
    if (!sizeDepsOnConns) {
      options["nodes"]["scaling"]["customScalingFunction"] = function (min, max, total, value) {
        var maxSize = options["nodes"]["scaling"]["max"]
        var minSize = options["nodes"]["scaling"]["min"]

        var diff = maxSize - minSize;

        return Math.max(0, (nodeSize - minSize) / diff);  // reverse vis size calculation
      }
    }

    // provide the data in the vis format
    var data = {
      nodes: nodeView,
      edges: edgeView
    };

    network = new vis.Network(container_modal, data, options);

    // show loading status
    document.getElementById("loading-text").innerText = "loading graph: 0%";
    document.getElementById("loading-text").style.display = "unset";

    network.on("stabilizationProgress", function (params) {
      var widthFactor = params.iterations / params.total;
      document.getElementById("loading-text").innerText = "loading graph: " + Math.round(widthFactor * 100) + "%";
    });

    network.once("stabilizationIterationsDone", function () {
      document.getElementById("loading-text").innerText = "loading graph: 100%";
      // really clean the dom element
      setTimeout(function () {
        document.getElementById("loading-text").style.display = "none";
      }, 500);
    });




    //network.selectNodes([currId]);
    var node = network.body.nodes[currId];
    node.setOptions({
      font: {
        size: 20
      },
      color: {
        background: getComputedStyle(document.querySelector('.graph-view.color-fill-focused')).color,
      },
    });



    // local Graph
  } else {

    var myNodes = [];
    var myEdges = [];

    options['edges']['length'] = 250;

    // add current node
    for (const x in jsonNodes) {
      jsonNodes[x]['label'] = (jsonNodes[x]['label']).replace('&amp;', '&')
      jsonNodes[x]['title'] = (jsonNodes[x]['title']).replace('&amp;', '&')
      if (path == ('/' + jsonNodes[x]['title'])) {
        myNodes.push(jsonNodes[x])
        curNode = myNodes[0]
        curNode.size = '20';
        curNode.color = {
          background: getComputedStyle(document.querySelector('.graph-view.color-fill-focused')).color,
        };

        break;
      }
    }


    function idExists(id) {
      return myNodes.some(function (el) {
        return el.id === id;
      });
    }


    // search linked nodes
    for (const y in jsonEdges) {
      if (currId == jsonEdges[y]['from']) {

        // add "To" node to the nodes
        for (const x in jsonNodes) {
          if (jsonEdges[y]['to'] == jsonNodes[x]['id']) {
            if (!idExists(jsonNodes[x]['id'])) {
              myNodes.push(jsonNodes[x])
            }
            break;
          }
        }

        // add the link
        myEdges.push(jsonEdges[y]);

        // search the backlinks
      } else if (currId == jsonEdges[y]['to']) {

        // add "From" node to the nodes
        for (const x in jsonNodes) {
          if (jsonEdges[y]['from'] == jsonNodes[x]['id']) {
            if (!idExists(jsonNodes[x]['id'])) {
              myNodes.push(jsonNodes[x])
            }
            break;
          }
        }

        // add the backlink
        myEdges.push(jsonEdges[y]);
        curr = $('#backlinksCount').text();
        $('#backlinksCount').text(parseInt(curr) + 1);
      }

    }

    // build network structure

    var nodes = new vis.DataSet(myNodes);
    var edges = new vis.DataSet(myEdges);

    // filter out tags
    if (!show_tags) {
      nodeView = new vis.DataView(nodes, {
        filter: function (node) {
          return !(node.group && node.group === "tag");
        }
      })
    }

    // overwrite scaling function to make all nodes the same size
    options["nodes"]["scaling"]["customScalingFunction"] = function (min, max, total, value) {
      var maxSize = options["nodes"]["scaling"]["max"]
      var minSize = options["nodes"]["scaling"]["min"]

      var diff = maxSize - minSize;

      return Math.max(0, (nodeSize - minSize) / diff);  // reverse vis size calculation
    }

    var data = {
      nodes: nodes,
      edges: edges
    };

    // update linked mentions
    setLinkedMentionsCount(Math.max(0, nodes.length - 1));

    var container = document.getElementById('mynetwork');
    network = new vis.Network(container, data, options);


  }

  // jump to file function
  if (network) {

    network.on("click", function (properties) {

      if (!properties.nodes.length) return;
      var node = nodes.get(properties.nodes[0]);

      if (node.group && node.group === "tag") {
        $('.workspace-tab-header[data-type="search"]').click();
        $('*[type="search"]').val(node.title);
        search(node.title);

      } else {
        var glink = uriPath + node.title;
        window.open(glink, "_self");
      }
    });
  }

};

/**
 * change mobile settings
 */
function isMobile() {

  if ($(window).width() < 990) {

    hideLeftMobile();

    //disable mousehover on mobile
    $('.internal-link').unbind("mouseenter");
    $('.internal-link').unbind("mouseleave");

    //override click for internal-links to use popUp instead
    if ($('.popUpSetting').hasClass('is-enabled')) {
      $('.internal-link').click(function (e) {
        e.preventDefault();
        const urlParams = new URLSearchParams(this.href.split('?')[1]);
        if (urlParams.has('link')) {
          var target = urlParams.get('link');
          target = encodeURIComponent(target);
        } else {

          const path = new URL(this.href).pathname;
          target = unslugURL(path)

        }


        if (target) {
          getContent(target, false, true)
        }
        $("#popUp").css("display", "flex");
        $(".goToLink").html('<a href="' + this.href + '"> go to site</a><br><br>')
      })

    }
  }

};

function hideLeftMobile() {

  $('.workspace').removeClass('is-left-sidedock-open');
  $('.mod-left-split').addClass('is-sidedock-collapse');
  $('.mod-left').addClass('is-collapsed');
  //$('.workspace-ribbon.side-dock-ribbon.mod-left').css('display', 'none');

};

/**
 * search
 * @param {String} str
 */
function search(str) {
  if (str.length == 0) {
    $("div.search-results-children").html("");
    return;
  } else {

    str = encodeURIComponent(str);

    $.ajax({
      url: uriPath + "content.php?search=" + str, success: function (result) {

        $("div.search-results-children").html(result);
        let preCodes = $("div.search-results-children").find("pre code")
        for (var i = 0; i < preCodes.length; i++) {
          hljs.highlightElement(preCodes[i]);
        }
      }
    });
  }
};

// edit button

/**
 * @param {String} name
 * @returns {string}
 */
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
};

/**
 * helper
 * @param {String} oldClass
 * @param {String} newClass
 */
function replaceClass(oldClass, newClass) {
  var elem = $("." + oldClass);
  elem.removeClass(oldClass);
  elem.addClass(newClass);
};

/**
 * search entry
 * @param {Event} e
 */
function toggleSearchEntry(e) {

  el = $(e.target);
  //e.preventDefault();

  if (el.hasClass('svg-icon right-triangle')) {
    el = el.parent().parent().parent()
  } else if (el.hasClass('tree-item-icon collapse-icon')) {
    el = el.parent().parent()
  } else {
    return
  }

  if (el.hasClass('is-collapsed')) {
    el.removeClass('is-collapsed');
    el.find('.search-result-file-matches').css("display", "unset");

  } else {
    el.addClass('is-collapsed');
    el.find('.search-result-file-matches').css("display", "none");
  }

};

/**
 * nav menu collapse functions
 * @param {Event} e
 */
function toggleNavFolder(e) {
  el = $(e.target);


  if (el.hasClass('nav-folder-title-content')) {
    elIcon = el.prev()
    el = el.parent()
    el = el.next(el)
  } else if (el.hasClass('collapse-icon')) {
    elIcon = el
    el = el.parent()
    el = el.next(el)
  } else if (el.hasClass('mod-collapsible')) {
    elIcon = el.children()[0]
    elIcon = $(elIcon)
    el = el.next(el)
  } else if (el.hasClass('svg-icon right-triangle')) {
    elIcon = el.parent()
    el = el.parent().parent()
    el = el.next(el)
  } else if (el.is('path')) {
    el = el.parent().parent().parent()
    el = el.next(el)

  }

  if (elIcon.hasClass('is-collapsed')) {
    elIcon.removeClass('is-collapsed');

  } else {
    elIcon.addClass('is-collapsed');
  }

  if (el.hasClass('collapse')) {
    el.removeClass('collapse');

  } else {
    el.addClass('collapse');
  }

  return
};

/**
 *
 * @param {String} target
 * @param {Boolean} openAll
 */
function openNavMenu(target, openAll = false) {

  // open nav menu to target
  var navId = decodeURIComponent(target);
  
  // search and open tree reverse
  navId = navId.replace(/[^a-zA-Z0-9\-]/g, '_');

  navId = 'fileid-' + navId;
  var next = $('#' + navId).parent().closest('.collapse');

  do {
    next.removeClass('collapse');
    elIcon = next.prev().children()[0]
    elIcon = $(elIcon)
    elIcon.removeClass('is-collapsed');
    next = next.parent().closest('.collapse');
  }
  while (next.length != 0);

  // mark active
  $('#' + navId).addClass('perlite-link-active is-active');


};

function hideTooltip() {
  $('.tooltip').css("display", "none")
};



// on document ready stuff
$(document).ready(function () {


  // load settings from storage
  // ----------------------------------------

  // text size
  if (localStorage.getItem('Font_size')) {
    $('body').css('--font-text-size', localStorage.getItem('Font_size') + 'px');
  }

  $('.slider.font-size').val(parseInt($('body').css('--font-text-size')));


  // popHovers
  if (localStorage.getItem('disablePopUp') === 'true') {
    $('.disablePopUp').addClass('is-enabled')
  } else if (localStorage.getItem('disablePopUp') === 'false') {
    $('.disablePopUp').removeClass('is-enabled')
  }

  // inline title
  if (localStorage.getItem('InlineTitle') === 'hide') {
    $('.inlineTitleOption').removeClass('is-enabled')
    $('body').removeClass('show-inline-title')
  }

  // metadata
  if (localStorage.getItem('Metadata') === 'hide') {
    $('.metadataOption').addClass('is-enabled')
    $('.metadata-container').addClass('is-collapsed');
  }

  // light mode
  if (localStorage.getItem('lightMode') === 'true') {
    $('body').removeClass('theme-dark')
    $('body').addClass('theme-light')
    $('.darkModeOption').removeClass('is-enabled')
  }

  // popUp Setting
  if (localStorage.getItem('popUpEnabled') === 'true') {
    $('.popUpSetting').addClass('is-enabled')
  }



  // graph settings & defaults

  if (localStorage.getItem('Graph_Style')) {
    $('#graphStyleDropdown').val(localStorage.getItem('Graph_Style'))
  } else {
    $('#graphStyleDropdown').val('dynamic')
  }

  if (localStorage.getItem('Graph_NodeSize')) {
    $('.slider.nodeSize').val(localStorage.getItem('Graph_NodeSize'))
  } else {
    $('.slider.nodeSize').val(12)
  }

  if (localStorage.getItem('Graph_LinkDistance')) {
    $('.slider.linkDistance').val(localStorage.getItem('Graph_LinkDistance'))
  } else {
    $('.slider.linkDistance').val(150)
  }

  if (localStorage.getItem('Graph_LinkThickness')) {
    $('.slider.linkThickness').val(localStorage.getItem('Graph_LinkThickness'))
  } else {
    $('.slider.linkThickness').val(1)
  }

  if (localStorage.getItem('Graph_Orphans') === 'hide') {
    $('.graphNoLinkOption').removeClass('is-enabled')
  }

  if (localStorage.getItem('Graph_Tags') === 'hide') {
    $('.graphShowTagsOption').removeClass('is-enabled')
  }

  if (localStorage.getItem('Graph_NodeScaling') === 'depsOnSize') {
    $('.graphSizeDepsOnConnsOption').addClass('is-enabled')
  }

  if (localStorage.getItem('Graph_Autoreload') === 'no') {
    $('.graphAutoReloadOption').removeClass('is-enabled')
  }


  // panel sizes
  if (localStorage.getItem('leftSizePanel')) {
    $('.workspace-split.mod-horizontal.mod-left-split').css("width", localStorage.getItem('leftSizePanel'))
  } else {
    $('.workspace-split.mod-horizontal.mod-left-split').css("width", window.innerWidth / 6)
  }

  if (localStorage.getItem('rightSizePanel')) {
    $('.workspace-split.mod-horizontal.mod-right-split').css("width", localStorage.getItem('rightSizePanel'))
  } else {
    $('.workspace-split.mod-horizontal.mod-right-split').css("width", window.innerWidth / 6)
  }


  //check for graph and hide local graph if none exists
  if ($("#allGraphNodes").length == 0 || $("#allGraphNodes").text == '[]') {

    $('.clickable-icon.side-dock-ribbon-action[aria-label="Open graph view"]').css('display', 'none')
    $('.clickable-icon.view-action[aria-label="Open outline"]').css('display', 'none')
    $('.clickable-icon.view-action[aria-label="Open localGraph"]').css('display', 'none')
    $('#localGraph').css('display', 'none')
    $('#outline').css('display', 'inline')

  }


  // direct links
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);

  var target = "";
  if (urlParams.has('link')) {
    var target = urlParams.get('link');

  } else {

    target = unslugURL(window.location.pathname)

  }

  if (window.location.pathname != uriPath | urlParams.has('link')) {

    target = encodeURIComponent(target)

    var hash = window.location.hash;

    getContent(target, false, false, hash);
    openNavMenu(target);

  } else {

    // load index page
    getContent("home", true);
  }
  // on search submit
  $('*[type="search"]').on('keypress', function (e) {
    if (e.which == 13) {
      search(this.value);
      return false;
    }

  });


  //mark current active menu item
  $('.perlite-link').click(function (e) {

    e.preventDefault();
    $('.perlite-link').removeClass('perlite-link-active is-active');

    $(this).addClass('perlite-link-active is-active');
  });



  // toggle left sidedock
  $('.sidebar-toggle-button.mod-left.sidebar').click(function (e) {

    e.preventDefault();


    if ($('.sidebar-toggle-button.mod-left.sidebar').hasClass('is-collapsed')) {
      $('.workspace').addClass('is-left-sidedock-open');
      $('.mod-left-split').removeClass('is-sidedock-collapse');
      $('.mod-left').removeClass('is-collapsed');

    } else {

      $('.workspace').removeClass('is-left-sidedock-open');
      $('.mod-left-split').addClass('is-sidedock-collapse');
      $('.mod-left').addClass('is-collapsed');
    }

  });


  $('.sidebar-toggle-button.mod-left.mobile-display').click(function (e) {

    if ($('.workspace-ribbon.side-dock-ribbon.mod-left').is(':hidden')) {
      $('.workspace-ribbon.side-dock-ribbon.mod-left').css('display', 'flex')
    } else {
      $('.workspace-ribbon.side-dock-ribbon.mod-left').css('display', 'none')
    }

  })



  // toggle right sidedock
  $('.sidebar-toggle-button.mod-right').click(function (e) {

    e.preventDefault();

    if ($('.sidebar-toggle-button.mod-right').hasClass('is-collapsed')) {
      $('.workspace').addClass('is-right-sidedock-open');
      $('.mod-right-split').removeClass('is-sidedock-collapse');
      $('.mod-right').removeClass('is-collapsed');

    } else {

      $('.workspace').removeClass('is-right-sidedock-open');
      $('.mod-right-split').addClass('is-sidedock-collapse');
      $('.mod-right').addClass('is-collapsed');
    }

  });


  // click search
  $('.workspace-tab-header[data-type="search"]').click(function (e) {
    e.preventDefault();

    $('.workspace-leaf-content[data-type="search"]').parent().css("display", "unset");
    $('.workspace-leaf-content[data-type="file-explorer"]').parent().css("display", "none");
    $('.workspace-tab-header[data-type="search"]').addClass('is-active mod-active');
    $('.workspace-tab-header[data-type="file-explorer"]').removeClass('is-active mod-active');

    // set focus to search field
    $('input[type=search]').focus();

  });

  // click file-explorer
  $('.workspace-tab-header[data-type="file-explorer"]').click(function (e) {
    e.preventDefault();
    $('.workspace-leaf-content[data-type="file-explorer"]').parent().css("display", "unset");
    $('.workspace-leaf-content[data-type="search"]').parent().css("display", "none");
    $('.workspace-tab-header[data-type="file-explorer"]').addClass('is-active mod-active');
    $('.workspace-tab-header[data-type="search"]').removeClass('is-active mod-active');
  });

  // click expand-search-all
  $('.clickable-icon.nav-action-button[aria-label="Collapse results"]').click(function (e) {
    e.preventDefault();

    if ($('.tree-item.search-result').hasClass('is-collapsed')) {
      $('.tree-item.search-result').removeClass('is-collapsed');
      $('.search-result-file-matches').css("display", "unset");
      $('.clickable-icon.nav-action-button[aria-label="Collapse results"]').removeClass('is-active');

    } else {
      $('.tree-item.search-result').addClass('is-collapsed');
      $('.search-result-file-matches').css("display", "none");
      $('.clickable-icon.nav-action-button[aria-label="Collapse results"]').addClass('is-active');
    }
  });


  // click expand-file-explorer-all
  $('.clickable-icon.nav-action-button[aria-label="Expand all"]').click(function (e) {
    e.preventDefault();
    target = $(e.target)

    $('.nav-folder-children.collapse').removeClass('collapse')
    $('.nav-folder').removeClass('is-collapsed');
    $('.collapse-icon').removeClass('is-collapsed');
    $('.clickable-icon.nav-action-button[aria-label="Collapse all"]').css('display', 'unset');
    target.css('display', 'none');

  });


  // click collapse file-explorer-all
  $('.clickable-icon.nav-action-button[aria-label="Collapse all"]').click(function (e) {
    e.preventDefault();
    target = $(e.target)

    parents = $('.nav-folder-children').parent()

    parents.each(function (index, value) {
      parent = $(this)
      if (!$(this).hasClass('mod-root')) {
        parent.find('.nav-folder-children').addClass('collapse');
        parent.find('.collapse-icon').addClass('is-collapsed');
      }
    })

    $('.nav-folder').addClass('is-collapsed');
    $('.clickable-icon.nav-action-button[aria-label="Expand all"]').css('display', 'unset');
    target.css('display', 'none');

  });


  // copy URL function
  $('.clickable-icon.view-action[aria-label="Copy URL"]').click(function (e) {
    e.preventDefault();
    target = $(e.target)
    var text = window.location.href;
    $('.tooltip').css("top", target.offset().top + 39);
    $('.tooltip').css("left", target.offset().left);
    $('.tooltip').css("height", "25px");
    $('.tooltip').css("display", "unset");

    navigator.clipboard.writeText(text).then(function () {
      $('.tooltip').text("URL copied to clipboard!");
    }, function (err) {
      $('.tooltip').text("Could not copy URL");
      console.error('Async: Could not copy URL: ', err);
    });

    setTimeout(hideTooltip, 1500);
  });



  // rezise Handler right
  const rightDockContainer = $('.workspace-split.mod-horizontal.mod-right-split')
  $('.workspace-leaf-resize-handle.right-dock').mousedown(function (e) {

    e.preventDefault()

    $(document).mouseup(function (e) {
      $(document).unbind('mousemove')
      localStorage.setItem('rightSizePanel', rightDockContainer.css("width"))
    });

    $(document).mousemove(function (e) {
      e.preventDefault()
      rightDockContainer.css("width", $(document).width() - e.pageX)

    });

  });


  // rezise Handler left
  const leftDockContainer = $('.workspace-split.mod-horizontal.mod-left-split')
  $('.workspace-leaf-resize-handle.left-dock').mousedown(function (e) {

    e.preventDefault()


    $(document).mouseup(function (e) {
      $(document).unbind('mousemove')
      localStorage.setItem('leftSizePanel', leftDockContainer.css("width"))
    });

    $(document).mousemove(function (e) {
      e.preventDefault()
      leftDockContainer.css("width", e.pageX)

    });

  });



  //  Global Settings and Event Handler
  // --------------------------------

  // load themes
  var dropDownValues = '<option value="Default">Obsidian Default</option>';
  var perliteDefault = ""
  $('.theme').each(function (i) {
    themeName = $(this).data('themename');
    themeId = $('.theme')[i].id;
    dropDownValues += '<option value="' + themeId + '">' + themeName + '</option>'

    // get current active
    if (!$('.theme')[i].disabled) {
      perliteDefault = $('.theme')[i].id;
    }

  })


  // fill dropdown
  $('#themeDropdown').html(dropDownValues);

  // change theme
  $("#themeDropdown").change(function (e) {
    target = $(e.target)

    // disable all themes
    $('.theme').attr("disabled", 'disabled');

    //enable selected if its not default
    selectedTheme = target.val()

    if (selectedTheme !== 'Default') {
      $('#' + target.val()).attr('disabled', false);
    }

    localStorage.setItem('Theme', target.val());

  });

  //set active theme
  if (localStorage.getItem('Theme')) {
    $('#themeDropdown').val(localStorage.getItem('Theme'));
    $("#themeDropdown").trigger('change');

  } else {
    $('#themeDropdown').val(perliteDefault);
  }


  // reset Theme
  $('#resetTheme').click(function () {
    $('#themeDropdown').val(perliteDefault);
    $('#themeDropdown').change();
    localStorage.removeItem('Theme');
  })

  // text size input slider
  $('.slider.font-size').click(function (e) {
    e.preventDefault();
    target = $(e.target)

    $('body').css('--font-text-size', target.val() + 'px')
    localStorage.setItem('Font_size', target.val());

    $('.slider.font-size').val(parseInt($('body').css('--font-text-size')));

  });

  // Textsize Restore Defaults Button
  $('.clickable-icon[aria-label="Restore text settings"]').click(function (e) {
    e.preventDefault();

    $('body').css('--font-text-size', '15px')
    localStorage.removeItem('Font_size')
    $('.slider.font-size').val(parseInt($('body').css('--font-text-size')));

  });

  // Panelsize Restore Defaults Button
  $('.clickable-icon[aria-label="Restore panel settings"]').click(function (e) {
    e.preventDefault();

    localStorage.removeItem('rightSizePanel')
    localStorage.removeItem('leftSizePanel')

    $('.workspace-split.mod-horizontal.mod-left-split').css("width", "450px")
    $('.workspace-split.mod-horizontal.mod-right-split').css("width", "450px")
  });



  // inLine Title Option
  $('.inlineTitleOption').click(function (e) {
    e.preventDefault();
    target = $('.inlineTitleOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')
      $('body').removeClass('show-inline-title')
      localStorage.setItem('InlineTitle', 'hide');

    } else {
      target.addClass('is-enabled')
      $('body').addClass('show-inline-title')
      localStorage.removeItem('InlineTitle');

    }
  });


  // Disable PopHover Option
  $('.disablePopUp').click(function (e) {
    e.preventDefault();
    target = $('.disablePopUp')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')
      localStorage.setItem('disablePopUp', 'false');

    } else {
      target.addClass('is-enabled')
      localStorage.setItem('disablePopUp', 'true');

    }
  });

  // Darkmode / Lightmode change
  $('.darkModeOption').click(function (e) {
    e.preventDefault();
    target = $('.darkModeOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')

      $('body').removeClass('theme-dark')
      $('body').addClass('theme-light')
      localStorage.setItem('lightMode', 'true');

    } else {
      target.addClass('is-enabled')
      $('body').removeClass('theme-light')
      $('body').addClass('theme-dark')
      localStorage.removeItem('lightMode');

    }
  });

  // PopUp change (mobile only)
  $('.popUpSetting').click(function (e) {
    e.preventDefault();
    target = $('.popUpSetting')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')
      localStorage.removeItem('popUpEnabled');

    } else {
      target.addClass('is-enabled')
      localStorage.setItem('popUpEnabled', 'true');

    }
  });


  // collapse Metadata Option
  $('.metadataOption').click(function (e) {
    e.preventDefault();
    target = $('.metadataOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')
      if ($('.metadata-container').hasClass('is-collapsed')) {
        $('.metadata-container').removeClass('is-collapsed');
      }
      localStorage.removeItem('Metadata');

    } else {
      target.addClass('is-enabled')

      if (!$('.metadata-container').hasClass('is-collapsed')) {
        $('.metadata-container').addClass('is-collapsed');
        localStorage.setItem('Metadata', 'hide');
      }
    }
  });


  //  Graph Settings and Event Handler
  // --------------------------------
  // open Graph
  $('.clickable-icon.side-dock-ribbon-action[aria-label="Open graph view"]').click(function (e) {
    e.preventDefault();

    str = document.getElementsByClassName('perlite-link-active');
    isMobile();

    if (str[0] != undefined) {
      str = str[0].getAttribute('onclick');
      str = str.substring(0, str.length - 3);
      str = str.substring(12, str.length);

    } else {
      str = "";
    }

    [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
    renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);

    if ($('.view-header-nav-buttons[data-section="close"]').is(':hidden')) {
      // show graph and close button
      $('.view-header-nav-buttons[data-section="close"]').css('display', 'flex');
      $('#graph_content').css('display', 'unset');
      $('.markdown-reading-view').css('display', 'none');

      // hide right side-dock
      $('.workspace').removeClass('is-right-sidedock-open');
      $('.mod-right-split').addClass('is-sidedock-collapse');
      $('.mod-right').addClass('is-collapsed');

    } else {

      $('.view-header-nav-buttons[data-section="close"]').click();

    }


  });

  // close Graph
  $('.view-header-nav-buttons[data-section="close"]').click(function (e) {
    e.preventDefault();

    // hide graph and close button
    $('.view-header-nav-buttons[data-section="close"]').css('display', 'none');
    $('#graph_content').css('display', 'none');
    $('.markdown-reading-view').css('display', 'flex');

    // show right side-dock
    $('.workspace').addClass('is-right-sidedock-open');
    $('.mod-right-split').removeClass('is-sidedock-collapse');
    $('.mod-right').removeClass('is-collapsed');
  });
  // open Graph settings
  $('.clickable-icon.graph-controls-button.mod-open[aria-label="Open graph settings"]').click(function (e) {
    e.preventDefault();

    target = $(e.target)
    $('.graph-controls').removeClass('is-close')
  });

  // close Graph settings
  $('.clickable-icon.graph-controls-button.mod-close[aria-label="Close"]').click(function (e) {
    e.preventDefault();
    $('.graph-controls').addClass('is-close')
  });

  // Graph Show Links Option (Orphans)
  $('.graphNoLinkOption').click(function (e) {
    e.preventDefault();
    target = $('.graphNoLinkOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')

      if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
        [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
        renderGraph(true, str, true, showTags, sizeDepsOnConns);
      }

      localStorage.setItem('Graph_Orphans', 'hide');


    } else {
      target.addClass('is-enabled')
      if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
        [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
        renderGraph(true, str, false, showTags, sizeDepsOnConns);
      }
      localStorage.removeItem('Graph_Orphans');
    }
  });

  // Graph Show Tags Option
  $('.graphShowTagsOption').click(function (e) {
    e.preventDefault();
    target = $('.graphShowTagsOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')

      if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
        [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
        renderGraph(true, str, showNoLinks, false, sizeDepsOnConns);
      }

      localStorage.setItem('Graph_Tags', 'hide');

    } else {
      target.addClass('is-enabled')
      if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
        [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
        renderGraph(true, str, showNoLinks, true, sizeDepsOnConns);
      }
      localStorage.removeItem('Graph_Tags');
    }
  });

  // Graph Node Size Depends On Node Connection Number Option
  $('.graphSizeDepsOnConnsOption').click(function (e) {
    e.preventDefault();
    target = $('.graphSizeDepsOnConnsOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')

      if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
        [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
        renderGraph(true, str, showNoLinks, showTags, false);
      }

      localStorage.setItem('Graph_NodeScaling', 'default');

    } else {
      target.addClass('is-enabled')
      if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
        [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
        renderGraph(true, str, showNoLinks, showTags, true);
      }
      localStorage.setItem('Graph_NodeScaling', 'depsOnSize');
    }
  });

  // Graph Auto-reload Option
  $('.graphAutoReloadOption').click(function (e) {
    e.preventDefault();
    target = $('.graphAutoReloadOption')

    if (target.hasClass('is-enabled')) {
      target.removeClass('is-enabled')
      localStorage.setItem('Graph_Autoreload', 'no');

    } else {
      target.addClass('is-enabled')
      localStorage.removeItem('Graph_Autoreload');
    }
  });

  // Graph Node Size Option
  $('.nodeSize').click(function (e) {
    e.preventDefault();
    target = $(e.target)

    $('#nodeSizeVal').text(target.val())

    if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
      [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
      renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);
    }

    localStorage.setItem('Graph_NodeSize', target.val());

  });
  // Graph Link Distance Option
  $('.linkDistance').click(function (e) {
    e.preventDefault();
    target = $(e.target)

    $('#linkDistanceVal').text(target.val())
    var showNoLinks = !$(".graphNoLinkOption").hasClass('is-enabled')
    if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
      [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
      renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);
    }
    localStorage.setItem('Graph_LinkDistance', target.val());

  });
  // Graph Link Thickness Option
  $('.linkThickness').click(function (e) {
    e.preventDefault();
    target = $(e.target)

    $('#linkThicknessVal').text(target.val())
    var showNoLinks = !$(".graphNoLinkOption").hasClass('is-enabled')
    if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
      [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
      renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);
    }
    localStorage.setItem('Graph_LinkThickness', target.val());

  });

  // Graph Style Change
  $("#graphStyleDropdown").change(function (e) {
    e.preventDefault();
    target = $(e.target)
    if ($('.graphAutoReloadOption').hasClass('is-enabled')) {
      [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
      renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);
    }
    localStorage.setItem('Graph_Style', target.val());
  });

  // Graph Reload Button
  $("#graphReload").click(function (e) {
    [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
    renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);

  });

  // Graph Restore Defaults Button
  $('.clickable-icon.graph-controls-button.mod-reset[aria-label="Restore default settings"]').click(function (e) {
    e.preventDefault();

    if (!$('.graphNoLinkOption').hasClass('is-enabled')) {
      $('.graphNoLinkOption').addClass('is-enabled')
    }

    if (!$(".graphShowTagsOption").hasClass("is-enabled")) {
      $(".graphShowTagsOption").addClass("is-enabled")
    }

    if ($(".graphSizeDepsOnConnsOption").hasClass("is-enabled")) {
      $(".graphSizeDepsOnConnsOption").removeClass("is-enabled")
    }

    if (!$('.graphAutoReloadOption').hasClass('is-enabled')) {
      $('.graphAutoReloadOption').addClass('is-enabled')
    }

    $('.slider.linkThickness').val(1)
    $('.slider.linkDistance').val(150)
    $('.slider.nodeSize').val(12)
    $('#graphStyleDropdown').val('dynamic')

    localStorage.removeItem('Graph_Orphans');
    localStorage.removeItem('Graph_ShowTags');
    localStorage.removeItem('Graph_NodeScaling')
    localStorage.removeItem('Graph_Autoreload');
    localStorage.removeItem('Graph_Style');
    localStorage.removeItem('Graph_LinkDistance');
    localStorage.removeItem('Graph_LinkThickness');
    localStorage.removeItem('Graph_NodeSize');


    [showNoLinks, showTags, sizeDepsOnConns] = getGraphConfig()
    renderGraph(true, str, showNoLinks, showTags, sizeDepsOnConns);

  });





  //  Modal Event Handler
  // --------------------------------

  // info modal
  $('.clickable-icon.side-dock-ribbon-action[aria-label="Help"]').click(function (e) {
    $.ajax({
      url: uriPath + "content.php?about", success: function (result) {

        $("div.aboutContent").html(result);
        $("#about").css("display", "flex");
        //$(".modal-title").html('Perlite');
        // hljs.highlightAll();

      }
    });

  });

  // links to a heading / footnote on the same page ([[#Heading]], [^1]) and
  // outline (table of contents) links, in the sidebar or the mobile pop-up
  $(document).on('click', '#mdContent a[href^="#"]:not(.tag), #toc a[href^="#"], #popUpContent .toc-item a[href^="#"]', function (e) {
    var hash = this.getAttribute('href');
    var inPopup = $(this).closest('#popUpContent').length > 0;
    if (hash.length > 1 && scrollToAnchor(hash.substring(1))) {
      e.preventDefault();
      history.replaceState(history.state, '', location.pathname + location.search + hash);
      if (inPopup) {
        $('#popUp').css('display', 'none');
      }
    }
  });

  // footnote preview on hover (always on, independent of the page-preview setting)
  var footnoteHideTimer = null;
  var footnotePopover = null;

  function hideFootnotePopover() {
    clearTimeout(footnoteHideTimer);
    if (footnotePopover) {
      footnotePopover.remove();
      footnotePopover = null;
    }
  }

  function findFootnoteItem(link) {
    var id = (link.getAttribute('href') || '').replace(/^#/, '');
    if (!id) {
      return null;
    }
    // the footnote list belonging to this note (embedded notes have their own)
    for (var el = link.parentElement; el; el = el.parentElement) {
      var section = el.querySelector(':scope > section.footnotes');
      if (section) {
        return section.querySelector('li[id="' + CSS.escape(id) + '"]');
      }
    }
    return null;
  }

  function showFootnotePopover(link) {
    var item = findFootnoteItem(link);
    if (!item) {
      return;
    }
    hideFootnotePopover();

    var content = item.cloneNode(true);
    content.querySelectorAll('.footnote-backref').forEach(function (b) { b.remove(); });
    content.removeAttribute('id');

    footnotePopover = $('<div class="popover perlite-footnote-popover">'
      + '<div class="markdown-embed" data-type="footnote"><div class="markdown-embed-content">'
      + '<div class="markdown-preview-view markdown-rendered"></div></div></div></div>');
    footnotePopover.find('.markdown-preview-view').append($(content).contents());
    footnotePopover.appendTo(document.body);

    // below the link, or above it when there is no room; kept inside the window
    var r = link.getBoundingClientRect();
    var pop = footnotePopover[0].getBoundingClientRect();
    var margin = 8;
    var top = r.bottom + 6;
    if (top + pop.height > window.innerHeight - margin && r.top - 6 - pop.height > margin) {
      top = r.top - 6 - pop.height;
    }
    var left = Math.min(Math.max(margin, r.left - 12), window.innerWidth - pop.width - margin);
    footnotePopover.css({ top: Math.max(margin, top) + 'px', left: Math.max(margin, left) + 'px' });
  }

  $(document).on('mouseenter', 'sup.footnote-ref a', function () {
    clearTimeout(footnoteHideTimer);
    showFootnotePopover(this);
  });
  $(document).on('mouseenter', '.perlite-footnote-popover', function () {
    clearTimeout(footnoteHideTimer);
  });
  $(document).on('mouseleave', 'sup.footnote-ref a, .perlite-footnote-popover', function () {
    clearTimeout(footnoteHideTimer);
    footnoteHideTimer = setTimeout(hideFootnotePopover, 300);
  });
  // close it when the page scrolls or a footnote link is clicked
  document.addEventListener('scroll', function (e) {
    if (footnotePopover && !footnotePopover[0].contains(e.target)) {
      hideFootnotePopover();
    }
  }, true);
  $(document).on('click', 'sup.footnote-ref a', hideFootnotePopover);

  // keep an open image preview fitted to the screen when the window changes size
  $(window).on('resize', function () {
    if (window.fitImagePreview) {
      window.fitImagePreview();
    }
  });

  // setting modal
  $('.clickable-icon.side-dock-ribbon-action[aria-label="Settings"]').click(function (e) {

    $("#settings").css("display", "flex");

  });

  // open random note
  $('.clickable-icon.side-dock-ribbon-action[aria-label="Open random note"]').click(function (e) {

    var nodes = JSON.parse($("#allGraphNodes").text())
    nodesCount = nodes.length

    min = Math.ceil(0);
    max = Math.floor(nodesCount);

    // don't load tags as random nodes
    do {
      tag = true
      randomNode = Math.floor(Math.random() * (max - min) + min)
      if (nodes[randomNode]['title'].substring(0, 1) != "#") {
        tag = false
      }

    } while (tag);

    target = '/' + nodes[randomNode]['title']
    target = encodeURIComponent(target);
    getContent(target)

  });

  // open random note
  $('.clickable-icon.side-dock-ribbon-action[aria-label="Open TOC"]').click(function (e) {

    console.log("open TOC")

    $("#popUpContent").html($("#toc").html())
    $(".popup-modal-title").text($(".popup-modal-title").text() + ' - Content');
    $("#popUp").css("display", "flex")

  });

  /**
   * close modal
   * @param {String[]} elementIds
   */
  function hideElements(elementIds) {
    elementIds.forEach(function (id) {
      $("#" + id).css("display", "none");
    });
  }

  $('.modal-close-button').click(function (e) {
    hideElements(["settings", "about", "popUp", "img-modal"]);
  });

  $(document).keydown(function (e) {
    if (e.key === "Escape") {
      hideElements(["settings", "about", "popUp", "img-modal"]);
    }
  });

  // local Graph & Tag & Toc (outline) Switch
  $('.clickable-icon.view-action[aria-label="Open outline"]').click(function (e) {


    if ($('#outline').css('display') == 'inline') {
      localStorage.setItem("showTOC", "false")
      $('#outline').css('display', 'none')


    } else {
      localStorage.setItem("showTOC", "true")
      $('#outline').css('display', 'inline')
    }

  });

  $('.clickable-icon.view-action[aria-label="Open localGraph"]').click(function (e) {

    if ($('#localGraph').css('display') == 'inline') {
      localStorage.setItem("showLocalGraph", "false")
      $('#localGraph').css('display', 'none')
    } else {
      localStorage.setItem("showLocalGraph", "true")
      $('#localGraph').css('display', 'inline')
    }
  });

  $('.clickable-icon.view-action[aria-label="Open Tags"]').click(function (e) {

    if ($('#tags_container').css('display') == 'block') {
      localStorage.setItem("showLocalTags", "false")
      $('#tags_container').css('display', 'none')
    } else {
      localStorage.setItem("showLocalTags", "true")
      $('#tags_container').css('display', 'block')
    }
  });


  // init mermaid
  mermaid.initialize({ startOnLoad: false, 'securityLevel': 'Strict', 'theme': 'dark' });


  // handle browser history 
  window.addEventListener("popstate", function (event) {

    target = unslugURL(window.location.pathname)
    getContent(target)

  });

});