/* Photographic ingredient sprites, composed from each blend's own recipe.
   Shared by the static-image build and the pointer interaction. No WebGL. */
(function (root) {
  "use strict";
  var names = ["Hibiscus", "Mint Leaf", "Lemongrass", "Butterfly Pea Flower",
    "Cinnamon Stick", "Mango", "Pineapple", "Rooibos", "Strawberry", "Apple",
    "Bourbon Vanilla", "Dried Ginger", "Lemon Peel", "Oolong", "Dried Rose",
    "Chamomile", "Green Tea", "Blackberry", "Jasmine", "White Tea", "Lavender",
    "Lemon Balm", "Passionflower", "Mate", "Fresh Ginger", "Orange Peel", "Rosehip", "Fennel"];
  var scales = [1, .82, .7, 1, .8, .85, .8, .9, 1, .85, .55, .85, .75, .7,
    .85, .85, .6, .75, .72, .65, .65, .8, .9, .85, .8, .8, .8, .65];
  // Low values are light petals/leaves; high values are dense fruit, seed and
  // bark. This makes each blend open in a believable physical order.
  var liftOrder = [.12, .18, .35, .08, .75, .72, .68, .28, .62, .68, .78, .73,
    .55, .38, .10, .06, .32, .70, .05, .22, .04, .16, .08, .30, .74, .58, .65, .62];

  function random(seed) {
    var n = 2166136261;
    for (var i = 0; i < seed.length; i++) n = Math.imul(n ^ seed.charCodeAt(i), 16777619);
    return function () {
      n += 0x6D2B79F5;
      var t = Math.imul(n ^ n >>> 15, 1 | n);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pieces(recipe, seed) {
    var rand = random(seed);
    var types = recipe.map(function (name) { return names.indexOf(name.trim()); }).filter(function (i) { return i >= 0; });
    if (!types.length) return [];
    var result = [];
    for (var i = 0; i < 205; i++) {
      var type = types[Math.floor(rand() * types.length)];
      var a = rand() * Math.PI * 2;
      var radius = Math.pow(rand(), .7) * .25;
      var size = (.060 + rand() * .068) * scales[type];
      // A low, irregular heap. A few larger, identifiable pieces sit on top.
      if (i > 187) size *= 1.28;
      var x = Math.cos(a) * radius * (1 + .08 * Math.sin(a * 3));
      var y = Math.sin(a) * radius * .85;
      result.push({ type: type, x: x, y: y, size: size, angle: rand() * Math.PI * 2,
        dx: Math.cos(a) * (.10 + rand() * .12), dy: Math.sin(a) * (.10 + rand() * .12),
        turn: (rand() - .5) * 1.2, depth: .7 + rand() * .3,
        phase: clamp(liftOrder[type] + (rand() - .5) * .22, 0, 1),
        spiral: .42 + rand() * .72,
        float: .45 + rand() * .55, pulse: rand() * Math.PI * 2,
        orbit: .7 + rand() * .65 });
    }
    return result;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function smoothstep(value) {
    value = clamp(value, 0, 1);
    return value * value * (3 - 2 * value);
  }

  function draw(canvas, atlas, items, spread, pointer, flow) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!atlas.hocSprites) {
      var sw = atlas.width / 6, sh = atlas.height / 5;
      atlas.hocSprites = names.map(function (_, i) {
        // Bake contact shadows once per ingredient, not 205 times per frame.
        var tile = document.createElement("canvas");
        tile.width = tile.height = 256;
        var tc = tile.getContext("2d");
        tc.shadowColor = "rgba(39,30,18,.19)";
        tc.shadowBlur = 7;
        tc.shadowOffsetY = 3;
        tc.drawImage(atlas, i % 6 * sw, Math.floor(i / 6) * sh, sw, sh, 0, 0, 256, 256);
        return tile;
      });
    }
    var time = flow ? flow.time : 0;
    var energy = flow ? flow.energy : 0;
    var spin = flow ? flow.spin : 0;
    items.forEach(function (p) {
      // Each layer lifts at a different moment. Reversing spread makes the
      // same curve gather inward instead of popping back to the center.
      var local = smoothstep((spread - p.phase * .22) / .78);
      var baseAngle = Math.atan2(p.y, p.x);
      var baseRadius = Math.sqrt(p.x * p.x + p.y * p.y);
      var breathing = Math.sin(time * .0011 * p.orbit + p.pulse) * .010 * local;
      var radius = baseRadius + local * (.075 + p.float * .095) + breathing;
      var current = local * (p.spiral + spin * .18);
      current += Math.sin(time * .00052 + p.pulse) * .045 * local;
      var x = .5 + Math.cos(baseAngle + current) * radius;
      var y = .5 + Math.sin(baseAngle + current) * radius * .84;

      if (pointer && local > 0) {
        var rx = x - pointer.x, ry = y - pointer.y;
        var distance = Math.sqrt(rx * rx + ry * ry) || .001;
        var reach = smoothstep(1 - distance / .42) * local * p.float;
        // The pointer creates a current: velocity pulls pieces forward while
        // a perpendicular component curls them around the gesture.
        var wakeX = (flow.vx || 0) * reach * (1.15 + energy * .55);
        var wakeY = (flow.vy || 0) * reach * (1.15 + energy * .55);
        var curl = reach * (.010 + energy * .018);
        x += wakeX - ry / distance * curl;
        y += wakeY + rx / distance * curl;
      }
      var size = p.size * w * (1 + local * (.025 + .025 * Math.sin(time * .0013 + p.pulse)));
      ctx.save();
      ctx.translate(x * w, y * h);
      ctx.rotate(p.angle + p.turn * local + current * .45);
      ctx.globalAlpha = .86 + p.depth * .14;
      ctx.drawImage(atlas.hocSprites[p.type], -size / 2, -size / 2, size, size);
      ctx.restore();
    });
  }

  root.HOCBotanicals = { names: names, pieces: pieces, draw: draw };
  if (!root.HOC || !root.HOC.controller) return;
  var HOC = root.HOC;
  var atlases = {};
  function load(url) {
    if (!atlases[url]) atlases[url] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
    return atlases[url];
  }

  HOC.controller("botanical-pile", function (el) {
    var canvas, atlas, items, observer, disposed = false, loading = false;
    var progress = 0, target = 0, last = 0, running = false;
    var transitionFrom = 0, transitionStarted = 0, transitionDuration = 900;
    var pointer = null, pointerTarget = null, pointerLast = null;
    var flow = { time: 0, vx: 0, vy: 0, energy: 0, spin: 0 };
    var mq = root.matchMedia("(prefers-reduced-motion: reduce)");
    var coarse = root.matchMedia("(hover: none)");
    function paint() { if (canvas && atlas) draw(canvas, atlas, items, progress, pointer, flow); }
    function stop() { HOC.ticker.remove(tick); running = false; last = 0; }
    function tick(t) {
      var dt = last ? Math.min(t - last, 50) : 16;
      last = t;
      if (progress !== target) {
        if (!transitionStarted) transitionStarted = t;
        var elapsed = Math.min(1, (t - transitionStarted) / transitionDuration);
        var ease = 1 - Math.pow(1 - elapsed, target ? 3 : 4);
        progress = transitionFrom + (target - transitionFrom) * ease;
        if (elapsed === 1) progress = target;
      }
      if (pointerTarget) {
        if (!pointer) pointer = { x: pointerTarget.x, y: pointerTarget.y };
        pointer.x += (pointerTarget.x - pointer.x) * (1 - Math.exp(-dt / 85));
        pointer.y += (pointerTarget.y - pointer.y) * (1 - Math.exp(-dt / 85));
      }
      flow.vx *= Math.exp(-dt / 190);
      flow.vy *= Math.exp(-dt / 190);
      flow.energy *= Math.exp(-dt / 310);
      flow.spin += ((flow.vx * 5 + flow.vy * 2.5) - flow.spin) * (1 - Math.exp(-dt / 240));
      flow.time += dt;
      paint();
      // While open, one visible heap keeps a very slow suspended current.
      // Once gathered the canvas returns to its exact static frame and stops.
      if (progress === 0 && target === 0) stop();
    }
    function wake() {
      if (!running) { running = true; last = 0; HOC.ticker.add(tick); }
    }
    function set(value) {
      if (!atlas || mq.matches || HOC.env.tier === "reduced") return;
      if (value === target && progress === target) return;
      transitionFrom = progress;
      // The shared GSAP ticker uses its own time origin; arm the transition
      // here and take that clock's value on the next frame.
      transitionStarted = 0;
      transitionDuration = value ? 900 : 1150;
      target = value;
      el.setAttribute("aria-pressed", value ? "true" : "false");
      el.classList.toggle("is-scattered", !!value);
      wake();
    }
    function enter(e) {
      if (e.pointerType !== "mouse") return;
      var box = el.getBoundingClientRect();
      pointerTarget = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      pointerLast = { x: pointerTarget.x, y: pointerTarget.y, time: e.timeStamp };
      set(1);
    }
    function move(e) {
      if (!target || e.pointerType !== "mouse") return;
      var box = el.getBoundingClientRect();
      var next = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      if (pointerLast) {
        var dt = Math.max(8, e.timeStamp - pointerLast.time);
        flow.vx = clamp((next.x - pointerLast.x) * 16 / dt, -.09, .09);
        flow.vy = clamp((next.y - pointerLast.y) * 16 / dt, -.09, .09);
        flow.energy = Math.min(1, Math.sqrt(flow.vx * flow.vx + flow.vy * flow.vy) * 11);
      }
      pointerTarget = next;
      pointerLast = { x: next.x, y: next.y, time: e.timeStamp };
      wake();
    }
    function leave(e) {
      // Touch dispatches pointerleave before click; it must not reset a tap toggle.
      if (e && e.type === "pointerleave" && e.pointerType !== "mouse") return;
      pointer = pointerTarget = pointerLast = null;
      flow.vx = flow.vy = flow.energy = flow.spin = 0;
      set(0);
    }
    function click(e) { if (coarse.matches || e.detail === 0) set(target ? 0 : 1); }
    function key(e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(target ? 0 : 1); }
      if (e.key === "Escape") leave();
    }
    function size() {
      if (!canvas) return;
      var width = Math.round(el.clientWidth * Math.min(root.devicePixelRatio || 1, 2));
      canvas.width = canvas.height = Math.max(1, width);
      paint();
    }
    function prepare() {
      if (loading || mq.matches || HOC.env.tier === "reduced") return;
      loading = true;
      items = pieces((el.dataset.ingredients || "").split("|"), el.dataset.seed || "hoc");
      if (!items.length) return;
      load(el.dataset.atlas).then(function (image) {
        if (disposed) return;
        atlas = image;
        canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        el.appendChild(canvas);
        size();
        el.classList.add("is-ready");
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-pressed", "false");
        el.setAttribute("aria-label", "Scatter and gather " + el.dataset.label + " ingredients");
      }).catch(function () { /* The photograph remains visible if the texture fails. */ });
    }
    function preference() {
      if (mq.matches) {
        target = progress = 0; stop(); paint();
        el.classList.remove("is-scattered");
        ["tabindex", "role", "aria-pressed", "aria-label"].forEach(function (a) { el.removeAttribute(a); });
      } else if (canvas) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-pressed", "false");
        el.setAttribute("aria-label", "Scatter and gather " + el.dataset.label + " ingredients");
      } else {
        prepare();
      }
    }
    return {
      init: function () {
        observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) prepare();
            else if (canvas) {
              target = progress = transitionFrom = 0;
              pointer = pointerTarget = pointerLast = null;
              flow.vx = flow.vy = flow.energy = flow.spin = 0;
              stop(); paint(); el.classList.remove("is-scattered"); el.setAttribute("aria-pressed", "false");
            }
          });
        }, { rootMargin: "200px" });
        observer.observe(el);
        el.addEventListener("pointerenter", enter);
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerleave", leave);
        el.addEventListener("pointercancel", leave);
        el.addEventListener("click", click);
        el.addEventListener("keydown", key);
        el.addEventListener("blur", leave);
        mq.addEventListener("change", preference);
      },
      resize: size,
      destroy: function () {
        disposed = true; stop();
        if (observer) observer.disconnect();
        if (canvas) canvas.remove();
        el.classList.remove("is-ready", "is-scattered");
        ["tabindex", "role", "aria-pressed", "aria-label"].forEach(function (a) { el.removeAttribute(a); });
        el.removeEventListener("pointerenter", enter); el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave); el.removeEventListener("pointercancel", leave);
        el.removeEventListener("click", click); el.removeEventListener("keydown", key); el.removeEventListener("blur", leave);
        mq.removeEventListener("change", preference);
      }
    };
  });
})(window);
