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
        turn: (rand() - .5) * 1.2, depth: .7 + rand() * .3 });
    }
    return result;
  }

  function draw(canvas, atlas, items, spread, pointer) {
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
    items.forEach(function (p) {
      var x = .5 + p.x + p.dx * spread;
      var y = .5 + p.y + p.dy * spread;
      if (pointer && spread > 0) {
        var vx = x - pointer.x, vy = y - pointer.y;
        var dist = Math.sqrt(vx * vx + vy * vy) || .001;
        var force = Math.max(0, .18 - dist) * .17 * spread;
        x += vx / dist * force;
        y += vy / dist * force;
      }
      var size = p.size * w;
      ctx.save();
      ctx.translate(x * w, y * h);
      ctx.rotate(p.angle + p.turn * spread);
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
    var pointer = null;
    var mq = root.matchMedia("(prefers-reduced-motion: reduce)");
    var coarse = root.matchMedia("(hover: none)");
    function paint() { if (canvas && atlas) draw(canvas, atlas, items, progress, pointer); }
    function stop() { HOC.ticker.remove(tick); running = false; last = 0; }
    function tick(t) {
      var dt = last ? Math.min(t - last, 50) : 16;
      last = t;
      progress += (target - progress) * (1 - Math.exp(-dt / (target ? 180 : 220)));
      if (Math.abs(progress - target) < .0008) progress = target;
      paint();
      if (progress === target) stop();
    }
    function wake() {
      if (!running) { running = true; last = 0; HOC.ticker.add(tick); }
    }
    function set(value) {
      if (!atlas || mq.matches || HOC.env.tier === "reduced") return;
      target = value;
      el.setAttribute("aria-pressed", value ? "true" : "false");
      el.classList.toggle("is-scattered", !!value);
      wake();
    }
    function enter(e) { if (e.pointerType === "mouse") set(1); }
    function move(e) {
      if (!target || e.pointerType !== "mouse") return;
      var box = el.getBoundingClientRect();
      pointer = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      wake();
    }
    function leave(e) {
      // Touch dispatches pointerleave before click; it must not reset a tap toggle.
      if (e && e.type === "pointerleave" && e.pointerType !== "mouse") return;
      pointer = null; set(0);
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
            else if (canvas) { target = progress = 0; stop(); paint(); el.classList.remove("is-scattered"); el.setAttribute("aria-pressed", "false"); }
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
