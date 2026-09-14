/* ==========================================================================
   HOC TEA — hoc-motion.js

   The creative layer. Loads after hoc-core.js and enhances a page that
   already works without it (§38). Nothing in here is required for a user to
   read a blend, choose packaging or reach the bag.

   Motion character: fluid, editorial, tactile, slow, controlled.
   Explicitly not: bounce, elastic, letter-scatter, scroll hijacking,
   site-wide custom cursors, marquees (§7, §59).
   ========================================================================== */

(function (root, doc) {
  "use strict";

  var HOC = (root.HOC = root.HOC || {});
  var gsap = root.gsap;

  if (!gsap) return; // page stays in its static, working state

  var ScrollTrigger = root.ScrollTrigger;
  var SplitText = root.SplitText;
  var CustomEase = root.CustomEase;
  var DrawSVGPlugin = root.DrawSVGPlugin;

  gsap.registerPlugin.apply(
    gsap,
    [ScrollTrigger, SplitText, CustomEase, DrawSVGPlugin, root.Flip,
     root.ScrambleTextPlugin, root.Observer].filter(Boolean)
  );

  /* ======================================================================
     1. THE HOC CURVE  §8
     Starting reference in the brief is cubic-bezier(.22,1,.36,1). Tuned here:
     a touch more authority off the mark and a longer settle, which is what
     makes the reveals read as editorial rather than springy.
     ====================================================================== */
  if (CustomEase) {
    CustomEase.create("hoc", "M0,0 C0.2,0.92 0.28,1 1,1");
    CustomEase.create("hoc.in", "M0,0 C0.62,0.05 0.3,1 1,1");
    CustomEase.create("hoc.scene", "M0,0 C0.16,0.86 0.2,1 1,1");
  }
  var EASE = CustomEase ? "hoc" : "power3.out";
  gsap.defaults({ ease: EASE, duration: 0.56 });

  HOC.motionReady = true;

  var env = HOC.env;
  var full = function () {
    return HOC.env.tier === "full";
  };
  var reduced = function () {
    return HOC.env.tier === "reduced";
  };

  /* ======================================================================
     2. SCROLL AUTHORITY  §30 §31
     Lenis is already running on the shared ticker in hoc-core.js. All
     ScrollTrigger needs is to be told when Lenis moved.
     ====================================================================== */
  if (ScrollTrigger) {
    if (HOC.lenis) {
      HOC.lenis.on("scroll", ScrollTrigger.update);
      ScrollTrigger.defaults({ ignoreMobileResize: true });
    }
    // Shopify's editor re-renders sections underneath us.
    HOC.on("resize", function () {
      ScrollTrigger.refresh();
    });
  }

  /* ======================================================================
     3. GLOBAL REVEALS  §12
     Line-mask reveal for display type; a quiet fade-up for everything else.
     ====================================================================== */

  function showAllSplits() {
    HOC.$$("[data-split]").forEach(function (el) {
      el.classList.add("is-split");
    });
  }

  function initSplits() {
    // Failsafe: whatever happens below — plugin missing, a font that never
    // resolves, an exception — no headline is left invisible.
    root.setTimeout(showAllSplits, 2500);

    if (!SplitText || !ScrollTrigger || reduced()) {
      showAllSplits();
      return;
    }

    HOC.$$('[data-split="lines"]').forEach(function (el) {
      try {
        SplitText.create(el, {
          type: "lines",
          mask: "lines", // 3.13 wraps each line so it can slide out of a mask
          autoSplit: true, // re-split on font load and on resize
          onSplit: function (self) {
            el.classList.add("is-split");
            return gsap.from(self.lines, {
              yPercent: 112,
              duration: 1.05,
              ease: EASE,
              stagger: 0.075,
              scrollTrigger: {
                trigger: el,
                start: "top 88%",
                once: true
              }
            });
          }
        });
      } catch (e) {
        el.classList.add("is-split");
      }
    });
  }

  function initReveals() {
    var nodes = HOC.$$("[data-reveal]");
    if (reduced() || !("IntersectionObserver" in root)) {
      nodes.forEach(function (n) {
        n.classList.add("is-in");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );
    nodes.forEach(function (n) {
      io.observe(n);
    });
  }

  /* ======================================================================
     4. HERO  §10  — SIGNATURE #1
     ====================================================================== */

  HOC.controller("hero", function (el) {
    var poster = HOC.$(".hoc-hero__poster", el);
    var video = HOC.$('[data-hoc="hero-video"]', el);
    var canvas = HOC.$('[data-hoc="hero-gl"]', el);
    var gl = null;
    var offs = [];
    var visible = true;
    var st = null;
    var holdTimer = 0;

    // pointer state, smoothed so the shader never snaps
    var px = 0.5,
      py = 0.5,
      tx = 0.5,
      ty = 0.5,
      vx = 0,
      vy = 0,
      lx = 0.5,
      ly = 0.5;

    function onMove(e) {
      var r = el.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width;
      ty = 1 - (e.clientY - r.top) / r.height; // GL origin is bottom-left
    }

    function tick(time) {
      if (!gl || !visible || gl.lost) return;
      px += (tx - px) * 0.075;
      py += (ty - py) * 0.075;
      // velocity = how far the smoothed pointer moved this frame
      vx += ((px - lx) * 26 - vx) * 0.1;
      vy += ((py - ly) * 26 - vy) * 0.1;
      lx = px;
      ly = py;
      gl.set("uPointer", [px, py])
        .set("uVel", [
          Math.max(-1, Math.min(1, vx)),
          Math.max(-1, Math.min(1, vy))
        ])
        .set("uTime", time / 1000)
        .render();
    }

    function startGL() {
      if (!poster || !canvas || !HOC.GL) return;
      if (!full() || HOC.designMode) return;

      gl = HOC.GL(canvas, HOC.shaderHero, { alpha: false });
      if (!gl) return;
      gl.resize(1.75)
        .set("uTexRes", [
          poster.naturalWidth || 1920,
          poster.naturalHeight || 1200
        ])
        .set("uIntensity", 1)
        .set("uPointer", [0.5, 0.5])
        .set("uVel", [0, 0]);

      // If the plate will not upload there is nothing to distort, and showing
      // the canvas anyway would cover the poster with an empty black quad.
      // This is the file:// case: a local image is cross-origin there.
      if (!gl.texture("uTex", poster)) {
        gl.destroy();
        gl = null;
        return;
      }

      gl.render();
      canvas.classList.add("is-live");
      HOC.ticker.add(tick);
    }

    function stopGL() {
      if (!gl) return;
      HOC.ticker.remove(tick);
      gl.destroy();
      gl = null;
      if (canvas) canvas.classList.remove("is-live");
    }

    return {
      init: function () {
        // --- headline: line-mask reveal, never character scatter (§10) ---
        // handled by initSplits(); the hero simply plays first.

        // --- the film, if one exists yet (§10, §47) ---------------------
        if (video) {
          var src = video.getAttribute("data-src");
          if (src && !reduced()) {
            var num = function (name, dflt) {
              var v = parseFloat(video.getAttribute(name));
              return isNaN(v) ? dflt : v;
            };
            var baseRate = num("data-rate", 1);
            var slowFrom = num("data-slow-from", 0);
            var slowRate = num("data-slow-rate", baseRate);
            var holdMs = num("data-hold", 0) * 1000;

            video.src = src;
            video.load();

            /* Pace the film without re-encoding it: hold the base rate through
               the body, then ease down to slowRate across the ending so the
               logo resolves slowly instead of arriving all at once. */
            offs.push(
              HOC.onEl(video, "timeupdate", function () {
                var dur = video.duration;
                if (!dur || !isFinite(dur)) return;
                var rate = baseRate;
                if (slowFrom > 0 && video.currentTime > slowFrom) {
                  var k = Math.min(
                    1,
                    (video.currentTime - slowFrom) / Math.max(0.01, dur - slowFrom)
                  );
                  k = k * k * (3 - 2 * k); // smoothstep — no visible gear change
                  rate = baseRate + (slowRate - baseRate) * k;
                }
                if (Math.abs(video.playbackRate - rate) > 0.01) {
                  video.playbackRate = rate;
                }
              })
            );

            /* `loop` is off so the last frame can be held before restarting. */
            offs.push(
              HOC.onEl(video, "ended", function () {
                if (holdTimer) root.clearTimeout(holdTimer);
                holdTimer = root.setTimeout(function () {
                  holdTimer = 0;
                  video.currentTime = 0;
                  video.playbackRate = baseRate;
                  if (visible) video.play().catch(function () {});
                }, holdMs);
              })
            );

            offs.push(
              HOC.onEl(video, "canplay", function () {
                video.playbackRate = baseRate;
                video.play().then(
                  function () {
                    video.classList.add("is-playing");
                    // Repoint the shader at live frames instead of the poster.
                    if (gl) {
                      gl.set("uTexRes", [
                        video.videoWidth,
                        video.videoHeight
                      ]);
                      HOC.ticker.add(function () {
                        if (gl && !video.paused) {
                          if (!gl.texture("uTex", video)) stopGL();
                        }
                      });
                    }
                  },
                  function () {
                    /* autoplay refused — poster stays, which is fine */
                  }
                );
              })
            );
          }
        }

        // --- the shader -------------------------------------------------
        if (poster && (poster.complete || poster.naturalWidth)) startGL();
        else if (poster) offs.push(HOC.onEl(poster, "load", startGL));

        // Pause the loop the moment the hero leaves the viewport.
        if (ScrollTrigger) {
          st = ScrollTrigger.create({
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            onToggle: function (self) {
              visible = self.isActive;
              if (video && video.src) {
                // Don't fight the hold: while we're waiting on the logo beat,
                // leave it parked on the last frame.
                if (self.isActive && !holdTimer) {
                  video.play().catch(function () {});
                } else if (!self.isActive) {
                  video.pause();
                }
              }
            }
          });
        }

        if (!env.touch) offs.push(HOC.onEl(el, "pointermove", onMove));

        offs.push(
          HOC.bind("tierchange", function () {
            if (!full()) stopGL();
          })
        );
      },
      resize: function () {
        if (gl) gl.resize(1.75).render();
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (holdTimer) root.clearTimeout(holdTimer);
        stopGL();
        if (st) st.kill();
      }
    };
  });

  /* ======================================================================
     5. FEATURED BLENDS — choreographed pack change  §11
     The brief is explicit that a straight crossfade is wrong: the outgoing
     pack lifts and shrinks away, the ground crossfades, the incoming pack
     drops in slightly oversized and settles.
     ====================================================================== */

  HOC.controller("featured", function (el) {
    // core already registered a "featured" controller; both run, and this one
    // only owns the choreography.
    var offs = [];
    var stack = HOC.$('[data-hoc="pack-stack"]', el);
    var quickX = null,
      quickY = null;

    function swap(slug) {
      var packs = HOC.$$(".hoc-pack", el);
      var incoming = null,
        outgoing = null;
      packs.forEach(function (p) {
        if (p.getAttribute("data-pack") === slug) incoming = p;
        else if (p.classList.contains("is-active")) outgoing = p;
      });
      if (!incoming || incoming === outgoing) return;

      packs.forEach(function (p) {
        p.setAttribute("aria-hidden", String(p !== incoming));
      });

      if (reduced()) {
        packs.forEach(function (p) {
          p.classList.toggle("is-active", p === incoming);
          gsap.set(p, { clearProps: "all" });
        });
        return;
      }

      var tl = gsap.timeline();
      if (outgoing) {
        tl.to(outgoing, {
          yPercent: -3,
          scale: 0.96,
          opacity: 0,
          duration: 0.44,
          ease: "hoc.in",
          onComplete: function () {
            outgoing.classList.remove("is-active");
            gsap.set(outgoing, { clearProps: "transform,opacity" });
          }
        });
      }
      tl.add(function () {
        incoming.classList.add("is-active");
      }, outgoing ? "-=0.14" : 0);
      tl.fromTo(
        incoming,
        { yPercent: 4, scale: 1.04, opacity: 0 },
        {
          yPercent: 0,
          scale: 1,
          opacity: 1,
          duration: 0.86,
          ease: EASE,
          clearProps: "transform"
        },
        outgoing ? "-=0.12" : 0
      );

      // ingredient labels arrive after the pack has settled
      var panel = HOC.$('[data-panel="' + slug + '"]', el);
      if (panel) {
        var items = HOC.$$(".hoc-inglist__item", panel);
        if (items.length)
          tl.from(
            items,
            { y: 8, opacity: 0, duration: 0.5, stagger: 0.05 },
            "-=0.5"
          );
      }
    }

    /* Pointer tilt, max 2.5deg. Not a 15-degree card flip (§11). */
    function tilt(e) {
      if (!quickX) return;
      var r = stack.getBoundingClientRect();
      quickY(((e.clientX - r.left) / r.width - 0.5) * 5);
      quickX(-((e.clientY - r.top) / r.height - 0.5) * 5);
    }
    function untilt() {
      if (quickX) {
        quickX(0);
        quickY(0);
      }
    }

    return {
      init: function () {
        offs.push(
          HOC.bind("blendchange", function (e) {
            if (e.detail.el === el) swap(e.detail.slug);
          })
        );

        if (stack && !env.touch && !reduced()) {
          quickX = gsap.quickTo(stack, "rotationX", {
            duration: 0.7,
            ease: EASE
          });
          quickY = gsap.quickTo(stack, "rotationY", {
            duration: 0.7,
            ease: EASE
          });
          offs.push(HOC.onEl(el, "pointermove", tilt));
          offs.push(HOC.onEl(el, "pointerleave", untilt));
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
     6. FROM LEAF TO GLASS  §13 — SIGNATURE #2

     The stage is held by CSS `position: sticky` rather than ScrollTrigger's
     pin. Same result, no pin-spacer, and it stays glued under Lenis. The
     0.8-1.2s scrub the brief asks for is reproduced by lerping the rendered
     progress toward the scroll progress on the shared ticker.
     ====================================================================== */

  var L2G_BOUNDS = [0.12, 0.3, 0.5, 0.66, 0.82, 0.93];

  function fitCanvas(canvas, maxDpr) {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(root.devicePixelRatio || 1, maxDpr || 2);
    var w = Math.max(1, Math.round(r.width * dpr));
    var h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: r.width, h: r.height };
  }

  HOC.controller("leaf-to-glass", function (el) {
    var track = HOC.$('[data-hoc="l2g-track"]', el);
    var canvas = HOC.$('[data-hoc="l2g-canvas"]', el);
    var st = null;
    var target = 0,
      p = 0,
      visible = false,
      fit = null;
    var liquid =
      getComputedStyle(el).getPropertyValue("--liquid").trim() || "#B4324B";

    var ings = HOC.$$(".hoc-l2g__ings li", el);
    var rows = HOC.$$(".hoc-brewdata__row", el);
    var steps = HOC.$$(".hoc-l2g__progress li", el);
    var numEl = HOC.$('[data-hoc="l2g-num"]', el);
    var labelEl = HOC.$('[data-hoc="l2g-label"]', el);
    var LABELS = ["Raw", "Fall", "Infuse", "Colour", "Ice", "Serve"];
    var METRIC = ["g", "g", "c", "min", "ml", "ml"];
    var lastStage = -1;

    function stageFor(v) {
      var s = 0;
      for (var i = 0; i < L2G_BOUNDS.length; i++) if (v >= L2G_BOUNDS[i]) s = i;
      return s;
    }

    function syncUI(v) {
      var s = stageFor(v);
      if (s === lastStage) return;
      lastStage = s;
      if (numEl) numEl.textContent = String(s + 1).padStart(2, "0");
      if (labelEl) labelEl.textContent = LABELS[s];
      steps.forEach(function (n, i) {
        n.classList.toggle("is-on", i === s);
      });
      rows.forEach(function (r) {
        r.classList.toggle("is-on", r.getAttribute("data-metric") === METRIC[s]);
      });
      // ingredients light up as they drop in
      ings.forEach(function (n, i) {
        n.classList.toggle("is-on", s >= 1 || i === s);
      });
    }

    function tick(time) {
      if (!visible || !fit) return;
      p += (target - p) * 0.12; // == ScrollTrigger scrub ~1.0
      if (Math.abs(target - p) < 0.0004) p = target;
      HOC.drawGlassScene(fit.ctx, fit.w, fit.h, p, {
        liquid: liquid,
        ink: "rgba(241,239,232,0.8)",
        time: time
      });
      syncUI(p);
    }

    return {
      init: function () {
        if (!canvas || !track) return;
        fit = fitCanvas(canvas, 2);
        HOC.drawGlassScene(fit.ctx, fit.w, fit.h, 0, {
          liquid: liquid,
          ink: "rgba(241,239,232,0.8)",
          time: 0
        });

        if (!ScrollTrigger) return;
        st = ScrollTrigger.create({
          trigger: track,
          start: "top top",
          end: "bottom bottom",
          onUpdate: function (self) {
            target = self.progress;
            if (reduced()) {
              p = target;
            }
          },
          onToggle: function (self) {
            visible = self.isActive;
          }
        });
        HOC.ticker.add(tick);
      },
      resize: function () {
        if (canvas && canvas.offsetParent !== null) fit = fitCanvas(canvas, 2);
      },
      destroy: function () {
        HOC.ticker.remove(tick);
        if (st) st.kill();
      }
    };
  });

  /* --- mobile: three short stages, no pin (§13, §44) -------------------- */
  HOC.controller("l2g-mobile", function (el) {
    var section = el.closest(".hoc-l2g");
    var liquid =
      getComputedStyle(section).getPropertyValue("--liquid").trim() || "#B4324B";
    var blocks = HOC.$$(".hoc-l2gm", el).map(function (b) {
      return {
        el: b,
        canvas: HOC.$("canvas", b),
        to: parseFloat(b.getAttribute("data-progress")),
        p: 0,
        fit: null,
        on: false,
        st: null
      };
    });

    function tick(time) {
      blocks.forEach(function (b) {
        if (!b.on || !b.fit) return;
        b.p += (b.to - b.p) * 0.08;
        HOC.drawGlassScene(b.fit.ctx, b.fit.w, b.fit.h, b.p, {
          liquid: liquid,
          ink: "rgba(241,239,232,0.8)",
          time: time
        });
      });
    }

    return {
      init: function () {
        blocks.forEach(function (b) {
          if (!b.canvas) return;
          b.fit = fitCanvas(b.canvas, 1.75);
          // start a quarter-turn back so entering the block plays a short
          // transition rather than snapping to the finished frame
          b.p = Math.max(0, b.to - 0.26);
          if (reduced()) b.p = b.to;
          HOC.drawGlassScene(b.fit.ctx, b.fit.w, b.fit.h, b.p, {
            liquid: liquid,
            ink: "rgba(241,239,232,0.8)",
            time: 0
          });
          if (!ScrollTrigger) {
            b.on = true;
            return;
          }
          b.st = ScrollTrigger.create({
            trigger: b.el,
            start: "top 92%",
            end: "bottom 8%",
            onToggle: function (self) {
              b.on = self.isActive;
            }
          });
        });
        HOC.ticker.add(tick);
      },
      resize: function () {
        blocks.forEach(function (b) {
          if (b.canvas && b.canvas.offsetParent !== null)
            b.fit = fitCanvas(b.canvas, 1.75);
        });
      },
      destroy: function () {
        HOC.ticker.remove(tick);
        blocks.forEach(function (b) {
          if (b.st) b.st.kill();
        });
      }
    };
  });

  /* ======================================================================
     7. COLOR ALCHEMY  §14 — SIGNATURE #3
     ====================================================================== */

  function hexToVec(h) {
    h = (h || "").trim().replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h || "000000", 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  HOC.controller("alchemy", function (el) {
    var track = HOC.$('[data-hoc="alchemy-track"]', el);
    var canvas = HOC.$('[data-hoc="alchemy-gl"]', el);
    var fallback = HOC.$('[data-hoc="alchemy-fallback"]', el);
    var drop = HOC.$('[data-hoc="alchemy-drop"]', el);
    var hint = HOC.$('[data-hoc="alchemy-hint"]', el);
    var chain = HOC.$$(".hoc-alchemy__chain [data-step]", el);
    var stage = HOC.$(".hoc-alchemy__stage", el);

    var gl = null,
      st = null,
      offs = [],
      visible = false;
    var scrollP = 0;
    var pointerBoost = 0; // grows with travel, decays slowly
    var px = 0.5,
      py = 0.5,
      tx = 0.5,
      ty = 0.5,
      vel = 0;
    var dropX = null,
      dropY = null;

    function useFallback() {
      if (fallback) fallback.classList.add("is-on");
      if (hint) hint.classList.add("is-off");
    }

    function onMove(e) {
      var r = stage.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width;
      var ny = (e.clientY - r.top) / r.height;
      var d = Math.hypot(nx - tx, 1 - ny - ty);
      tx = nx;
      ty = 1 - ny;
      vel = Math.min(1, vel + d * 3.2);
      // Moving across the surface is what spreads the catalyst.
      pointerBoost = Math.min(1, pointerBoost + d * 0.55);
      if (hint && pointerBoost > 0.08) hint.classList.add("is-off");
      if (dropX) {
        dropX(e.clientX - r.left);
        dropY(e.clientY - r.top);
      }
    }

    function tick(time) {
      if (!gl || !visible || gl.lost) return;
      px += (tx - px) * 0.12;
      py += (ty - py) * 0.12;
      vel *= 0.93;
      pointerBoost *= 0.997; // pigment settles back very slowly

      var level = Math.min(1.05, scrollP * 0.72 + pointerBoost * 0.62);
      gl.set("uPointer", [px, py])
        .set("uVelocity", vel)
        .set("uProgress", level)
        .set("uTime", time / 1000)
        .render();

      var stepI = level < 0.3 ? 0 : level < 0.68 ? 1 : 2;
      chain.forEach(function (c, i) {
        c.style.opacity = i === stepI ? "1" : "0.45";
      });
    }

    return {
      init: function () {
        if (!canvas || !HOC.GL || reduced() || !env.webgl || HOC.designMode) {
          useFallback();
        } else {
          gl = HOC.GL(canvas, HOC.shaderAlchemy, { alpha: false });
          if (!gl) useFallback();
        }

        if (gl) {
          var cs = getComputedStyle(el);
          gl.resize(full() ? 1.75 : 1.25)
            // Deeper than the UI accents: this is pigment in a dark room,
            // not a neon gradient (§59).
            .set("uBlue", hexToVec("#1B2A6E"))
            .set("uViolet", hexToVec("#553784"))
            .set("uMagenta", hexToVec("#9C2F63"))
            .set("uGlass", 1)
            .set("uPointer", [0.5, 0.5])
            .set("uVelocity", 0)
            .set("uProgress", 0)
            .render();
          HOC.ticker.add(tick);
        }

        if (ScrollTrigger && track) {
          st = ScrollTrigger.create({
            trigger: track,
            start: "top top",
            end: "bottom bottom",
            onUpdate: function (self) {
              scrollP = self.progress;
              if (fallback && fallback.classList.contains("is-on"))
                fallback.style.opacity = String(0.35 + self.progress * 0.65);
            },
            onToggle: function (self) {
              visible = self.isActive;
            }
          });
        }

        if (drop && !env.touch && gsap) {
          dropX = gsap.quickTo(drop, "x", { duration: 0.22, ease: EASE });
          dropY = gsap.quickTo(drop, "y", { duration: 0.22, ease: EASE });
        }
        if (!env.touch && stage) offs.push(HOC.onEl(stage, "pointermove", onMove));

        offs.push(
          HOC.bind("tierchange", function () {
            if (reduced() && gl) {
              HOC.ticker.remove(tick);
              gl.destroy();
              gl = null;
              useFallback();
            }
          })
        );
      },
      resize: function () {
        if (gl) gl.resize(full() ? 1.75 : 1.25).render();
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        HOC.ticker.remove(tick);
        if (gl) gl.destroy();
        if (st) st.kill();
      }
    };
  });

  /* ======================================================================
     8. FIND YOUR HOC — floating preview  §15
     ====================================================================== */

  HOC.controller("mood-preview", function (el) {
    var inner = HOC.$(".hoc-moods__previewinner", el);
    var section = el.closest(".hoc-moods");
    var qx = null,
      qy = null;
    var offs = [];
    var current = null;

    function onMove(e) {
      if (!qx) return;
      qx(e.clientX);
      qy(e.clientY);
    }

    return {
      init: function () {
        if (env.touch || reduced() || !section) return;
        qx = gsap.quickTo(el, "x", { duration: 0.72, ease: EASE });
        qy = gsap.quickTo(el, "y", { duration: 0.72, ease: EASE });

        offs.push(
          HOC.bind("moodenter", function (e) {
          var li = e.detail;
          if (!li || li === current) return;
          current = li;
          var src = HOC.$(".hoc-mood__pack img", li);
          if (src && inner) {
            inner.innerHTML = "";
            var clone = src.cloneNode(true);
            clone.removeAttribute("loading");
            inner.appendChild(clone);
            gsap.fromTo(
              clone,
              { scale: 0.9, opacity: 0, yPercent: 4 },
              { scale: 1, opacity: 1, yPercent: 0, duration: 0.62 }
            );
          }
          var cs = getComputedStyle(li);
          el.style.setProperty("--accent-wash", cs.getPropertyValue("--accent-wash"));
          if (section)
            section.style.setProperty(
              "--accent",
              cs.getPropertyValue("--accent")
            );
          el.classList.add("is-on");
          })
        );

        offs.push(
          HOC.bind("moodleave", function () {
            current = null;
            el.classList.remove("is-on");
          })
        );

        offs.push(HOC.onEl(section, "pointermove", onMove));

        // ScrambleText on the metadata only — never on the big words (§15).
        if (root.ScrambleTextPlugin) {
          HOC.$$("[data-scramble]", section).forEach(function (m) {
            var li = m.closest(".hoc-mood");
            offs.push(
              HOC.onEl(li, "mouseenter", function () {
                gsap.to(m, {
                  duration: 0.55,
                  scrambleText: {
                    text: m.getAttribute("data-scramble"),
                    chars: "upperCase",
                    speed: 0.6
                  }
                });
              })
            );
          });
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
     8b. THE RANGE  §17 (reworked)

     Three columns, per the requested casperscaviar.com reference.

       * outer columns parallax past each other at different rates
       * the centre panel is CSS-sticky, and gets an extra lagged offset so it
         drifts a beat behind the scroll rather than tracking it exactly
       * whichever blend you are level with swaps into the panel

     "Level with" uses untransformed row centers. Both image stacks share
     that geometry; only the individual images receive bounded parallax.

     Without this enhancement all fourteen blends keep their own images,
     description and add button in an ordinary vertical list.
     ====================================================================== */

  HOC.controller("range", function (el) {
    var stage = HOC.$('[data-hoc="range-stage"]', el);
    var cols = HOC.$$('[data-hoc="range-col"]', el);
    var sticky = HOC.$('[data-hoc="range-sticky"]', el);
    var cells = HOC.$$(".hoc-range__col--left .hoc-range__cell", el);
    var panels = HOC.$$(".hoc-range__panel", el);
    var notes = HOC.$$(".hoc-range__note", el);

    var observer = null;
    var active = -1, visible = false, lastY = -1, lag = 0;
    var dirty = true, lastTime = 0;
    var media = root.matchMedia("(min-width: 900px) and (min-height: 620px)");
    var piles = HOC.$$(".hoc-range__col--left .hoc-range__pile", el);
    var packs = HOC.$$(".hoc-range__col--right .hoc-range__pack", el);
    var rightCells = HOC.$$(".hoc-range__col--right .hoc-range__cell", el);

    function setActive(i) {
      if (i === active || i < 0 || i >= panels.length) return;
      active = i;
      panels.forEach(function (p, n) {
        var on = n === i;
        p.classList.toggle("is-on", on);
        p.inert = !on;
        if (on) p.removeAttribute("aria-hidden");
        else p.setAttribute("aria-hidden", "true");
      });
      notes.forEach(function (p, n) {
        var on = n === i;
        p.classList.toggle("is-on", on);
        if (on) p.removeAttribute("aria-hidden");
        else p.setAttribute("aria-hidden", "true");
      });
      // Recolour the panel frame to the blend that is showing.
      var cs = getComputedStyle(panels[i]);
      if (sticky) {
        sticky.style.setProperty("--accent", cs.getPropertyValue("--accent"));
        sticky.style.setProperty("--accent-wash", cs.getPropertyValue("--accent-wash"));
      }
      HOC.emit("rangechange", { index: i, el: el });
    }

    function resetTransforms() {
      piles.concat(packs).forEach(function (item) { item.style.transform = ""; });
      if (sticky) sticky.style.setProperty("--range-drift", "0px");
    }

    function tick(t) {
      if (!visible || !media.matches) return;
      var y = root.scrollY;
      var dt = lastTime ? Math.min(t - lastTime, 50) : 16;
      lastTime = t;
      if (!dirty && Math.abs(y - lastY) < .1 && Math.abs(y - lag) < .1) return;
      // Read untransformed row positions before writing. Both stacks share
      // exactly the same row geometry, including the first and last product.
      var boxes = cells.map(function (cell) { return cell.getBoundingClientRect(); });
      var mid = root.innerHeight * .5 + 31;
      var best = 0, distance = Infinity;
      var still = reduced() || HOC.env.reduced;
      boxes.forEach(function (r, i) {
        var delta = r.top + r.height * .5 - mid;
        if (Math.abs(delta) < distance) { best = i; distance = Math.abs(delta); }
        [piles[i], packs[i]].forEach(function (item, n) {
          if (!item) return;
          var speed = parseFloat(cols[n].dataset.speed) || 0;
          var offset = still ? 0 : Math.max(-32, Math.min(32, delta * speed));
          item.style.transform = "translate3d(0," + offset.toFixed(2) + "px,0)";
        });
      });
      lag += (y - lag) * (1 - Math.exp(-dt / 220));
      if (still) lag = y;
      var drift = Math.max(-4, Math.min(4, (y - lag) * .04));
      if (sticky) sticky.style.setProperty("--range-drift", drift.toFixed(2) + "px");
      setActive(best);
      cells.forEach(function (cell, i) {
        cell.classList.toggle("is-current", i === best);
        if (rightCells[i]) rightCells[i].classList.toggle("is-current", i === best);
      });
      lastY = y; dirty = false;
    }

    function resize() {
      dirty = true; lastY = -1; lag = root.scrollY;
      el.classList.toggle("is-enhanced", media.matches);
      if (!media.matches) resetTransforms();
    }

    function focus(e) {
      // Tabbing to a botanical farther down the list brings its paired copy
      // into the panel immediately, without waiting for a pointer gesture.
      var cell = e.target.closest(".hoc-range__cell");
      if (cell && media.matches) {
        var i = Number(cell.dataset.index);
        var r = cell.getBoundingClientRect();
        var y = root.scrollY + r.top + r.height / 2 - (root.innerHeight / 2 + 31);
        if (HOC.lenis) HOC.lenis.scrollTo(y, { immediate: true });
        else root.scrollTo(0, y);
        setActive(i); dirty = true;
      }
    }

    return {
      init: function () {
        if (!stage || !cells.length) return;
        resize();
        observer = new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          dirty = true; lag = root.scrollY; lastTime = 0;
        });
        observer.observe(stage);
        media.addEventListener("change", resize);
        el.addEventListener("focusin", focus);
        HOC.ticker.add(tick);
        setActive(0);
      },
      resize: resize,
      destroy: function () {
        HOC.ticker.remove(tick);
        if (observer) observer.disconnect();
        media.removeEventListener("change", resize);
        el.removeEventListener("focusin", focus);
        el.classList.remove("is-enhanced");
        resetTransforms();
        panels.forEach(function (p) { p.inert = false; });
      }
    };
  });

  /* ======================================================================
     9. DRAWSVG  §16 §22
     The packaging line art draws itself on as it enters. Brand motion
     primitive, used twice — not on every icon.
     ====================================================================== */

  HOC.controller("draw", function (el) {
    var st = null;
    return {
      init: function () {
        if (!DrawSVGPlugin || !ScrollTrigger || reduced()) return;
        // <use> can't be drawn directly; reach into the referenced symbol.
        var use = HOC.$("use", el);
        var id = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
        var sym = id ? doc.querySelector(id) : null;
        var paths = sym
          ? HOC.$$("path, circle, line, polyline", sym)
          : HOC.$$("path, circle, line, polyline", el);
        if (!paths.length) return;

        gsap.set(paths, { drawSVG: "0% 0%" });
        st = gsap.to(paths, {
          drawSVG: "0% 100%",
          duration: 1.5,
          ease: "hoc.scene",
          stagger: 0.045,
          scrollTrigger: { trigger: el, start: "top 92%", once: true }
        });
      },
      destroy: function () {
        if (st) st.kill();
      }
    };
  });

  /* ======================================================================
     9b. ATLAS LEAD — redraw the botanical when the ingredient changes  §16
     The same DrawSVG primitive as the footer sprig, used as a transition
     rather than as decoration.
     ====================================================================== */

  HOC.on("atlaspick", function (e) {
    var art = e.detail && e.detail.art;
    if (!art || !DrawSVGPlugin || reduced()) return;
    var use = HOC.$("use", art);
    var id = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
    var sym = id ? doc.querySelector(id) : null;
    if (!sym) return;
    var paths = HOC.$$("path, circle, line, polyline", sym);
    if (!paths.length) return;
    gsap.killTweensOf(paths);
    gsap.fromTo(
      paths,
      { drawSVG: "0% 0%" },
      { drawSVG: "0% 100%", duration: 0.85, ease: "hoc.scene", stagger: 0.022 }
    );
    gsap.fromTo(art, { opacity: 0.25 }, { opacity: 1, duration: 0.5 });
  });

  /* ======================================================================
     10. QUIET PARALLAX  §19
     One image, a few percent. Not a page-wide parallax habit (§59).
     ====================================================================== */

  HOC.controller("parallax", function (el) {
    var img = HOC.$("img", el);
    var tw = null;
    return {
      init: function () {
        if (!img || !ScrollTrigger || reduced()) return;
        tw = gsap.fromTo(
          img,
          { yPercent: -4 },
          {
            yPercent: 4,
            ease: "none",
            scrollTrigger: {
              trigger: el,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6
            }
          }
        );
      },
      destroy: function () {
        if (tw) {
          if (tw.scrollTrigger) tw.scrollTrigger.kill();
          tw.kill();
        }
      }
    };
  });

  /* ======================================================================
     11. PRODUCT CARD POINTER DRIFT  §17
     Max ±6px, and only where a pointer exists.
     ====================================================================== */

  function initCardDrift() {
    if (env.touch || reduced()) return;
    HOC.$$(".hoc-card").forEach(function (card) {
      var media = HOC.$(".hoc-card__media", card);
      var imgs = HOC.$$(".hoc-card__img", card);
      if (!media || !imgs.length) return;
      var qx = gsap.quickTo(imgs, "x", { duration: 0.6, ease: EASE });
      var qy = gsap.quickTo(imgs, "y", { duration: 0.6, ease: EASE });
      card.addEventListener("pointermove", function (e) {
        var r = media.getBoundingClientRect();
        qx(((e.clientX - r.left) / r.width - 0.5) * 12);
        qy(((e.clientY - r.top) / r.height - 0.5) * 12);
      });
      card.addEventListener("pointerleave", function () {
        qx(0);
        qy(0);
      });
    });
  }

  /* ======================================================================
     12. VIEW TRANSITIONS  §18
     Progressive enhancement only. No router, no Barba. On Shopify the
     collection card and the PDP hero share a view-transition-name and the
     browser does the rest; everywhere else it is a normal navigation.
     ====================================================================== */

  function initViewTransitions() {
    if (!doc.startViewTransition) return;
    HOC.$$(".hoc-card").forEach(function (card) {
      var slug = card.getAttribute("data-blend");
      var img = HOC.$(".hoc-card__img--a", card);
      if (img && slug) img.style.viewTransitionName = "product-" + slug;
    });
  }

  /* ======================================================================
     13. BOOT
     ====================================================================== */

  HOC.on("ready", function () {
    initSplits();
    initReveals();
    initCardDrift();
    initViewTransitions();
    if (ScrollTrigger) ScrollTrigger.refresh();
  });
})(window, document);
