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
              '<div class="hoc-cartitem__thumb"><img src="' + (HOC.assetBase || '') + 'assets/img/pack-duo-' +
              b.slug +
              '.svg" alt="" width="700" height="640" loading="lazy"></div>' +
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
        '<img src="' + (HOC.assetBase || '') + 'assets/img/pack-duo-' +
        pick.slug +
        '.svg" alt="" width="700" height="640" loading="lazy">' +
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
          p.inert = !on_;
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

        // Roving tabindex §45
        offs.push(
          on(el, "keydown", function (e) {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) < 0)
              return;
            if (!e.target.closest('[data-hoc="blend-select"]')) return;
            e.preventDefault();
            var i = tabs.indexOf(e.target.closest('[data-hoc="blend-select"]'));
            var n =
              e.key === "Home"
                ? 0
                : e.key === "End"
                ? tabs.length - 1
                : (i + (["ArrowRight", "ArrowDown"].indexOf(e.key) >= 0 ? 1 : -1) + tabs.length) %
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

        offs.push(
          HOC.bind("blendselect", function (e) {
            select(e.detail);
          })
        );
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
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
     12b. COLOUR ALCHEMY  §14

     The working half of the section. It owns the reaction and everything
     you can read or operate — the button, the four pieces, the scale, the
     status line — and paints a plain SVG glass. hoc-motion.js lays the
     rendered glass over that by reading the same state (el.__alc), so the
     section makes the same sense with no WebGL, no GSAP, reduced motion, or
     inside the theme editor.

     The model is small on purpose; the point is that you can follow it.
       * each hibiscus piece is one fixed dose of acid (DOSE)
       * it lands T_FALL after it is added and gives its acid up over about
         a second (RELEASE) — the rendered plume shows it working locally
       * the glass as a whole follows the running total (FOLLOW)
       * four pieces turn it all the way
     Nobody has to do anything, either: a glass left in view untouched drops
     its own pieces, one every few seconds, and puts itself back once it has
     scrolled away so the next visit sees it happen too.
     ====================================================================== */

  // Glass geometry in the shader's units — x across, y up, the vessel box
  // spanning -1..1. Must match HOC.shaderAlchemy.
  var ALC_E = 0.15,
    ALC_W_TOP = 0.455,
    ALC_W_BOT = 0.395,
    ALC_WALL = 0.018,
    ALC_T_FALL = 0.62;
  var ALC_Y_TOP = 1 - ALC_E * ALC_W_TOP;
  var ALC_Y_BOT = -1 + ALC_E * ALC_W_BOT;
  var ALC_Y_INB = ALC_Y_BOT + 0.08;
  var ALC_Y_FULL = ALC_Y_TOP - 0.22;
  // The liquid as it reads at the centre of the rendered glass.
  var ALC_RAMP = [
    [22, 47, 168],
    [98, 38, 169],
    [195, 28, 98]
  ];
  // QA: ?hocdemo=off keeps the glass from dropping its own pieces, so a
  // check can walk the states in a known order. Read-only, like ?hoctier=.
  var ALC_NO_DEMO = /[?&]hocdemo=off/.test(root.location.search);

  function alcStep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /** Same ramp as the shader's pigment(): violet at 0.5, magenta at 1. */
  function alcColour(level) {
    var s1 = alcStep(0, 0.5, level),
      s2 = alcStep(0.5, 1, level),
      out = [];
    for (var i = 0; i < 3; i++) {
      var v = ALC_RAMP[0][i] + (ALC_RAMP[1][i] - ALC_RAMP[0][i]) * s1;
      out.push(Math.round(v + (ALC_RAMP[2][i] - v) * s2));
    }
    return "rgb(" + out.join(" ") + ")";
  }

  function alcSurface(fill) {
    return ALC_Y_INB + 0.02 + (ALC_Y_FULL - ALC_Y_INB - 0.02) * fill;
  }

  function alcHalfWidth(y) {
    var k = Math.min(1, Math.max(0, (y - ALC_Y_BOT) / (ALC_Y_TOP - ALC_Y_BOT)));
    return ALC_W_BOT + (ALC_W_TOP - ALC_W_BOT) * k;
  }

  /** Where a piece is at time t — the same path the shader draws. */
  function alcPiece(d, t, ySurf) {
    var age = t - d.t0;
    var air = age <= ALC_T_FALL;
    var ft = Math.min(Math.max(age, 0), ALC_T_FALL) / ALC_T_FALL;
    var sink = Math.max(age - ALC_T_FALL, 0);
    var depth =
      Math.max(ySurf - ALC_Y_INB - 0.12, 0) * (1 - Math.exp(-sink / 1.9));
    var sway =
      0.028 * Math.sin(sink * 1.6 + d.seed * 6.2832) * (1 - Math.exp(-sink * 0.9));
    var yStart = ALC_Y_TOP + 0.34;
    return {
      air: air,
      x: d.x + sway,
      y: air ? yStart + (ySurf - yStart) * ft * ft : ySurf - depth,
      r:
        d.seed * 6.2832 +
        (air ? age * 1.6 : ALC_T_FALL * 1.6 + 0.35 * Math.sin(sink * 1.1 + d.seed * 4)),
      s: 0.09 * (0.88 + 0.24 * ((d.seed * 13.7) % 1))
    };
  }

  HOC.controller("alchemy", function (el) {
    var offs = [];
    var stage = $(".hoc-alchemy__stage", el);
    var vessel = $('[data-hoc="alchemy-vessel"]', el);
    var btn = $('[data-hoc="alchemy-add"]', el);
    var btnLabel = $('[data-hoc="alchemy-add-label"]', el);
    var status = $('[data-hoc="alchemy-status"]', el);
    var stops = $$("[data-stop]", el);
    var dots = $$(".hoc-alchemy__dots i", el);
    var svg = $(".hoc-alchemy__glass", el);
    var sprites = el.getAttribute("data-sprites") || "";

    var FULL = 4; // pieces that turn the glass all the way
    var DOSE = 0.28; // acid per piece; four overshoot 1 so the last one lands
    var RELEASE = 1.0; // s for a landed piece to give up its acid
    var FOLLOW = 1.1; // s for the whole glass to catch up
    var DRAIN = 0.6;
    var REFILL = 1.0;
    // Where pieces go in, in glass units: spread out, never stacked.
    var SPOTS = [-0.12, 0.1, -0.02, 0.15];

    var text = {
      add: el.getAttribute("data-label-add") || "Add hibiscus",
      again: el.getAttribute("data-label-again") || "Start again",
      added:
        el.getAttribute("data-msg-added") ||
        "Hibiscus added, {n} of {total}. The tea is turning {colour}.",
      fresh:
        el.getAttribute("data-msg-fresh") || "A fresh glass. Deep blue again."
    };

    var origin = performance.now();
    var S = (el.__alc = {
      drops: [], // { x, t0, k: plume strength, seed }
      level: 0, // 0 blue … 0.5 violet … 1 magenta
      fill: 1, // liquid height; drains and refills on "Start again"
      fade: 0, // clears pieces and plumes while it drains
      ghostX: 0,
      ghostA: 0,
      ghostOn: false,
      visible: false,
      still: false, // reduced motion: no clock, pieces arrive settled
      frozen: 100, // the clock value a still glass is drawn at
      now: function () {
        return (performance.now() - origin) / 1000;
      }
    });

    var io = null,
      ioGlass = null,
      ioNear = null,
      last = 0,
      touched = false, // any real input ends the self-running demo for good
      demoAt = 0,
      reset = null,
      nudge = 0,
      seedN = 0,
      shown = { level: -1, stage: -1, complete: null };

    var NS = "http://www.w3.org/2000/svg";
    var gLiquid = svg ? $$(".hoc-alchemy__g-liquid", svg) : [];
    var gColumn = svg ? $$(".hoc-alchemy__g-body, .hoc-alchemy__g-tint", svg) : [];
    var gSurface = svg ? $$(".hoc-alchemy__g-surface", svg) : [];
    var gSunk = svg && $(".hoc-alchemy__g-sunk", svg);
    var gAir = svg && $(".hoc-alchemy__g-air", svg);
    var pieces = [];

    function frac(v) {
      return v - Math.floor(v);
    }
    function clamp(v, a, b) {
      return v < a ? a : v > b ? b : v;
    }
    function isStill() {
      return !!HOC.env.reduced || HOC.env.tier === "reduced";
    }

    function say(msg) {
      if (!status) return;
      status.textContent = "";
      root.setTimeout(function () {
        status.textContent = msg;
      }, 60);
    }

    function stopName(i) {
      var n = stops[i] && $("[data-stop-name]", stops[i]);
      return n
        ? n.textContent.trim().toLowerCase()
        : ["blue", "violet", "magenta"][i];
    }

    /** Total acid released by time t. */
    function target(t) {
      var sum = 0;
      for (var i = 0; i < S.drops.length; i++) {
        var a = t - S.drops[i].t0 - ALC_T_FALL;
        if (a > 0) sum += DOSE * (1 - Math.exp(-a / RELEASE));
      }
      return Math.min(1, sum);
    }

    function syncControls() {
      var n = S.drops.length;
      var full = n >= FULL;
      dots.forEach(function (d, i) {
        d.classList.toggle("is-on", i < n);
      });
      if (btnLabel) btnLabel.textContent = full ? text.again : text.add;
      if (btn) {
        btn.setAttribute("data-mode", full ? "again" : "add");
        // aria-disabled, not disabled: a focused button must keep focus.
        btn.setAttribute("aria-disabled", reset ? "true" : "false");
      }
      el.classList.toggle("is-full", full);
      el.classList.toggle("is-resetting", !!reset);
    }

    function add(x, byUser) {
      if (reset || S.drops.length >= FULL) return false;
      if (byUser) touched = true;
      seedN++;
      var t = S.still ? S.frozen : S.now();
      S.drops.push({
        x: clamp(x, -0.3, 0.3),
        t0: S.still ? t - 60 : t, // reduced motion: already there, settled
        k: 0.9 + 0.2 * frac(seedN * 0.618034),
        seed: frac(seedN * 0.754878 + 0.137)
      });
      var n = S.drops.length;
      if (byUser) {
        say(
          text.added
            .replace("{n}", n)
            .replace("{total}", FULL)
            .replace("{colour}", stopName(n < 3 ? 1 : 2))
        );
      }
      syncControls();
      return true;
    }

    function empty() {
      S.drops.length = 0;
      S.level = 0;
      S.fade = 0;
    }

    function startReset() {
      if (reset) return;
      touched = true;
      if (S.still) {
        empty();
        S.fill = 1;
        say(text.fresh);
        syncControls();
        return;
      }
      reset = { t: S.now(), drained: false };
      syncControls();
    }

    function stepReset(t) {
      var a = t - reset.t;
      if (!reset.drained) {
        var k = Math.min(1, a / DRAIN);
        S.fill = 1 - k * k * (3 - 2 * k);
        S.fade = k;
        if (k >= 1) {
          empty();
          S.fill = 0;
          reset.drained = true;
          reset.t = t;
        }
        return;
      }
      var b = Math.min(1, a / REFILL);
      S.fill = 1 - Math.pow(1 - b, 3);
      if (b >= 1) {
        S.fill = 1;
        reset = null;
        say(text.fresh);
        syncControls();
      }
    }

    /* ---- the SVG glass ------------------------------------------------ */
    function makePiece() {
      var g = doc.createElementNS(NS, "g");
      var box = doc.createElementNS(NS, "svg");
      var im = doc.createElementNS(NS, "image");
      box.setAttribute("x", "-1");
      box.setAttribute("y", "-1");
      box.setAttribute("width", "2");
      box.setAttribute("height", "2");
      box.setAttribute("viewBox", "0 0 256 256");
      box.setAttribute("overflow", "hidden");
      im.setAttribute("href", sprites);
      im.setAttribute("width", "512");
      im.setAttribute("height", "256");
      box.appendChild(im);
      g.appendChild(box);
      return g;
    }

    function paintGlass(t) {
      var ys = alcSurface(S.fill);
      var ws = alcHalfWidth(ys) - ALC_WALL;
      var top = (-ys).toFixed(4);
      var tall = (1 + ys).toFixed(4);
      gLiquid.forEach(function (g) {
        g.style.opacity = S.fill > 0.03 ? "1" : "0";
      });
      gColumn.forEach(function (r) {
        r.setAttribute("y", top);
        r.setAttribute("height", tall);
      });
      gSurface.forEach(function (e) {
        e.setAttribute("cy", top);
        e.setAttribute("rx", ws.toFixed(4));
        e.setAttribute("ry", (ALC_E * ws).toFixed(4));
      });

      while (pieces.length > S.drops.length) {
        var old = pieces.pop();
        if (old.parentNode) old.parentNode.removeChild(old);
      }
      while (pieces.length < S.drops.length) pieces.push(makePiece());
      var clock = S.still ? S.frozen : t;
      for (var i = 0; i < S.drops.length; i++) {
        var p = alcPiece(S.drops[i], clock, ys);
        var g = pieces[i];
        var home = p.air ? gAir : gSunk;
        if (home && g.parentNode !== home) home.appendChild(g);
        g.setAttribute(
          "transform",
          "translate(" + p.x.toFixed(4) + " " + (-p.y).toFixed(4) + ") rotate(" +
            (-p.r * 57.29578).toFixed(2) + ") scale(" + p.s.toFixed(4) + ")"
        );
        g.style.opacity = String(1 - S.fade);
      }
    }

    function paint(t) {
      if (Math.abs(S.level - shown.level) > 0.0015) {
        shown.level = S.level;
        el.style.setProperty("--alc-level", S.level.toFixed(4));
        el.style.setProperty("--alc-liquid", alcColour(S.level));
      }
      var st = S.level < 0.2 ? 0 : S.level < 0.7 ? 1 : 2;
      if (st !== shown.stage) {
        shown.stage = st;
        el.setAttribute("data-stage", String(st));
        stops.forEach(function (s, i) {
          if (i === st) s.setAttribute("aria-current", "step");
          else s.removeAttribute("aria-current");
        });
      }
      var done = S.drops.length >= FULL && S.level > 0.9 && !reset;
      if (done !== shown.complete) {
        shown.complete = done;
        el.classList.toggle("is-complete", done);
      }
      if (svg && !el.classList.contains("is-gl")) paintGlass(t);
    }

    function tick() {
      var t = S.now();
      var dt = Math.min(0.1, Math.max(0, t - last));
      last = t;

      if (demoAt && t >= demoAt) {
        demoAt = 0;
        if (S.ghostOn) demoAt = t + 1.2; // someone is about to click: wait
        else if (!touched && !reset && S.drops.length < FULL) {
          add(SPOTS[S.drops.length], false);
          if (S.drops.length < FULL) demoAt = t + 2.8;
        }
      }
      if (reset) stepReset(t);
      if (nudge && t > nudge) {
        nudge = 0;
        if (btn) btn.classList.remove("is-nudge");
      }

      // A still glass times its pieces on the frozen clock, so read the acid
      // off that clock too.
      var goal = target(S.still ? S.frozen : t);
      S.level += (goal - S.level) * (1 - Math.exp(-dt / (S.still ? 0.3 : FOLLOW)));
      if (Math.abs(goal - S.level) < 0.0004) S.level = goal;

      var g = S.ghostOn && !reset && S.drops.length < FULL ? 1 : 0;
      S.ghostA += (g - S.ghostA) * (1 - Math.exp(-dt / 0.14));
      if (S.ghostA < 0.002 && !g) S.ghostA = 0;

      paint(t);
    }

    // The sprite sheet (the flowers, the pieces, the button's icon) is
    // referenced by data- attributes only, so it costs nothing on first
    // paint; it is attached once the section is within a screen of view.
    function attachArt() {
      $$("image[data-href]", el).forEach(function (im) {
        im.setAttribute("href", im.getAttribute("data-href"));
      });
      $$("[data-bg]", el).forEach(function (n) {
        n.style.backgroundImage = "url('" + n.getAttribute("data-bg") + "')";
      });
    }

    function glassX(e) {
      var r = vessel.getBoundingClientRect();
      return (e.clientX - (r.left + r.width / 2)) / (r.height / 2);
    }

    function armDemo(delay) {
      if (ALC_NO_DEMO || touched || S.still || reset || demoAt) return;
      if (S.drops.length < FULL) demoAt = S.now() + delay;
    }

    return {
      init: function () {
        if (!vessel || !btn) return;
        S.still = isStill();

        offs.push(
          on(btn, "click", function () {
            if (reset) return;
            if (S.drops.length >= FULL) startReset();
            else
              add(
                SPOTS[S.drops.length] + (frac(seedN * 0.381966) - 0.5) * 0.06,
                true
              );
          })
        );
        if (stage) {
          offs.push(
            on(stage, "click", function (e) {
              if (reset) return;
              if (S.drops.length >= FULL) {
                // Nothing left to add — point at what you can do instead.
                touched = true;
                btn.classList.add("is-nudge");
                nudge = S.now() + 0.7;
                return;
              }
              add(glassX(e), true);
            })
          );
          offs.push(
            on(stage, "pointermove", function (e) {
              if (e.pointerType !== "mouse") return;
              S.ghostOn = true;
              S.ghostX = clamp(glassX(e), -0.3, 0.3);
            })
          );
          offs.push(
            on(stage, "pointerleave", function () {
              S.ghostOn = false;
            })
          );
        }

        offs.push(
          HOC.bind("tierchange", function () {
            var still = isStill();
            if (still === S.still) return;
            S.still = still;
            if (!still) {
              // Motion back on: the pieces stay settled, now on the live clock.
              S.drops.forEach(function (d) {
                d.t0 = S.now() - 60;
              });
              return;
            }
            // Motion switched off mid-reaction: settle everything where it
            // was headed, now.
            demoAt = 0;
            S.frozen = Math.max(100, S.now());
            S.drops.forEach(function (d) {
              d.t0 = S.frozen - 60;
            });
            if (reset) {
              reset = null;
              empty();
              S.fill = 1;
              syncControls();
            }
          })
        );

        if ("IntersectionObserver" in root) {
          ioNear = new IntersectionObserver(
            function (entries) {
              if (!entries[entries.length - 1].isIntersecting) return;
              attachArt();
              ioNear.disconnect();
            },
            { rootMargin: "0px 0px 100% 0px" }
          );
          ioNear.observe(el);
          io = new IntersectionObserver(function (entries) {
            var vis = entries[entries.length - 1].isIntersecting;
            if (vis === S.visible) return;
            S.visible = vis;
            if (vis) {
              last = S.now();
              HOC.ticker.add(tick);
              return;
            }
            HOC.ticker.remove(tick);
            demoAt = 0;
            // Nobody touched it: put it back so the next visit sees it.
            if (!touched && !reset && S.drops.length) {
              empty();
              syncControls();
              paint(S.now());
            }
          });
          io.observe(el);
          // The demo only starts once most of the glass is actually on
          // screen, and pauses while it is not.
          ioGlass = new IntersectionObserver(
            function (entries) {
              var e = entries[entries.length - 1];
              if (e.isIntersecting && e.intersectionRatio >= 0.55)
                armDemo(S.drops.length ? 1.2 : 1.6);
              else demoAt = 0;
            },
            { threshold: [0, 0.55] }
          );
          ioGlass.observe(vessel);
        } else {
          attachArt();
          S.visible = true;
          HOC.ticker.add(tick);
        }

        syncControls();
        paint(0);
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (io) io.disconnect();
        if (ioGlass) ioGlass.disconnect();
        if (ioNear) ioNear.disconnect();
        HOC.ticker.remove(tick);
        pieces.forEach(function (g) {
          if (g.parentNode) g.parentNode.removeChild(g);
        });
        delete el.__alc;
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
