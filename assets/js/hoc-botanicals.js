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
    var hover = flow ? flow.hover || 0 : 0;
    var handX = flow ? flow.x || 0 : 0, handY = flow ? flow.y || 0 : 0;
    items.forEach(function (p) {
      var local = smoothstep((spread - p.phase * .18) / .82);
      var radius = Math.hypot(p.x, p.y);
      var edge = smoothstep(radius / .28);
      // Expansion is proportional to distance: the core never becomes a ring.
      var turn = local * (.10 + edge * .18);
      turn += Math.sin(time * .00072 + p.pulse * .3) * (.022 + hover * .052) * local * edge;
      var rx = p.x * Math.cos(turn) - p.y * Math.sin(turn);
      var ry = p.x * Math.sin(turn) + p.y * Math.cos(turn);
      var x = .5 + rx * (1 + local * .28 * edge);
      var y = .5 + ry * (1 + local * .17 * edge);
      // A shared current carries the core too. Fine leaves have a little
      // independent drift; pointer speed never enters the motion equation.
      var buoyancy = local * (.35 + edge * .65);
      x += (Math.sin(time * .0008 + p.pulse * .25) * (.005 + hover * .008) + handX * hover * .018) * buoyancy;
      y += (Math.cos(time * .0007 + p.pulse * .3) * (.006 + hover * .008) + handY * hover * .013) * buoyancy;
      y += Math.sin(time * .001 + p.pulse) * .003 * p.float * local;
      var size = p.size * w;
      ctx.save();
      ctx.translate(x * w, y * h);
      ctx.rotate(p.angle + p.turn * local * .12 + Math.sin(time * .0008 + p.pulse) * (.018 + hover * .05) * local);
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
  function drawInfusion(canvas, pixels, color, origin, progress, time, hover) {
    var ctx = canvas.getContext("2d"), data = pixels.data, values = inkField();
    var shift = time * .003, ix = Math.floor(shift), mix = shift - ix;
    var front = origin.x + .06 + (1.12 - origin.x) * progress;
    var strength = smoothstep(progress * 3.3);
    var radiusX = origin.radiusX || .36, radiusY = origin.radiusY || .93;
    for (var y = 0; y < FH; y++) {
      var py = y / (FH - 1);
      for (var x = 0; x < FW; x++) {
        var px = x / (FW - 1), k = (y * FW + x) * 4;
        // Advect the pigment to the right, matching the direction of travel.
        var sx = ((x - ix) % FW + FW) % FW;
        var a = values[y * FW + sx], b = values[y * FW + (sx + FW - 1) % FW];
        var n = a + (b - a) * mix;
        var right = smoothstep((front + (n - .5) * .32 - px) / .15);
        var edges = smoothstep(px / .07) * smoothstep((1 - px) / .08);
        edges *= smoothstep(py / .09) * smoothstep((1 - py) / .09);
        // An upstream source feeds a widening downstream plume. There is no
        // radial distance, annulus or closed contour around the ingredients.
        var dx = (px - origin.x) / radiusX, dy = (py - origin.y) / radiusY;
        var downstream = Math.max(0, dx);
        var left = smoothstep((dx + .42) / .22);
        var bend = Math.sin(dx * 2.6 - time * .0006) * (.022 + downstream * .025);
        var axis = bend + (n - .5) * (.12 + downstream * .055);
        var width = .20 + progress * .04 + smoothstep(downstream / 1.8) * .09 + (n - .5) * .06;
        var body = Math.exp(-Math.pow((dy - axis) / width, 2) * 1.5);
        var upper = axis - .14 - Math.sin(dx * 3.2 - time * .00075) * .06;
        var lower = axis + .12 + Math.sin(dx * 2.7 - time * .0006) * .065;
        var wisps = Math.exp(-Math.pow((dy - upper) / .065, 2)) * .14;
        wisps += Math.exp(-Math.pow((dy - lower) / .07, 2)) * .11;
        var density = .60 + smoothstep((n - .24) * 1.8) * .40;
        var concentration = .34 + .38 * Math.exp(-downstream * .95);
        var plume = body * concentration + wisps * smoothstep((dx + .15) / .5);
        var alpha = Math.min(.78, plume * density * (1 + (hover || 0) * .10)) * left * right * strength * edges;
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
    var running = false, last = 0, age = 0, lastPaint = 0, progress = 0, motionTime = 0;
    var hover = 0, hoverTarget = 0;
    var pointer = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    var origin = { x: .17, y: .5 }, color = [173, 52, 80];
    var mq = root.matchMedia("(prefers-reduced-motion: reduce)");
    function reduced() { return mq.matches || HOC.env.tier === "reduced"; }
    function stop() { HOC.ticker.remove(tick); running = false; last = 0; }
    function reset() {
      stop(); age = progress = lastPaint = motionTime = hover = hoverTarget = 0; armed = false;
      pointer.x = pointer.y = target.x = target.y = 0;
      el.classList.remove("is-infusing");
      el.dataset.infusionProgress = "0";
      el.dataset.hoverStrength = "0";
      if (canvas && atlas) draw(canvas, atlas, items, 0, null, { time: 0 });
      if (ink) ink.getContext("2d").clearRect(0, 0, FW, FH);
    }
    function wake() {
      if (running || !visible || (!armed && !hoverTarget && hover < .003) || !atlas || reduced() || document.hidden) return;
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
      last = t; motionTime += dt;
      if (armed) age += dt;
      hover += (hoverTarget - hover) * (1 - Math.exp(-dt / (hoverTarget ? 380 : 720)));
      var follow = 1 - Math.exp(-dt / 420);
      pointer.x += (target.x - pointer.x) * follow;
      pointer.y += (target.y - pointer.y) * follow;
      // Independent of pointer position and frame rate. Colour continues to
      // travel right while this product remains on screen.
      progress = 1 - Math.exp(-age / 3550);
      if (!armed && !hoverTarget && hover < .003) { reset(); return; }
      if (t - lastPaint < 33) return;
      lastPaint = t;
      paint();
      el.dataset.infusionProgress = progress.toFixed(3);
      el.dataset.hoverStrength = hover.toFixed(3);
    }
    function paint() {
      var spread = Math.max(smoothstep(Math.min(1, age / 1750)), hover * .45);
      draw(canvas, atlas, items, spread, null, { time: motionTime, hover: hover, x: pointer.x, y: pointer.y });
      if (progress > 0) drawInfusion(ink, pixels, color, origin, progress, motionTime, hover);
    }
    function move(e) {
      if (e.pointerType === "touch" || reduced()) return;
      var box = el.getBoundingClientRect();
      target.x = clamp((e.clientX - box.left) / box.width * 2 - 1, -1, 1);
      target.y = clamp((e.clientY - box.top) / box.height * 2 - 1, -1, 1);
    }
    function enter(e) {
      if (e.pointerType === "touch" || reduced()) return;
      hoverTarget = 1; move(e); wake();
    }
    function leave() {
      hoverTarget = 0; target.x = target.y = 0;
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
      origin.radiusX = pileBox.width / stageBox.width;
      origin.radiusY = pileBox.width / rowBox.height;
      paint();
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
        else { start(); wake(); }
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
      // Begin on the approach to center, while the pile is still in the
      // lower third. Pixels keep this band independent of viewport width.
      centerObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { centered = entry.isIntersecting; if (centered) start(); });
      }, { rootMargin: "-" + Math.round(root.innerHeight * .44) + "px 0px -" +
        Math.round(root.innerHeight * .18) + "px 0px" });
      centerObserver.observe(marker);
    }
    return {
      init: function () {
        if (!row || !stage) return;
        marker = document.createElement("span");
        marker.className = "hoc-range__center-marker"; marker.setAttribute("aria-hidden", "true");
        el.appendChild(marker);
        el.dataset.infusionProgress = "0";
        el.dataset.hoverStrength = "0";
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
        el.addEventListener("pointerenter", enter);
        el.addEventListener("pointermove", move, { passive: true });
        el.addEventListener("pointerleave", leave);
        el.addEventListener("pointercancel", leave);
      },
      resize: function () { measure(); watchCenter(); },
      destroy: function () {
        disposed = true; reset();
        if (visibleObserver) visibleObserver.disconnect();
        if (centerObserver) centerObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        if (canvas) canvas.remove(); if (ink) ink.remove(); if (marker) marker.remove();
        el.classList.remove("is-ready"); delete el.dataset.infusionProgress; delete el.dataset.hoverStrength;
        document.removeEventListener("visibilitychange", visibility);
        mq.removeEventListener("change", preference);
        HOC.off("tierchange", preference);
        el.removeEventListener("pointerenter", enter);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
        el.removeEventListener("pointercancel", leave);
      }
    };
  });

  // One continuous botanical procession. Real recipe fragments drift with
  // each blend; no duplicated links, offscreen loops or second animation clock.
  HOC.controller("footer-current", function (el) {
    var viewport = el.querySelector(".hoc-current__viewport");
    var entries = Array.prototype.slice.call(el.querySelectorAll(".hoc-current__item"));
    var button = el.querySelector("[data-current-pause]");
    var observer, visible = false, playing = false, paused = false, focused = false, hovering = false;
    var decorated = false, enabled = false, width = 520, offset = 560, total = 0, viewportWidth = 0;
    var last = 0, time = 0, speed = 0, lastPaint = 0, petals = [];
    var recipes = entries.map(function (entry) {
      return (entry.dataset.ingredients || "").split("|").map(function (name) {
        return names.indexOf(name.trim());
      }).filter(function (i) { return i >= 0; });
    });
    var stream = null, streamContext = null, streamTiles = null, streamImage = null;
    var mq = root.matchMedia("(prefers-reduced-motion: reduce)");
    function reduced() { return mq.matches || HOC.env.reduced || HOC.env.tier === "reduced"; }
    function stop() { HOC.ticker.remove(tick); playing = false; last = 0; }
    function wake() {
      if (playing || !enabled || !visible || paused || focused || document.hidden) return;
      playing = true; last = 0; HOC.ticker.add(tick);
    }
    function hash(value) {
      var n = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
      return n - Math.floor(n);
    }
    function streamSize() {
      if (!stream || !viewport) return;
      var ratio = Math.min(root.devicePixelRatio || 1, 1.5);
      var height = viewport.clientHeight || 278;
      stream.width = Math.max(1, Math.round(viewport.clientWidth * ratio));
      stream.height = Math.max(1, Math.round(height * ratio));
      streamContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function prepareStream() {
      if (stream || !viewport || !el.dataset.atlas) return;
      stream = document.createElement("canvas");
      stream.className = "hoc-current__stream";
      stream.setAttribute("aria-hidden", "true");
      streamContext = stream.getContext("2d", { alpha: true });
      if (!streamContext) { stream.remove(); stream = null; return; }
      viewport.insertBefore(stream, viewport.firstChild);
      streamSize();
      streamImage = new Image();
      streamImage.onload = function () {
        if (!stream || !streamContext) return;
        var sw = streamImage.naturalWidth / 6, sh = streamImage.naturalHeight / 5;
        streamTiles = names.map(function (_, i) {
          var tile = document.createElement("canvas");
          tile.width = tile.height = 96;
          tile.getContext("2d").drawImage(streamImage, i % 6 * sw, Math.floor(i / 6) * sh, sw, sh, 0, 0, 96, 96);
          return tile;
        });
        paintStream();
        el.classList.add("is-stream-ready");
      };
      streamImage.src = el.dataset.atlas;
    }
    function paintStream() {
      if (!streamTiles || !streamContext || !enabled || !visible || !total) return;
      var ctx = streamContext, canvasHeight = viewport.clientHeight;
      var cell = viewportWidth < 700 ? 23 : 25;
      var rows = viewportWidth < 700 ? 5 : 6;
      var rowGap = viewportWidth < 700 ? 25 : 26;
      var bandTop = viewportWidth < 700 ? 26 : 31;
      var first = Math.floor((offset - viewportWidth - cell) / cell);
      var final = Math.ceil((offset + cell) / cell);
      var viewportRect = viewport.getBoundingClientRect();
      var sloganBounds = [];
      entries.forEach(function (entry) {
        if (entry.inert) return;
        var saying = entry.querySelector(".hoc-current__saying");
        if (!saying) return;
        var range = document.createRange();
        range.selectNodeContents(saying);
        Array.prototype.forEach.call(range.getClientRects(), function (rect) {
          sloganBounds.push({
            left: rect.left - viewportRect.left - 12,
            right: rect.right - viewportRect.left + 12,
            top: rect.top - viewportRect.top - 7,
            bottom: rect.bottom - viewportRect.top + 7
          });
        });
      });
      ctx.clearRect(0, 0, viewportWidth, canvasHeight);
      for (var col = first; col <= final; col++) {
        var source = ((col * cell) % total + total) % total;
        var blend = Math.min(recipes.length - 1, Math.floor(source / width));
        var next = (blend + 1) % recipes.length;
        var phase = (source % width) / width;
        var mix = smoothstep((phase - .53) / .44);
        var primary = recipes[blend], secondary = recipes[next];
        if (!primary.length) continue;
        for (var row = 0; row < rows; row++) {
          var seed = col * 17.13 + row * 127.7;
          var jitter = hash(seed);
          var x = offset - col * cell + (jitter - .5) * 7;
          var y = bandTop + row * rowGap + (hash(seed + 3) - .5) * 10;
          y += Math.sin(time * .00072 + seed) * 2.2;
          var size = cell * (1.02 + hash(seed + 7) * .28);
          var angle = (hash(seed + 11) - .5) * .48 + Math.sin(time * .0004 + seed) * .055;
          // Omit the entire rotated tile if it would touch a slogan. Clearing
          // pixels afterward sliced pieces in half at the text boundary.
          var radius = size * .71;
          if (sloganBounds.some(function (rect) {
            return x + radius > rect.left && x - radius < rect.right &&
              y + radius > rect.top && y - radius < rect.bottom;
          })) continue;
          var type = primary[Math.floor(hash(seed + 13) * primary.length)];
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.globalAlpha = .88 * (1 - mix);
          ctx.drawImage(streamTiles[type], -size / 2, -size / 2, size, size);
          if (secondary.length && mix > .01) {
            var other = secondary[Math.floor(hash(seed + 23) * secondary.length)];
            ctx.globalAlpha = .88 * mix;
            ctx.drawImage(streamTiles[other], -size / 2, -size / 2, size, size);
          }
          ctx.restore();
        }
      }
      el.dataset.streamBlend = String(Math.floor((((offset - viewportWidth / 2) % total + total) % total) / width));
    }
    function decorate() {
      if (decorated) return;
      decorated = true;
      entries.forEach(function (entry, index) {
        var media = entry.querySelector(".hoc-current__media");
        var recipe = (entry.dataset.ingredients || "").split("|").map(function (name) { return names.indexOf(name.trim()); }).filter(function (i) { return i >= 0; });
        var rand = random(entry.dataset.seed || String(index));
        var group = [];
        // An 8 x 5 specimen field. Recipes are evenly represented, then
        // shuffled so no ingredient turns into a mechanical row or stripe.
        var slots = [];
        for (var slot = 0; slot < 40; slot++) slots.push(recipe[slot % recipe.length]);
        for (var shuffle = slots.length - 1; shuffle > 0; shuffle--) {
          var swap = Math.floor(rand() * (shuffle + 1)), held = slots[shuffle];
          slots[shuffle] = slots[swap]; slots[swap] = held;
        }
        if (media && recipe.length) for (var i = 0; i < 40; i++) {
          var col = i % 8, row = Math.floor(i / 8);
          var type = slots[i], node = document.createElement("span");
          node.className = "hoc-current__petal"; node.setAttribute("aria-hidden", "true");
          node.dataset.botanical = names[type];
          node.style.backgroundImage = 'url("' + el.dataset.atlas + '")';
          node.style.backgroundPosition = (type % 6 / 5 * 100) + "% " + (Math.floor(type / 6) / 4 * 100) + "%";
          var size = 19 + rand() * 7;
          node.style.width = node.style.height = size + "px";
          media.appendChild(node);
          group.push({
            node: node,
            x: (col + .5) / 8 + (rand() - .5) * .025,
            y: (row + .5) / 5 + (rand() - .5) * .035,
            phase: rand() * 6.28,
            angle: (rand() - .5) * 20,
            size: size
          });
        }
        petals.push(group);
      });
      el.classList.add("is-matrix-ready");
    }
    function paintPetals(entry, group, wave, animate) {
      var media = entry.querySelector(".hoc-current__media");
      if (!media) return;
      var mediaWidth = media.clientWidth || 232, mediaHeight = media.clientHeight || 154;
      group.forEach(function (p) {
        var driftX = animate ? Math.sin(wave + p.phase) * 2.7 : 0;
        var driftY = animate ? Math.cos(wave * .85 + p.phase) * 2.1 : 0;
        var turn = p.angle + (animate ? Math.sin(wave + p.phase) * 3.5 : 0);
        var px = p.x * mediaWidth - p.size / 2 + driftX;
        var py = p.y * mediaHeight - p.size / 2 + driftY;
        p.node.style.transform = "translate3d(" + px.toFixed(2) + "px," + py.toFixed(2) + "px,0) rotate(" + turn.toFixed(2) + "deg)";
      });
    }
    function paint() {
      entries.forEach(function (entry, i) {
        // Negative index makes the catalogue follow Gift -> Mystic -> ... as
        // it enters from the left, travelling toward the right.
        var x = ((offset - i * width) % total + total) % total - width;
        var on = x > -width + 8 && x < viewportWidth - 8;
        entry.style.transform = "translate3d(" + x.toFixed(2) + "px,0,0)";
        entry.style.visibility = on ? "visible" : "hidden";
        entry.inert = !on;
        if (on) entry.removeAttribute("aria-hidden"); else entry.setAttribute("aria-hidden", "true");
        if (!on) return;
        var wave = time * .00065 + i * 1.7;
        entry.style.setProperty("--current-bob", (Math.sin(wave) * 5).toFixed(2) + "px");
        entry.style.setProperty("--current-turn", (Math.sin(wave * .7) * 2).toFixed(2) + "deg");
        if (!streamTiles) paintPetals(entry, petals[i] || [], wave, true);
      });
      paintStream();
      el.dataset.flowOffset = offset.toFixed(2);
    }
    function tick(t) {
      if (reduced()) { mode(); return; }
      if (!visible || paused || focused || document.hidden) { stop(); return; }
      var dt = last ? Math.min(t - last, 64) : 16;
      last = t; time += dt;
      var target = hovering ? 13 : (viewportWidth < 700 ? 32 : 48);
      speed += (target - speed) * (1 - Math.exp(-dt / 550));
      offset = (offset + speed * dt / 1000) % total;
      if (t - lastPaint < 33) return;
      lastPaint = t; paint();
    }
    function measure() {
      if (!entries.length) return;
      var next = entries[0].getBoundingClientRect().width || 520;
      offset = offset / width * next; width = next;
      total = width * entries.length; viewportWidth = viewport.clientWidth;
      streamSize();
      if (enabled) paint();
    }
    function mode() {
      enabled = !reduced() && entries.length > 1;
      el.classList.toggle("is-flowing", enabled);
      button.hidden = !enabled;
      if (!enabled) {
        stop();
        entries.forEach(function (entry) { entry.style.transform = ""; entry.style.visibility = ""; entry.style.removeProperty("--current-bob"); entry.style.removeProperty("--current-turn"); entry.inert = false; entry.removeAttribute("aria-hidden"); });
        decorate();
        petals.forEach(function (group, i) {
          group.forEach(function (p) { p.node.hidden = false; });
          paintPetals(entries[i], group, 0, false);
        });
      } else {
        decorate();
        prepareStream();
        petals.forEach(function (group) { group.forEach(function (p) { p.node.hidden = false; }); });
        measure(); wake();
      }
    }
    function pause() {
      paused = !paused;
      button.setAttribute("aria-pressed", String(paused));
      button.textContent = paused ? "Resume flow" : "Pause flow";
      if (paused) stop(); else wake();
    }
    function enter(e) { if (e.pointerType !== "touch") hovering = true; }
    function leave() { hovering = false; }
    function focusIn() { focused = true; stop(); }
    function focusOut(e) { if (!viewport.contains(e.relatedTarget)) { focused = false; wake(); } }
    function visibility() { if (document.hidden) stop(); else wake(); }
    function navigate(e) {
      var link = e.target.closest("[data-range-index]");
      if (!link) return;
      var cells = document.querySelectorAll(".hoc-range__col--left .hoc-range__cell");
      var cell = cells[Number(link.dataset.rangeIndex)];
      if (!cell) return;
      e.preventDefault();
      var box = cell.getBoundingClientRect(), y = root.scrollY + box.top + box.height / 2 - (root.innerHeight / 2 + 31);
      if (HOC.lenis) HOC.lenis.scrollTo(y); else root.scrollTo({ top: y, behavior: reduced() ? "instant" : "smooth" });
    }
    return {
      init: function () {
        if (!entries.length || !viewport || !button) return;
        button.textContent = "Pause flow"; button.setAttribute("aria-pressed", "false");
        decorate(); mode();
        observer = new IntersectionObserver(function (events) {
          visible = events[0].isIntersecting;
          if (visible && enabled) { decorate(); paint(); wake(); } else stop();
        });
        observer.observe(viewport);
        button.addEventListener("click", pause);
        viewport.addEventListener("pointerenter", enter); viewport.addEventListener("pointerleave", leave);
        viewport.addEventListener("focusin", focusIn); viewport.addEventListener("focusout", focusOut);
        viewport.addEventListener("click", navigate);
        mq.addEventListener("change", mode); HOC.on("tierchange", mode);
        document.addEventListener("visibilitychange", visibility);
      },
      resize: measure,
      destroy: function () {
        stop(); if (observer) observer.disconnect();
        button.removeEventListener("click", pause);
        viewport.removeEventListener("pointerenter", enter); viewport.removeEventListener("pointerleave", leave);
        viewport.removeEventListener("focusin", focusIn); viewport.removeEventListener("focusout", focusOut);
        viewport.removeEventListener("click", navigate);
        mq.removeEventListener("change", mode); HOC.off("tierchange", mode);
        document.removeEventListener("visibilitychange", visibility);
        el.classList.remove("is-flowing", "is-matrix-ready", "is-stream-ready"); delete el.dataset.flowOffset; delete el.dataset.streamBlend; button.hidden = true;
        if (streamImage) streamImage.onload = null;
        if (stream) stream.remove();
        stream = null; streamContext = null; streamTiles = null; streamImage = null;
        entries.forEach(function (entry) { entry.style.transform = ""; entry.style.visibility = ""; entry.style.removeProperty("--current-bob"); entry.style.removeProperty("--current-turn"); entry.inert = false; entry.removeAttribute("aria-hidden"); });
        petals.forEach(function (group) { group.forEach(function (p) { p.node.remove(); }); });
      }
    };
  });
})(window);
