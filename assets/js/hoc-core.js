/* ==========================================================================
   HOC TEA — hoc-core.js

   Everything the site needs to *work*: capability tiering, one shared RAF,
   the controller lifecycle, and all commerce interaction (§25, §26, §38).

   No creative motion lives here. hoc-motion.js layers that on top, and if it
   never loads the page is still fully usable — which is the whole point of
   building PHASE B before PHASE D.
   ========================================================================== */

(function (root, doc) {
  "use strict";

  var HOC = (root.HOC = root.HOC || {});

  /* ======================================================================
     1. CAPABILITY TIER  §38 §39

     Deliberately built from cheap, reliable signals. detect-gpu is not used:
     its benchmark data is stale and HOC should not hard-depend on it (§39).
     ====================================================================== */

  function detectWebGL() {
    try {
      var c = doc.createElement("canvas");
      var gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return false;
      // A software rasteriser will report a renderer we do not want to push.
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        var r = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
        if (/swiftshader|llvmpipe|software/i.test(r)) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  var mqReduce = root.matchMedia("(prefers-reduced-motion: reduce)");
  var mqCoarse = root.matchMedia("(hover: none)");
  var mqNarrow = root.matchMedia("(max-width: 899px)");

  var env = {
    reduced: mqReduce.matches,
    touch: mqCoarse.matches,
    narrow: mqNarrow.matches,
    webgl: detectWebGL(),
    memory: navigator.deviceMemory || 8,
    cores: navigator.hardwareConcurrency || 4,
    tier: "standard"
  };

  // QA override: ?hoctier=full|standard|reduced pins the tier so all three
  // experiences can be reviewed on one machine. Read-only, no side effects.
  var forcedTier = (function () {
    var m = /[?&]hoctier=(full|standard|reduced)/.exec(root.location.search);
    return m ? m[1] : null;
  })();

  function computeTier() {
    if (forcedTier) return forcedTier;
    if (env.reduced || !env.webgl) return "reduced";
    if (env.narrow || env.touch || env.memory <= 4 || env.cores <= 4)
      return "standard";
    return "full";
  }
  if (forcedTier === "full") env.webgl = true;
  env.tier = computeTier();

  // Frame-time sampling: if the first two seconds are janky, drop a tier and
  // let the shader controllers tear themselves down (§39).
  var frames = 0,
    slow = 0,
    sampleStart = 0;
  function sampleFrame(t) {
    if (!sampleStart) {
      sampleStart = t;
      return;
    }
    frames++;
    if (t - sampleStart > 2000) {
      HOC.ticker.remove(sampleFrame);
      if (frames / ((t - sampleStart) / 1000) < 34 && env.tier === "full") {
        env.tier = "standard";
        doc.documentElement.setAttribute("data-tier", env.tier);
        HOC.emit("tierchange", env.tier);
      }
      return;
    }
    void slow;
  }

  HOC.env = env;
  doc.documentElement.setAttribute("data-tier", env.tier);
  if (env.tier === "reduced") doc.documentElement.classList.add("hoc-reduced");

  mqReduce.addEventListener("change", function (e) {
    env.reduced = e.matches;
    env.tier = computeTier();
    doc.documentElement.setAttribute("data-tier", env.tier);
    doc.documentElement.classList.toggle("hoc-reduced", env.tier === "reduced");
    HOC.emit("tierchange", env.tier);
  });

  /* ======================================================================
     2. ONE TICKER  §31
     GSAP's ticker is the single clock. Lenis, the shaders and any parallax
     read from it — never their own requestAnimationFrame loop.
     ====================================================================== */

  var tickFns = [];
  var hasGsap = typeof root.gsap !== "undefined";

  HOC.ticker = {
    add: function (fn) {
      if (tickFns.indexOf(fn) === -1) tickFns.push(fn);
    },
    remove: function (fn) {
      var i = tickFns.indexOf(fn);
      if (i > -1) tickFns.splice(i, 1);
    }
  };

  // Iterate a snapshot: a tick callback is allowed to add or remove callbacks
  // (the tier sampler removes itself AND, via tierchange, the shader loops),
  // and mutating the live array mid-loop would skip or overrun it.
  function runTick(time) {
    var list = tickFns.slice();
    for (var i = 0; i < list.length; i++) {
      if (tickFns.indexOf(list[i]) === -1) continue; // removed this frame
      list[i](time);
    }
  }

  if (hasGsap) {
    root.gsap.ticker.add(function (time) {
      runTick(time * 1000);
    });
    root.gsap.ticker.lagSmoothing(0);
  } else {
    (function loop(t) {
      runTick(t);
      root.requestAnimationFrame(loop);
    })(0);
  }

  /* ======================================================================
     3. SMOOTH SCROLL  §30
     One scroll authority. Lenis. Never alongside ScrollSmoother or Locomotive.
     ====================================================================== */

  HOC.lenis = null;
  if (typeof root.Lenis !== "undefined" && !env.reduced) {
    HOC.lenis = new root.Lenis({
      lerp: 0.11,
      wheelMultiplier: 1,
      smoothWheel: true,
      // Touch keeps native momentum — smoothing it costs more than it buys.
      syncTouch: false
    });
    HOC.ticker.add(function (time) {
      HOC.lenis.raf(time);
    });
  }

  HOC.scrollTo = function (target, opts) {
    if (HOC.lenis) HOC.lenis.scrollTo(target, opts);
    else if (typeof target === "string") {
      var el = doc.querySelector(target);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  HOC.lock = function (on) {
    doc.body.classList.toggle("is-locked", !!on);
    if (HOC.lenis) on ? HOC.lenis.stop() : HOC.lenis.start();
  };

  /* ======================================================================
     4. EVENT BUS + CONTROLLER LIFECYCLE  §25 §26
     ====================================================================== */

  var bus = doc.createElement("i");
  HOC.on = function (n, fn) {
    bus.addEventListener(n, fn);
  };
  HOC.off = function (n, fn) {
    bus.removeEventListener(n, fn);
  };
  HOC.emit = function (n, detail) {
    bus.dispatchEvent(new CustomEvent(n, { detail: detail }));
  };
  /** Like on(), but returns an unbind — push it into a controller's offs so
      a Shopify section reload doesn't leave a second listener behind (§26). */
  HOC.bind = function (n, fn) {
    bus.addEventListener(n, fn);
    return function () {
      bus.removeEventListener(n, fn);
    };
  };

  var registry = {}; // name -> [factory]
  var live = []; // { name, el, api }

  /**
   * Register a controller. The factory receives the element and returns an
   * object which may implement init / destroy / resize (§25).
   *
   * A name may be registered more than once and every factory mounts. That
   * is how hoc-motion.js layers choreography onto a section whose working
   * behaviour already lives in this file — without either half having to
   * know the other exists.
   */
  HOC.controller = function (name, factory) {
    (registry[name] || (registry[name] = [])).push(factory);
  };

  HOC.mount = function (scope) {
    scope = scope || doc;
    Object.keys(registry).forEach(function (name) {
      var nodes = scope.querySelectorAll('[data-hoc="' + name + '"]');
      Array.prototype.forEach.call(nodes, function (el) {
        var flags = el.__hoc || (el.__hoc = {});
        if (flags[name]) return;
        flags[name] = true;
        registry[name].forEach(function (factory) {
          var api;
          try {
            api = factory(el) || {};
          } catch (e) {
            // One broken controller must never take the page down.
            console.error("[hoc] " + name + " failed to build", e);
            return;
          }
          try {
            if (api.init) api.init();
          } catch (e2) {
            console.error("[hoc] " + name + " failed to init", e2);
          }
          live.push({ name: name, el: el, api: api });
        });
      });
    });
  };

  HOC.unmount = function (scope) {
    for (var i = live.length - 1; i >= 0; i--) {
      if (scope && !scope.contains(live[i].el)) continue;
      try {
        if (live[i].api.destroy) live[i].api.destroy();
      } catch (e) {
        console.error("[hoc] destroy failed", e);
      }
      if (live[i].el.__hoc) live[i].el.__hoc[live[i].name] = false;
      live.splice(i, 1);
    }
  };

  var resizeRaf = 0;
  root.addEventListener("resize", function () {
    if (resizeRaf) return;
    resizeRaf = root.requestAnimationFrame(function () {
      resizeRaf = 0;
      env.narrow = mqNarrow.matches;
      env.touch = mqCoarse.matches;
      live.forEach(function (c) {
        if (c.api.resize) c.api.resize();
      });
      HOC.emit("resize");
    });
  });

  /* -- Shopify theme editor  §26 ---------------------------------------- */
  doc.addEventListener("shopify:section:load", function (e) {
    HOC.mount(e.target);
  });
  doc.addEventListener("shopify:section:unload", function (e) {
    HOC.unmount(e.target);
  });
  doc.addEventListener("shopify:section:select", function (e) {
    HOC.emit("sectionselect", e.target);
  });
  doc.addEventListener("shopify:block:select", function (e) {
    var b = e.target.getAttribute("data-blend");
    if (b) HOC.emit("blendselect", b);
  });
  // Shopify's design mode: keep the heavy stuff off so editing stays snappy.
  HOC.designMode = !!(root.Shopify && root.Shopify.designMode);

  /* ======================================================================
     5. SMALL DOM HELPERS
     ====================================================================== */

  var $ = (HOC.$ = function (sel, ctx) {
    return (ctx || doc).querySelector(sel);
  });
  var $$ = (HOC.$$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel));
  });
  function on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    return function () {
      el.removeEventListener(ev, fn, opts);
    };
  }
  HOC.onEl = on;

  var FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

  function trapFocus(container) {
    return on(doc, "keydown", function (e) {
      if (e.key !== "Tab") return;
      var items = $$(FOCUSABLE, container).filter(function (n) {
        return n.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && doc.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ======================================================================
     6. HEADER  §9
     Height compression on scroll + section-driven theme swap.
     ====================================================================== */

  HOC.controller("header", function (el) {
    var offs = [];
    var stuck = false;
    var sections = [];
    var io = null;

    function onScroll() {
      var y = HOC.lenis ? HOC.lenis.scroll : root.scrollY;
      var next = y > 50;
      if (next !== stuck) {
        stuck = next;
        el.classList.toggle("is-stuck", stuck);
      }
    }

    // The section occupying the 1px strip just under the header wins the
    // theme. Rebuilt on resize because the margin depends on viewport height.
    function buildObserver() {
      if (io) io.disconnect();
      var band = el.offsetHeight + 2;
      io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            var t = en.target.getAttribute("data-header-theme");
            if (t) el.setAttribute("data-theme-mode", t);
          });
        },
        {
          rootMargin:
            "-" + (band - 1) + "px 0px -" +
            Math.max(0, root.innerHeight - band) + "px 0px",
          threshold: 0
        }
      );
      sections.forEach(function (s) {
        io.observe(s);
      });
    }

    return {
      init: function () {
        sections = $$("[data-header-theme]");
        buildObserver();

        if (HOC.lenis) HOC.lenis.on("scroll", onScroll);
        offs.push(on(root, "scroll", onScroll, { passive: true }));
        onScroll();

        // In-page anchors go through Lenis so the header offset is respected.
        offs.push(
          on(doc, "click", function (e) {
            var a = e.target.closest && e.target.closest('a[href^="#"]');
            if (!a) return;
            var id = a.getAttribute("href");
            if (id === "#" || id.length < 2) return;
            var target = doc.querySelector(id);
            if (!target) return;
            e.preventDefault();
            HOC.scrollTo(target, { offset: -(el.offsetHeight + 8) });
            HOC.emit("menuclose");
          })
        );
      },
      resize: buildObserver,
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        offs = [];
        if (io) io.disconnect();
        if (HOC.lenis) HOC.lenis.off("scroll", onScroll);
      }
    };
  });

  /* ======================================================================
     7. MOBILE MENU  §9
     ====================================================================== */

  HOC.controller("menu-toggle", function (btn) {
    var menu = $('[data-hoc="menu"]');
    var open = false;
    var untrap = null;
    var offs = [];

    function set(next) {
      if (next === open) return;
      open = next;
      btn.setAttribute("aria-expanded", String(open));
      if (open) {
        menu.hidden = false;
        // force a frame so the clip-path transition actually runs
        void menu.offsetHeight;
      }
      menu.classList.toggle("is-open", open);
      HOC.lock(open);
      if (open) {
        untrap = trapFocus(menu);
        var first = $("a", menu);
        if (first) first.focus();
      } else {
        if (untrap) untrap();
        untrap = null;
        btn.focus();
        root.setTimeout(function () {
          if (!open) menu.hidden = true;
        }, 700);
      }
    }

    return {
      init: function () {
        offs.push(
          on(btn, "click", function () {
            set(!open);
          })
        );
        offs.push(
          on(doc, "keydown", function (e) {
            if (e.key === "Escape" && open) set(false);
          })
        );
        offs.push(
          HOC.bind("menuclose", function () {
            set(false);
          })
        );
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (untrap) untrap();
      }
    };
  });

  /* ======================================================================
     8. BAG  §55 §56
     In-memory only in the prototype. On Shopify this talks to /cart/add.js
     and re-renders the drawer through the Section Rendering API (§57).
     ====================================================================== */

  var bag = {
    items: [], // { slug, pack, qty }
    add: function (slug, pack, quantity) {
      quantity = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));
      var found = null;
      this.items.forEach(function (i) {
        if (i.slug === slug && i.pack === pack) found = i;
      });
      if (found) found.qty += quantity;
      else this.items.push({ slug: slug, pack: pack, qty: quantity });
      HOC.emit("bagchange", this);
    },
    setQty: function (slug, pack, qty) {
      for (var i = this.items.length - 1; i >= 0; i--) {
        var it = this.items[i];
        if (it.slug === slug && it.pack === pack) {
          if (qty <= 0) this.items.splice(i, 1);
          else it.qty = qty;
        }
      }
      HOC.emit("bagchange", this);
    },
    count: function () {
      return this.items.reduce(function (n, i) {
        return n + i.qty;
      }, 0);
    },
    total: function () {
      return this.items.reduce(function (n, i) {
        var b = HOC.data.blend(i.slug);
        var p = HOC.data.packaging.filter(function (x) {
          return x.id === i.pack;
        })[0];
        return n + (b.price + (p ? p.delta : 0)) * i.qty;
      }, 0);
    }
  };
  HOC.bag = bag;

  function packOf(id) {
    return (
      HOC.data.packaging.filter(function (x) {
        return x.id === id;
      })[0] || HOC.data.packaging[1]
    );
  }

  /* -- Add buttons ------------------------------------------------------- */
  HOC.controller("add", function (btn) {
    var off;
    return {
      init: function () {
        // On Shopify the form-submit handler in section 15 owns this.
        if (root.HOC.routes && root.HOC.routes.cartAdd) return;
        off = on(btn, "click", function (e) {
          e.preventDefault();
          var slug = btn.getAttribute("data-blend");
          // Read the product page or featured packaging and quantity choice.
          var panel = btn.closest("[data-panel], [data-hoc='product-detail']");
          var chosen = panel
            ? $('[data-hoc="pack-option"]:checked, [data-pdp-variant]:checked', panel)
            : null;
          var qty = panel && $('[name="quantity"]', panel);
          bag.add(slug, chosen ? chosen.value : "doypack", qty ? qty.value : 1);
          HOC.emit("bagopen");
          var label = btn.querySelector("span:last-child") || btn;
          var prev = label.textContent;
          label.textContent = "Added";
          root.setTimeout(function () {
            label.textContent = prev;
          }, 1400);
        });
      },
      destroy: function () {
        if (off) off();
      }
    };
  });

  /* Product pages share this small controller in the hosted preview and the
     Liquid theme. Native radios and the real Shopify form remain functional
     when JavaScript is unavailable. */
  HOC.controller("product-detail", function (el) {
    var offs = [];
    var form = $('[data-pdp-form]', el);
    var quantity = form && $('[name="quantity"]', form);
    var packImage = $('[data-pdp-scene="pack"] > img', el);
    var originalSrc = packImage && packImage.getAttribute("src");
    var originalSrcset = packImage && packImage.getAttribute("srcset");
    function show(view) {
      $$('[data-pdp-scene]', el).forEach(function (scene) {
        scene.hidden = scene.getAttribute('data-pdp-scene') !== view;
      });
      $$('[data-pdp-view]', el).forEach(function (button) {
        var active = button.getAttribute('data-pdp-view') === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
    function variant() {
      var input = $('[data-pdp-variant]:checked', el);
      if (!input) return;
      var price = $('[data-pdp-price]', el);
      if (price && input.dataset.price) price.textContent = input.dataset.price;
      var add = $('[data-hoc="add"]', el);
      if (add) add.disabled = input.dataset.available === 'false';
      if (packImage) {
        if (input.dataset.imageUrl) {
          packImage.removeAttribute('srcset');
          packImage.src = input.dataset.imageUrl;
        } else {
          if (originalSrcset) packImage.setAttribute('srcset', originalSrcset);
          if (originalSrc) packImage.src = originalSrc;
        }
      }
      if (root.HOC.routes && input.value) {
        var url = new URL(root.location.href);
        url.searchParams.set('variant', input.value);
        root.history.replaceState(null, '', url);
      }
    }
    function changeQuantity(step) {
      if (!quantity) return;
      var current = parseInt(quantity.value, 10) || 1;
      quantity.value = Math.max(1, Math.min(99, current + step));
    }
    return {
      init: function () {
        offs.push(on(el, 'click', function (e) {
          var view = e.target.closest('[data-pdp-view]');
          if (view) show(view.getAttribute('data-pdp-view'));
          var step = e.target.closest('[data-pdp-qty]');
          if (step) changeQuantity(parseInt(step.getAttribute('data-pdp-qty'), 10));
        }));
        offs.push(on(el, 'change', function (e) {
          if (e.target.matches('[data-pdp-variant]')) variant();
          if (e.target === quantity) changeQuantity(0);
        }));
        variant();
      },
      destroy: function () { offs.forEach(function (off) { off(); }); }
    };
  });

  HOC.controller("bag-open", function (btn) {
    var off;
    return {
      init: function () {
        off = on(btn, "click", function () {
          HOC.emit("bagopen");
        });
      },
      destroy: function () {
        if (off) off();
      }
    };
  });

  /* -- Drawer ------------------------------------------------------------ */
  HOC.controller("drawer", function (el) {
    var open = false;
    var untrap = null;
    var offs = [];
    var itemsEl = $('[data-hoc="drawer-items"]', el);
    var totalEl = $('[data-hoc="bag-total"]', el);
    var lastFocus = null;

    function render() {
      var counts = $$('[data-hoc="bag-count"]');
      counts.forEach(function (c) {
        c.textContent = String(bag.count());
      });
      if (totalEl) totalEl.textContent = HOC.data.money(bag.total());
      if (!itemsEl) return;

      if (!bag.items.length) {
        itemsEl.innerHTML =
          '<p class="hoc-drawer__empty hoc-body">Nothing steeping yet.</p>';
        return;
      }

      itemsEl.innerHTML =
        bag.items
          .map(function (i) {
            var b = HOC.data.blend(i.slug);
            var p = packOf(i.pack);
            return (
              '<article class="hoc-cartitem" data-slug="' +
              i.slug +
              '" data-pack="' +
              i.pack +
              '">' +
              '<div class="hoc-cartitem__thumb"><img src="' + (HOC.assetBase || '') + 'assets/img/pack-' +
              b.slug +
              '-420.webp" alt="" width="420" height="663" loading="lazy"></div>' +
              "<div>" +
              '<p class="hoc-cartitem__name">' +
              b.name +
              "</p>" +
              '<p class="hoc-micro">' +
              p.label +
              " · " +
              p.weight +
              "</p>" +
              '<div class="hoc-qty">' +
              '<button data-step="-1" aria-label="Decrease quantity">&minus;</button>' +
              "<output>" +
              i.qty +
              "</output>" +
              '<button data-step="1" aria-label="Increase quantity">+</button>' +
              "</div>" +
              "</div>" +
              '<p class="hoc-cartitem__price">' +
              HOC.data.money((b.price + p.delta) * i.qty) +
              "</p>" +
              "</article>"
            );
          })
          .join("") + upsell();
    }

    /* One upsell, never a bundle wall §55 */
    function upsell() {
      var have = bag.items.map(function (i) {
        return i.slug;
      });
      var pick = null;
      HOC.data.blends.some(function (b) {
        if (have.indexOf(b.slug) === -1) {
          pick = b;
          return true;
        }
        return false;
      });
      if (!pick) return "";
      return (
        '<div class="hoc-upsell">' +
        '<img src="' + (HOC.assetBase || '') + 'assets/img/pack-' +
        pick.slug +
        '-420.webp" alt="" width="420" height="663" loading="lazy">' +
        "<div><p class=\"hoc-micro\">Try another ritual.</p>" +
        '<p class="hoc-cartitem__name">' +
        pick.name +
        "</p></div>" +
        '<button class="hoc-link" data-hoc-upsell="' +
        pick.slug +
        '">Add</button>' +
        "</div>"
      );
    }

    function set(next) {
      if (next === open) return;
      open = next;
      if (open) {
        lastFocus = doc.activeElement;
        el.hidden = false;
        void el.offsetHeight;
      }
      el.classList.toggle("is-open", open);
      HOC.lock(open);
      if (open) {
        untrap = trapFocus(el);
        var close = $('[data-hoc="drawer-close"]', el);
        if (close && close.focus) close.focus();
      } else {
        if (untrap) untrap();
        untrap = null;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        root.setTimeout(function () {
          if (!open) el.hidden = true;
        }, 600);
      }
    }

    return {
      init: function () {
        offs.push(
          HOC.bind("bagopen", function () {
            set(true);
          })
        );
        if (!SHOPIFY) offs.push(HOC.bind("bagchange", render));
        offs.push(
          on(el, "click", function (e) {
            var t = e.target;
            if (t.closest('[data-hoc="drawer-close"]')) return set(false);
            var up = t.closest("[data-hoc-upsell]");
            if (up && !SHOPIFY) return bag.add(up.getAttribute("data-hoc-upsell"), "doypack");
            var step = t.closest("[data-step]");
            if (step && !SHOPIFY) {
              var item = step.closest(".hoc-cartitem");
              var out = $("output", item);
              bag.setQty(
                item.getAttribute("data-slug"),
                item.getAttribute("data-pack"),
                parseInt(out.textContent, 10) +
                  parseInt(step.getAttribute("data-step"), 10)
              );
            }
          })
        );
        offs.push(
          on(doc, "keydown", function (e) {
            if (e.key === "Escape" && open) set(false);
          })
        );
        if (!SHOPIFY) render();
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (untrap) untrap();
      }
    };
  });

  /* ======================================================================
     9. FEATURED BLENDS  §11
     Tab switching, price by packaging, accent hand-off. The choreographed
     pack transition is upgraded by hoc-motion.js; this is the honest
     no-GSAP version.
     ====================================================================== */

  HOC.controller("featured", function (el) {
    var offs = [];
    var embla = null;
    var current = null;

    function select(slug, focus) {
      if (slug === current) return;
      current = slug;
      var panel = $('[data-panel="' + slug + '"]', el);

      $$('[data-hoc="blend-select"]', el).forEach(function (t) {
        var on_ = t.getAttribute("data-blend") === slug;
        t.setAttribute("aria-selected", String(on_));
        t.tabIndex = on_ ? 0 : -1;
        if (on_ && focus) t.focus();
      });
      $$("[data-panel]", el).forEach(function (p) {
        var on_ = p.getAttribute("data-panel") === slug;
        p.hidden = !on_;
        p.classList.toggle("is-active", on_);
      });

      // Section-level accent so the ground glow and CTA follow the blend.
      if (panel) ["--accent", "--accent-2", "--accent-wash", "--accent-ink"].forEach(function (name) {
        var value = panel.style.getPropertyValue(name);
        if (value) el.style.setProperty(name, value);
      });

      HOC.emit("blendchange", { slug: slug, el: el });

      // Fallback pack swap. hoc-motion.js intercepts blendchange and does the
      // choreographed version instead, so this only runs bare.
      if (!HOC.motionReady) {
        $$(".hoc-pack", el).forEach(function (p) {
          var on_ = p.getAttribute("data-pack") === slug;
          p.classList.toggle("is-active", on_);
          p.setAttribute("aria-hidden", String(!on_));
        });
      }
    }

    function price(panel) {
      var out = $('[data-hoc="price"]', panel);
      var chosen = $('[data-hoc="pack-option"]:checked', panel);
      if (!out || !chosen) return;
      if (chosen.dataset.price) out.textContent = chosen.dataset.price;
      else if (HOC.data) out.textContent = HOC.data.money(
        parseInt(out.getAttribute("data-base"), 10) +
          parseInt(chosen.getAttribute("data-delta"), 10)
      );
    }

    return {
      init: function () {
        var tabs = $$('[data-hoc="blend-select"]', el);
        current = tabs.length ? tabs[0].getAttribute("data-blend") : null;

        offs.push(
          on(el, "click", function (e) {
            var t = e.target.closest('[data-hoc="blend-select"]');
            if (t) select(t.getAttribute("data-blend"));
          })
        );

        // Hover-to-preview on pointer devices §11
        if (!HOC.env.touch) {
          tabs.forEach(function (t) {
            offs.push(
              on(t, "mouseenter", function () {
                select(t.getAttribute("data-blend"));
              })
            );
          });
        }

        // Roving tabindex §45
        offs.push(
          on(el, "keydown", function (e) {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) < 0)
              return;
            if (!e.target.closest('[data-hoc="blend-select"]')) return;
            e.preventDefault();
            var i = tabs.indexOf(e.target.closest('[data-hoc="blend-select"]'));
            var n =
              e.key === "Home"
                ? 0
                : e.key === "End"
                ? tabs.length - 1
                : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length;
            select(tabs[n].getAttribute("data-blend"), true);
          })
        );

        $$('[data-hoc="pack-option"]', el).forEach(function (r) {
          offs.push(
            on(r, "change", function () {
              price(r.closest("[data-panel]"));
            })
          );
        });
        $$("[data-panel]", el).forEach(price);

        // Mobile: the tab strip is a carousel §11
        if (root.EmblaCarousel) {
          var vp = $('[data-hoc="selector-embla"]', el);
          if (vp && HOC.env.narrow) {
            embla = root.EmblaCarousel(vp, {
              align: "start",
              containScroll: "trimSnaps",
              dragFree: true
            });
          }
        }

        offs.push(
          HOC.bind("blendselect", function (e) {
            select(e.detail);
          })
        );
      },
      resize: function () {
        if (embla && !HOC.env.narrow) {
          embla.destroy();
          embla = null;
        }
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (embla) embla.destroy();
      }
    };
  });

  /* ======================================================================
     10. PRODUCT RAIL  §17 §34
     Embla v8. Drag, momentum, no fake scrollbar.
     ====================================================================== */

  HOC.controller("rail", function (el) {
    var embla = null;
    var offs = [];
    var bar = $('[data-hoc="rail-bar"] span');
    var prev = $('[data-hoc="rail-prev"]');
    var next = $('[data-hoc="rail-next"]');

    function sync() {
      if (!embla) return;
      if (prev) prev.disabled = !embla.canScrollPrev();
      if (next) next.disabled = !embla.canScrollNext();
      if (bar) {
        var p = embla.scrollProgress();
        var snaps = embla.scrollSnapList().length;
        var w = Math.max(0.12, 1 / Math.max(snaps, 1));
        bar.style.width = w * 100 + "%";
        bar.style.transform =
          "translateX(" + p * (100 / w - 100) + "%)";
      }
    }

    return {
      init: function () {
        if (!root.EmblaCarousel) return;
        embla = root.EmblaCarousel(el, {
          align: "start",
          containScroll: "trimSnaps",
          dragFree: false,
          skipSnaps: false
        });
        embla.on("select", sync);
        embla.on("scroll", sync);
        embla.on("reInit", sync);
        if (prev)
          offs.push(
            on(prev, "click", function () {
              embla.scrollPrev();
            })
          );
        if (next)
          offs.push(
            on(next, "click", function () {
              embla.scrollNext();
            })
          );
        sync();
      },
      resize: function () {
        if (embla) embla.reInit();
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (embla) embla.destroy();
      }
    };
  });

  /* ======================================================================
     11. INGREDIENT ATLAS  §16

     A grid of botanicals driving one large lead panel. Deliberately not a
     grid of hover-only tooltips: §45 rules hover-only content out, and §16
     actually describes this layout — a big drawing with its facts beside it
     and the small labels around.
     ====================================================================== */

  HOC.controller("atlas", function (el) {
    var offs = [];
    var lead = $("#atlas-lead", el);
    var art = $('[data-hoc="atlas-art"]', el);
    var items = $$(".hoc-atlas__item", el);
    var current = null;

    /* Facts come from the element's own data-* attributes when they are there
       (that is what the Liquid section emits, straight off the `ingredient`
       metaobject) and from HOC.data in the static prototype. One controller,
       two back ends. */
    function factsFor(slug) {
      var li = null;
      items.forEach(function (n) {
        if (n.getAttribute("data-ing") === slug) li = n;
      });
      if (li && li.hasAttribute("data-name")) {
        return {
          name: li.getAttribute("data-name"),
          botanical: li.getAttribute("data-botanical"),
          profile: li.getAttribute("data-profile"),
          aroma: li.getAttribute("data-aroma"),
          color: li.getAttribute("data-color"),
          note: li.getAttribute("data-note"),
          accent: getComputedStyle(li).getPropertyValue("--accent").trim()
        };
      }
      return HOC.data && HOC.data.ingredient ? HOC.data.ingredient(slug) : null;
    }

    function pick(slug, viaPointer) {
      if (!slug || slug === current) return;
      var ing = factsFor(slug);
      if (!ing || !lead) return;
      current = slug;

      lead.style.setProperty("--accent", ing.accent);
      ["name", "botanical", "profile", "aroma", "color", "note"].forEach(
        function (k) {
          var n = $('[data-fact="' + k + '"]', lead);
          if (n && ing[k]) n.textContent = ing[k];
        }
      );
      if (art) {
        var use = $("use", art);
        if (use) use.setAttribute("href", "#b-" + slug);
      }

      items.forEach(function (li) {
        var on_ = li.getAttribute("data-ing") === slug;
        li.classList.toggle("is-on", on_);
        var b = $("button", li);
        if (b) b.setAttribute("aria-pressed", String(on_));
      });

      HOC.emit("atlaspick", { slug: slug, art: art, pointer: !!viaPointer });
    }

    return {
      init: function () {
        current = items.length ? items[0].getAttribute("data-ing") : null;
        offs.push(
          on(el, "click", function (e) {
            var b = e.target.closest('[data-hoc="atlas-pick"]');
            if (b) pick(b.getAttribute("data-ing"));
          })
        );
        offs.push(
          on(el, "focusin", function (e) {
            var b = e.target.closest('[data-hoc="atlas-pick"]');
            if (b) pick(b.getAttribute("data-ing"));
          })
        );
        if (!HOC.env.touch) {
          offs.push(
            on(el, "mouseover", function (e) {
              var b = e.target.closest('[data-hoc="atlas-pick"]');
              if (b) pick(b.getAttribute("data-ing"), true);
            })
          );
        }
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
      }
    };
  });

  /* ======================================================================
     12. MOODS  §15 — the accessible core. The floating desktop preview and
     the scramble micro-copy are added in hoc-motion.js.
     ====================================================================== */

  HOC.controller("mood-list", function (el) {
    var offs = [];
    return {
      init: function () {
        offs.push(
          on(el, "click", function (e) {
            var btn = e.target.closest('[data-hoc="mood"]');
            if (!btn) return;
            var li = btn.closest(".hoc-mood");
            if (!HOC.env.touch && !HOC.env.narrow) {
              var href = btn.getAttribute("data-product-url");
              if (href) root.location.href = href;
              return;
            }
            // Desktop hover handles preview; click opens the inline panel,
            // which is the only mode on touch.
            var open = li.classList.toggle("is-open");
            btn.setAttribute("aria-expanded", String(open));
            $$(".hoc-mood", el).forEach(function (o) {
              if (o !== li) {
                o.classList.remove("is-open");
                var b = $('[data-hoc="mood"]', o);
                if (b) b.setAttribute("aria-expanded", "false");
              }
            });
          })
        );
        if (!HOC.env.touch) {
          offs.push(
            on(el, "mouseover", function (e) {
              var btn = e.target.closest('[data-hoc="mood"]');
              if (!btn) return;
              var li = btn.closest(".hoc-mood");
              if (li.classList.contains("is-on")) return;
              $$(".hoc-mood", el).forEach(function (o) {
                o.classList.toggle("is-on", o === li);
              });
              HOC.emit("moodenter", li);
            })
          );
          offs.push(
            on(el, "mouseleave", function () {
              $$(".hoc-mood", el).forEach(function (o) {
                o.classList.remove("is-on");
              });
              HOC.emit("moodleave");
            })
          );
          offs.push(
            on(el, "focusin", function (e) {
              var li = e.target.closest(".hoc-mood");
              if (!li) return;
              $$(".hoc-mood", el).forEach(function (o) {
                o.classList.toggle("is-on", o === li);
              });
              HOC.emit("moodenter", li);
            })
          );
        }
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
      }
    };
  });

  /* ======================================================================
     13. RITUAL  §20
     ====================================================================== */

  HOC.controller("ritual", function (el) {
    var offs = [];
    var steps = $$(".hoc-ritual__step", el);
    var frames = $$(".hoc-ritual__frame", el);
    var progress = $('[data-hoc="ritual-progress"]', el);

    function set(i) {
      if (i < 0 || i >= steps.length) return;
      steps.forEach(function (s, n) {
        s.classList.toggle("is-on", n === i);
        var button = $("button", s);
        if (button) button.setAttribute("aria-pressed", String(n === i));
      });
      frames.forEach(function (f, n) {
        f.classList.toggle("is-on", n === i);
      });
      if (progress) {
        progress.textContent = String(i + 1).padStart(2, "0") + " / " + String(steps.length).padStart(2, "0");
      }
    }

    return {
      init: function () {
        offs.push(
          on(el, "click", function (e) {
            var b = e.target.closest('[data-hoc="ritual-step"]');
            if (!b) return;
            set(steps.indexOf(b.closest(".hoc-ritual__step")));
          })
        );
        steps.forEach(function (s, i) {
          if (!HOC.env.touch) {
            offs.push(on(s, "mouseenter", function () { set(i); }));
          }
          offs.push(on(s, "focusin", function () { set(i); }));
        });
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
      }
    };
  });

  /* ======================================================================
     14. NEWSLETTER
     ====================================================================== */

  HOC.controller("newsletter", function (form) {
    var msg = $('[data-hoc="newsletter-msg"]', form);
    var off;
    return {
      init: function () {
        off = on(form, "submit", function (e) {
          e.preventDefault();
          var input = $("input[type=email]", form);
          var ok = input.value && /.+@.+\..+/.test(input.value);
          msg.textContent = ok
            ? "Thank you — check your inbox."
            : "That email doesn't look right.";
          msg.style.color = ok ? "" : "#d08a6e";
          if (ok) form.reset();
        });
      },
      destroy: function () {
        if (off) off();
      }
    };
  });

  /* ======================================================================
     15. SHOPIFY AJAX CART  §55 §57

     Active only when layout/theme.liquid has published window.HOC.routes. In
     the static prototype those routes do not exist and the in-memory bag above
     stays in charge, so one build of this file serves both.

     After an add or a quantity change the drawer is re-requested from Shopify
     with ?sections=<id> and its body swapped in. That is the Section Rendering
     API path Shopify's performance guidance recommends over a full reload, and
     it keeps the drawer markup in Liquid rather than in a JS template.
     ====================================================================== */

  var SHOPIFY = !!(root.HOC && root.HOC.routes && root.HOC.routes.cartAdd);

  function drawerEl() {
    return $('[data-hoc="drawer"]');
  }

  function busy(on_) {
    var d = drawerEl();
    if (d) d.classList.toggle("is-busy", !!on_);
  }

  function refreshDrawer() {
    var d = drawerEl();
    if (!d) return Promise.resolve();
    var id = d.getAttribute("data-section-id");
    if (!id) return Promise.resolve();

    return fetch(root.HOC.routes.cart + "?sections=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" }
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        var html = json[id];
        if (!html) return;
        var parsed = new DOMParser().parseFromString(html, "text/html");
        var fresh = parsed.querySelector('[data-hoc="drawer"]');
        if (!fresh) return;

        // Swap only what changes. Never the panel itself, or an in-flight
        // open/close transition restarts.
        var body = $('[data-hoc="drawer-items"]', d);
        var freshBody = fresh.querySelector('[data-hoc="drawer-items"]');
        if (body && freshBody) body.innerHTML = freshBody.innerHTML;

        var foot = $(".hoc-drawer__foot", d);
        var freshFoot = fresh.querySelector(".hoc-drawer__foot");
        if (foot && freshFoot) foot.innerHTML = freshFoot.innerHTML;

        var count = fresh.querySelector('[data-hoc="bag-count"]');
        if (count) {
          $$('[data-hoc="bag-count"]').forEach(function (c) {
            c.textContent = count.textContent;
          });
        }
        HOC.emit("cartrendered", d);
      })
      .catch(function (e) {
        console.error("[hoc] drawer refresh failed", e);
      });
  }
  HOC.refreshDrawer = refreshDrawer;

  function ajaxAdd(form) {
    busy(true);
    return fetch(root.HOC.routes.cartAdd, {
      method: "POST",
      headers: { Accept: "application/javascript" },
      body: new FormData(form)
    })
      .then(function (r) {
        if (!r.ok) throw new Error("add failed: " + r.status);
        return r.json();
      })
      .then(refreshDrawer)
      .then(function () {
        HOC.emit("bagopen");
      })
      .catch(function (e) {
        // Fall back to a real form post rather than silently doing nothing.
        console.error("[hoc] ajax add failed, posting the form", e);
        form.submit();
      })
      .then(function () {
        busy(false);
      });
  }

  function ajaxChange(key, qty) {
    busy(true);
    return fetch(root.HOC.routes.cartChange, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/javascript"
      },
      body: JSON.stringify({ id: key, quantity: qty })
    })
      .then(refreshDrawer)
      .catch(function (e) {
        console.error("[hoc] ajax change failed", e);
      })
      .then(function () {
        busy(false);
      });
  }

  if (SHOPIFY) {
    // Quick-add and the featured panel both post a real <form> (§56), so a
    // no-JS visitor still reaches the cart. Intercept the submit instead.
    on(doc, "submit", function (e) {
      var form = e.target.closest && e.target.closest('[data-hoc="add-form"]');
      if (!form) return;
      e.preventDefault();
      ajaxAdd(form);
    });

    on(doc, "click", function (e) {
      var step = e.target.closest && e.target.closest("[data-step][data-key]");
      if (!step) return;
      var item = step.closest(".hoc-cartitem");
      var out = item && $("output", item);
      if (!out) return;
      e.preventDefault();
      ajaxChange(
        step.getAttribute("data-key"),
        parseInt(out.textContent, 10) +
          parseInt(step.getAttribute("data-step"), 10)
      );
    });
  }

  /* ======================================================================
     15. BOOT
     ====================================================================== */

  function boot() {
    HOC.mount();
    // A pinned tier is a deliberate QA choice; don't let the sampler undo it.
    if (!forcedTier) HOC.ticker.add(sampleFrame);
    HOC.emit("ready");
  }

  if (doc.readyState === "loading")
    doc.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window, document);
