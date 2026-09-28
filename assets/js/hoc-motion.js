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
    var timeline = null;
    var displayed = HOC.$(".hoc-pack.is-active", el);

    function swap(slug) {
      var packs = HOC.$$(".hoc-pack", el);
      var incoming = null;
      packs.forEach(function (p) {
        if (p.getAttribute("data-pack") === slug) incoming = p;
      });
      if (!incoming || incoming === displayed) return;

      if (timeline) timeline.kill();
      var outgoing = displayed;
      displayed = incoming;
      packs.forEach(function (p) {
        gsap.killTweensOf(p);
        gsap.set(p, { clearProps: "transform,opacity" });
        p.classList.toggle("is-active", p === outgoing);
      });

      packs.forEach(function (p) {
        p.setAttribute("aria-hidden", String(p !== incoming));
        p.inert = p !== incoming;
      });

      if (reduced()) {
        packs.forEach(function (p) {
          p.classList.toggle("is-active", p === incoming);
          gsap.set(p, { clearProps: "all" });
        });
        return;
      }

      var tl = gsap.timeline({ onComplete: function () { timeline = null; } });
      timeline = tl;
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
          offs.push(HOC.onEl(stack, "pointermove", tilt));
          offs.push(HOC.onEl(stack, "pointerleave", untilt));
        }
      },
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (timeline) timeline.kill();
        if (stack) gsap.killTweensOf(stack);
      }
    };
  });

  /* ======================================================================
     6. FROM LEAF TO GLASS  §13 — SIGNATURE #2

     The stage is held by CSS `position: sticky` rather than ScrollTrigger's
     pin. ScrollTrigger selects photographic stages; CSS handles the brief
     crossfades. Small screens, reduced motion and the editor use normal flow.
     ====================================================================== */

  /* Photographic scenes stay readable in ordinary flow without enhancement. */
  HOC.controller("leaf-to-glass", function (el) {
    var track = HOC.$("[data-brew-track]", el);
    var scenes = HOC.$$("[data-brew-step]", el);
    var buttons = HOC.$$("[data-brew-go]", el);
    var progress = HOC.$("[data-brew-progress]", el);
    var media = root.matchMedia("(min-width: 900px) and (min-height: 740px) and (prefers-reduced-motion: no-preference)");
    var st = null, current = -1, offs = [];

    function select(index) {
      index = Math.max(0, Math.min(scenes.length - 1, index));
      if (index === current) return;
      current = index;
      scenes.forEach(function (scene, i) {
        scene.classList.toggle("is-active", i === index);
        scene.setAttribute("aria-hidden", String(i !== index));
        scene.inert = i !== index;
      });
      buttons.forEach(function (button, i) {
        button.setAttribute("aria-pressed", String(i === index));
      });
    }
    function update(self) {
      select(Math.min(scenes.length - 1, Math.floor(self.progress * scenes.length)));
      if (progress) progress.style.transform = "scaleX(" + self.progress + ")";
    }
    function plain() {
      if (st) st.kill();
      st = null;
      current = -1;
      el.classList.remove("is-enhanced");
      scenes.forEach(function (scene) {
        scene.removeAttribute("aria-hidden");
        scene.inert = false;
      });
      if (progress) progress.style.removeProperty("transform");
    }
    function setup() {
      var enabled = media.matches && !reduced() && !HOC.designMode && !!ScrollTrigger;
      if (!enabled) { plain(); return; }
      if (st || !track || !scenes.length) return;
      el.classList.add("is-enhanced");
      select(0);
      st = ScrollTrigger.create({
        trigger: track,
        start: function () {
          var header = parseFloat(getComputedStyle(el).getPropertyValue("--header-h-scrolled")) || 62;
          return "top " + header + "px";
        },
        end: "bottom bottom",
        invalidateOnRefresh: true,
        onUpdate: update,
        onRefresh: update
      });
      update(st);
    }
    return {
      init: function () {
        buttons.forEach(function (button) {
          offs.push(HOC.onEl(button, "click", function () {
            if (!st) return;
            var index = Number(button.getAttribute("data-brew-go"));
            var destination = st.start + (st.end - st.start) * (index + .35) / scenes.length;
            if (HOC.lenis) HOC.lenis.scrollTo(destination, { duration: .7 });
            else root.scrollTo({ top: destination, behavior: "smooth" });
          }));
        });
        offs.push(HOC.onEl(media, "change", setup));
        offs.push(HOC.bind("tierchange", setup));
        setup();
      },
      resize: setup,
      destroy: function () {
        offs.forEach(function (off) { off(); });
        plain();
      }
    };
  });

  /* ======================================================================
     7. COLOR ALCHEMY  §14 — SIGNATURE #3

     The rendered glass. The reaction itself and everything you can operate
     — the button, the four pieces, the scale, the status line — live in
     hoc-core.js and work without any of this. This layer reads that state
     (el.__alc) each frame and draws it, and only takes over from the SVG
     glass once a real frame exists.
     ====================================================================== */

  HOC.controller("alchemy", function (el) {
    var canvas = HOC.$('[data-hoc="alchemy-gl"]', el);
    var vessel = HOC.$('[data-hoc="alchemy-vessel"]', el);
    var S = el.__alc;
    var gl = null,
      img = null,
      ready = false,
      measured = false,
      dirty = true,
      frame = 0,
      sig = "",
      ro = null,
      near = null,
      offs = [];
    var drops = new Float32Array(16);
    // Adaptive resolution: a GPU that cannot hold ~30fps with this glass on
    // screen gets fewer pixels, then the SVG glass. A pinned ?hoctier= is a
    // deliberate QA choice and is left alone, as the tier sampler does.
    var pinned = /[?&]hoctier=/.test(root.location.search);
    var cap = 0,
      perf = { n: 0, sum: 0, last: 0 };

    // Reduced motion still gets the rendered glass, only without movement:
    // hoc-core.js freezes the clock and settles every piece on arrival.
    // A tier forced to "reduced" (QA) or no WebGL gets the SVG glass.
    function wanted() {
      return !!(
        S && canvas && vessel && HOC.GL && env.webgl && !HOC.designMode &&
        (env.tier !== "reduced" || env.reduced)
      );
    }

    function dpr() {
      var d = Math.min(root.devicePixelRatio || 1, full() ? 2 : 1.5);
      return cap ? Math.min(d, cap) : d;
    }

    /** Frame pacing while the glass is on screen. False once it gave up. */
    function pace() {
      if (pinned) return true;
      var t = performance.now();
      var gap = t - perf.last;
      perf.last = t;
      if (gap > 250) return true; // a tab switch or a hitch, not the GPU
      perf.sum += gap;
      if (++perf.n < 90) return true;
      var avg = perf.sum / perf.n;
      perf.n = perf.sum = 0;
      if (avg <= 34) return true;
      var d = dpr();
      if (d > 1.01) {
        cap = Math.max(1, d - 0.5);
        fit();
        return true;
      }
      if (avg > 55) {
        giveUp();
        return false;
      }
      return true;
    }

    // The glass is laid out by CSS (the vessel box); the shader only needs
    // to know where that box sits on the canvas, in canvas pixels.
    function measure() {
      if (!gl) return;
      var c = canvas.getBoundingClientRect();
      var v = vessel.getBoundingClientRect();
      if (c.width < 1 || v.height < 1) return;
      var k = canvas.width / c.width;
      gl.set("uVessel", [
        (v.left + v.width / 2 - c.left) * k,
        (c.bottom - v.top - v.height / 2) * k,
        (v.width / 2) * k,
        (v.height / 2) * k
      ]);
      measured = true;
      dirty = true;
    }

    function fit() {
      if (!gl) return;
      gl.resize(dpr());
      measure();
    }

    function giveUp() {
      HOC.ticker.remove(tick);
      ready = false;
      el.classList.remove("is-gl");
      if (gl) {
        gl.destroy();
        gl = null;
      }
    }

    function tick() {
      if (!gl || !ready) return;
      if (gl.lost) return giveUp();
      if (!S.visible) {
        perf.last = 0;
        return;
      }
      if (!pace()) return;
      if (!measured || ++frame % 45 === 0) measure();
      if (!measured) return;

      for (var i = 0; i < 4; i++) {
        var d = S.drops[i];
        drops[i * 4] = d ? d.x : 0;
        drops[i * 4 + 1] = d ? d.t0 : 0;
        drops[i * 4 + 2] = d ? d.k : 0; // strength 0 marks an empty slot
        drops[i * 4 + 3] = d ? d.seed : 0;
      }
      // A frozen clock only needs a frame when something actually changed.
      if (S.still) {
        var now = [
          S.level.toFixed(4), S.fill.toFixed(3), S.fade.toFixed(3),
          S.drops.length, S.ghostA.toFixed(2), S.ghostX.toFixed(3)
        ].join();
        if (now === sig && !dirty) return;
        sig = now;
      }
      dirty = false;
      gl.set("uTime", S.still ? S.frozen : S.now())
        .set("uLevel", S.level)
        .set("uFill", S.fill)
        .set("uFade", S.fade)
        .set("uDrop", drops)
        .set("uGhost", [S.ghostX, S.ghostA])
        .render();
      if (!el.classList.contains("is-gl")) el.classList.add("is-gl");
    }

    return {
      init: function () {
        if (!wanted()) return;
        gl = HOC.GL(canvas, HOC.shaderAlchemy, { alpha: false });
        if (!gl) return;
        gl.set("uBg", [11 / 255, 12 / 255, 20 / 255])
          .set("uLevel", 0)
          .set("uFill", 1)
          .set("uFade", 0)
          .set("uGhost", [0, 0]);
        fit();

        // The flowers and hibiscus are real drawings (the atlas plates), so
        // nothing is shown until they are on the GPU — and they are only
        // fetched once the section is within a screen of view.
        var src = el.getAttribute("data-sprites") || "";
        var triedPng = false;
        img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = function () {
          if (!gl) return;
          // False over file:// (a tainted image): the SVG glass stays.
          if (!gl.texture("uSprites", img, { premultiply: true, mipmap: true }))
            return giveUp();
          ready = true;
          dirty = true;
          HOC.ticker.add(tick);
        };
        img.onerror = function () {
          if (!triedPng && /\.webp(\?|$)/.test(src)) {
            triedPng = true;
            img.src = src.replace(/\.webp(\?|$)/, ".png$1");
          } else giveUp();
        };
        if ("IntersectionObserver" in root) {
          near = new IntersectionObserver(
            function (entries) {
              if (!entries[entries.length - 1].isIntersecting) return;
              near.disconnect();
              img.src = src;
            },
            { rootMargin: "0px 0px 100% 0px" }
          );
          near.observe(el);
        } else img.src = src;

        if ("ResizeObserver" in root) {
          ro = new ResizeObserver(function () {
            fit();
          });
          ro.observe(el);
          ro.observe(vessel);
        }
        if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);
        offs.push(
          HOC.bind("tierchange", function () {
            if (!gl) return;
            if (!wanted()) giveUp();
            else fit();
          })
        );
      },
      resize: fit,
      destroy: function () {
        offs.forEach(function (f) {
          f();
        });
        if (ro) ro.disconnect();
        if (near) near.disconnect();
        if (img) img.onload = img.onerror = null;
        giveUp();
      }
    };
  });

  /* ======================================================================
     8. FIND YOUR HOC — floating preview  §15
     ====================================================================== */

  HOC.controller("mood-preview", function (el) {
    var inner = HOC.$(".hoc-moods__previewinner", el);
    var section = el.closest(".hoc-moods");
    var stageY = null,
      innerX = null,
      innerY = null;
    var offs = [];
    var current = null;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function place(li, immediate) {
      if (!stageY || !li || !section) return;
      var row = li.getBoundingClientRect();
      var area = section.getBoundingClientRect();
      var previewHeight = el.offsetHeight;
      var y = row.top - area.top + (row.height - previewHeight) / 2;
      var max = Math.max(24, section.scrollHeight - previewHeight - 24);
      y = clamp(y, 24, max);
      if (immediate && gsap) gsap.set(el, { y: y });
      else stageY(y);
    }

    function onMove(e) {
      if (!current || !innerX || !innerY) return;
      var row = current.getBoundingClientRect();
      var px = (e.clientX - (row.left + row.width / 2)) / Math.max(row.width / 2, 1);
      var py = (e.clientY - (row.top + row.height / 2)) / Math.max(row.height / 2, 1);
      innerX(clamp(px * 12, -12, 12));
      innerY(clamp(py * 8, -8, 8));
    }

    return {
      init: function () {
        if (env.touch || reduced() || !section) return;
        stageY = gsap.quickTo(el, "y", { duration: 0.5, ease: EASE });
        innerX = gsap.quickTo(inner, "x", { duration: 0.65, ease: EASE });
        innerY = gsap.quickTo(inner, "y", { duration: 0.65, ease: EASE });

        offs.push(
          HOC.bind("moodenter", function (e) {
          var li = e.detail;
          if (!li || li === current) return;
          current = li;
          place(li, !el.classList.contains("is-on"));
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
            if (innerX) innerX(0);
            if (innerY) innerY(0);
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
      resize: function () {
        if (current) place(current, true);
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
