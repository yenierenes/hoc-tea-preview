/* Photographic ingredient sprites, composed from each blend's own recipe.
   Shared by the static-image build and the viewport-led infusion. No WebGL. */
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

  // Cached photograph sprites are shared by every blend. The idle render is
  // also used to build the WebP fallback.
  function draw(canvas, atlas, items, spread, unusedPointer, flow) {
    var ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!atlas.hocSprites) {
      var sw = atlas.width / 6, sh = atlas.height / 5;
      atlas.hocSprites = names.map(function (_, i) {
        var tile = document.createElement("canvas");
        tile.width = tile.height = 256;
        var tc = tile.getContext("2d");
        tc.shadowColor = "rgba(39,30,18,.19)";
        tc.shadowBlur = 7; tc.shadowOffsetY = 3;
        tc.drawImage(atlas, i % 6 * sw, Math.floor(i / 6) * sh, sw, sh, 0, 0, 256, 256);
        return tile;
      });
    }
    var time = flow ? flow.time : 0;
    items.forEach(function (p) {
      var local = smoothstep((spread - p.phase * .18) / .82);
      var radius = Math.hypot(p.x, p.y);
      var edge = smoothstep(radius / .28);
      // Expansion is proportional to distance: the core never becomes a ring.
      var turn = local * (.10 + edge * .18);
      turn += Math.sin(time * .00022 + p.pulse) * .013 * local * edge;
      var rx = p.x * Math.cos(turn) - p.y * Math.sin(turn);
      var ry = p.x * Math.sin(turn) + p.y * Math.cos(turn);
      var x = .5 + rx * (1 + local * .28 * edge);
      var y = .5 + ry * (1 + local * .17 * edge);
      x += Math.sin(time * .00027 * p.orbit + p.pulse) * .0025 * local * edge;
      y += Math.cos(time * .00023 + p.pulse) * .002 * local * edge;
      var size = p.size * w;
      ctx.save();
      ctx.translate(x * w, y * h);
      ctx.rotate(p.angle + p.turn * local * .12);
      ctx.drawImage(atlas.hocSprites[p.type], -size / 2, -size / 2, size, size);
      ctx.restore();
    });
  }

  // A domain-warped noise field, computed once. Sampling this field makes the
  // pigment front irregular without a fluid simulation or WebGL dependency.
  var field = null, FW = 256, FH = 96;
  function noise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    function hash(a, b) {
      var n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
      n = Math.imul(n ^ n >>> 13, 1274126177);
      return ((n ^ n >>> 16) >>> 0) / 4294967295;
    }
    var a = hash(ix, iy), b = hash(ix + 1, iy);
    var c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  function fbm(x, y) {
    return noise(x, y) * .54 + noise(x * 2.1 + 7, y * 2.1) * .28 +
      noise(x * 4.3, y * 4.3 + 12) * .13 + noise(x * 8.6, y * 8.6) * .05;
  }
  function inkField() {
    if (field) return field;
    field = new Float32Array(FW * FH);
    for (var y = 0; y < FH; y++) {
      for (var x = 0; x < FW; x++) {
        var u = x / FW * 6, v = y / FH * 4;
        var warp = fbm(u + 21, v + 5);
        field[y * FW + x] = fbm(u + warp * 2.7, v + warp * 2.1);
      }
    }
    return field;
  }
  function rgb(value) {
    var match = /^#([\da-f]{6})$/i.exec(value.trim());
    var n = match ? parseInt(match[1], 16) : 0xAD3450;
    return [n >> 16, n >> 8 & 255, n & 255];
  }
  function drawInfusion(canvas, pixels, color, origin, progress, time) {
    var ctx = canvas.getContext("2d"), data = pixels.data, values = inkField();
    var shift = time * .0007, ix = Math.floor(shift), mix = shift - ix;
    var front = origin.x + .06 + (1.12 - origin.x) * progress;
    var strength = smoothstep(progress * 2.2);
    for (var y = 0; y < FH; y++) {
      var py = y / (FH - 1);
      for (var x = 0; x < FW; x++) {
        var px = x / (FW - 1), k = (y * FW + x) * 4;
        var sx = (x + ix) % FW;
        var a = values[y * FW + sx], b = values[y * FW + (sx + 1) % FW];
        var n = a + (b - a) * mix;
        var ridge = Math.sin(px * 9.5 + n * 5) * .033;
        var axis = origin.y + (n - .5) * .21 + ridge;
        var half = .13 + progress * .10 + Math.max(0, px - origin.x) * .07;
        var vertical = smoothstep((half - Math.abs(py - axis)) / .14);
        var right = smoothstep((front + (n - .5) * .32 - px) / .15);
        var left = smoothstep((px - origin.x + .23 + progress * .04) / .16);
        var edges = smoothstep(px / .07) * smoothstep((1 - px) / .08);
        edges *= smoothstep(py / .09) * smoothstep((1 - py) / .09);
        // Different local concentrations carry the tea's colour into the water.
        var density = .36 + smoothstep((n - .24) * 1.8) * .64;
        var alpha = vertical * right * left * edges * density * strength * .48;
        data[k] = color[0]; data[k + 1] = color[1]; data[k + 2] = color[2];
        data[k + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }

  root.HOCBotanicals = { names: names, pieces: pieces, draw: draw, drawInfusion: drawInfusion };
  if (!root.HOC || !root.HOC.controller) return;
  var HOC = root.HOC, atlases = {};
  function load(url) {
    if (!atlases[url]) atlases[url] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); }; img.onerror = reject; img.src = url;
    });
    return atlases[url];
  }

  HOC.controller("botanical-pile", function (el) {
    var row = el.closest(".hoc-range__cell"), stage = el.closest(".hoc-range__stage");
    var canvas, ink, pixels, atlas, items, marker, visibleObserver, centerObserver, resizeObserver;
    var disposed = false, loading = false, visible = false, centered = false, armed = false;
    var running = false, last = 0, age = 0, lastPaint = 0, progress = 0;
    var origin = { x: .17, y: .5 }, color = [173, 52, 80];
    var mq = root.matchMedia("(prefers-reduced-motion: reduce)");
    function reduced() { return mq.matches || HOC.env.tier === "reduced"; }
    function stop() { HOC.ticker.remove(tick); running = false; last = 0; }
    function reset() {
      stop(); age = progress = lastPaint = 0; armed = false;
      el.classList.remove("is-infusing");
      el.dataset.infusionProgress = "0";
      if (canvas && atlas) draw(canvas, atlas, items, 0, null, { time: 0 });
      if (ink) ink.getContext("2d").clearRect(0, 0, FW, FH);
    }
    function wake() {
      if (running || !visible || !armed || !atlas || reduced() || document.hidden) return;
      running = true; last = 0; HOC.ticker.add(tick);
    }
    function start() {
      if (!visible || !centered || reduced()) return;
      armed = true;
      if (atlas) el.classList.add("is-infusing");
      wake();
    }
    function tick(t) {
      if (reduced()) { reset(); return; }
      if (!visible || document.hidden) { stop(); return; }
      var dt = last ? Math.min(t - last, 64) : 16;
      last = t; age += dt;
      // Independent of pointer position and frame rate. Colour continues to
      // travel right while this product remains on screen.
      progress = 1 - Math.exp(-age / 4800);
      if (t - lastPaint < 33) return;
      lastPaint = t;
      draw(canvas, atlas, items, smoothstep(Math.min(1, age / 2400)), null, { time: age });
      drawInfusion(ink, pixels, color, origin, progress, age);
      el.dataset.infusionProgress = progress.toFixed(3);
    }
    function measure() {
      if (!canvas || !stage || !row) return;
      var stageBox = stage.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
      var pileBox = el.getBoundingClientRect();
      var width = Math.max(1, Math.round(el.clientWidth * Math.min(root.devicePixelRatio || 1, 1.5)));
      if (canvas.width !== width) canvas.width = canvas.height = width;
      ink.style.left = (stageBox.left - rowBox.left) + "px";
      ink.style.width = stageBox.width + "px";
      origin.x = clamp((pileBox.left + pileBox.width / 2 - stageBox.left) / stageBox.width, .1, .4);
      origin.y = clamp((pileBox.top + pileBox.height / 2 - rowBox.top) / rowBox.height, .2, .7);
      draw(canvas, atlas, items, smoothstep(Math.min(1, age / 2400)), null, { time: age });
      if (progress > 0) drawInfusion(ink, pixels, color, origin, progress, age);
    }
    function prepare() {
      if (loading || reduced()) return;
      items = pieces((el.dataset.ingredients || "").split("|"), el.dataset.seed || "hoc");
      if (!items.length) return;
      loading = true;
      load(el.dataset.atlas).then(function (image) {
        if (disposed) return;
        loading = false;
        atlas = image;
        canvas = document.createElement("canvas"); canvas.setAttribute("aria-hidden", "true");
        ink = document.createElement("canvas"); ink.className = "hoc-range__infusion";
        ink.setAttribute("aria-hidden", "true"); ink.width = FW; ink.height = FH;
        pixels = ink.getContext("2d").createImageData(FW, FH);
        color = rgb(getComputedStyle(el).getPropertyValue("--liquid"));
        row.prepend(ink); el.appendChild(canvas);
        measure(); el.classList.add("is-ready");
        if (armed) { el.classList.add("is-infusing"); wake(); }
        else start();
      }).catch(function () { loading = false; /* Static photo remains if the atlas fails. */ });
    }
    function visibility() { if (document.hidden) stop(); else wake(); }
    function preference() {
      if (reduced()) reset();
      else { if (visible && !atlas) prepare(); start(); }
    }
    function watchCenter() {
      if (!marker || disposed) return;
      if (centerObserver) centerObserver.disconnect();
      centered = false;
      // IO percentage margins use viewport width. Pixels keep this band at
      // the vertical center on both portrait and wide desktop screens.
      centerObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { centered = entry.isIntersecting; if (centered) start(); });
      }, { rootMargin: "-" + Math.round(root.innerHeight * .44) + "px 0px -" +
        Math.round(root.innerHeight * .40) + "px 0px" });
      centerObserver.observe(marker);
    }
    return {
      init: function () {
        if (!row || !stage) return;
        marker = document.createElement("span");
        marker.className = "hoc-range__center-marker"; marker.setAttribute("aria-hidden", "true");
        el.appendChild(marker);
        el.dataset.infusionProgress = "0";
        visibleObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            visible = entry.isIntersecting;
            if (visible) { if (!atlas) prepare(); start(); }
            else reset();
          });
        });
        visibleObserver.observe(row);
        watchCenter();
        resizeObserver = new ResizeObserver(measure); resizeObserver.observe(row);
        document.addEventListener("visibilitychange", visibility);
        mq.addEventListener("change", preference);
        HOC.on("tierchange", preference);
      },
      resize: function () { measure(); watchCenter(); },
      destroy: function () {
        disposed = true; reset();
        if (visibleObserver) visibleObserver.disconnect();
        if (centerObserver) centerObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        if (canvas) canvas.remove(); if (ink) ink.remove(); if (marker) marker.remove();
        el.classList.remove("is-ready"); delete el.dataset.infusionProgress;
        document.removeEventListener("visibilitychange", visibility);
        mq.removeEventListener("change", preference);
        HOC.off("tierchange", preference);
      }
    };
  });
})(window);
