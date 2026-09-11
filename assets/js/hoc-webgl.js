/* ==========================================================================
   HOC TEA — hoc-webgl.js
   The rendering layer: two fragment shaders and one canvas-2D scene.

   WHY NOT OGL (§32)
   -----------------
   The spec picks OGL over Three.js because HOC never needs a scene graph —
   only fullscreen quads with custom fragment shaders. As of writing, OGL
   publishes ES-module source only (no UMD/IIFE build), which means a bundler
   or a deep tree of ESM requests inside a Liquid theme that otherwise has no
   build step. So the same argument is taken one step further: HOCGL below is
   a ~120-line fullscreen-quad renderer with no dependency at all.

   It exposes the shape OGL would (program, uniforms, resize, render), so
   swapping in `new Renderer()/Program/Mesh` later is a local change inside
   this file and nothing above it moves.

   Everything here degrades: if WebGL is unavailable or the tier drops to
   reduced, controllers call .destroy() and the CSS fallbacks take over (§38).
   ========================================================================== */

(function (root, doc) {
  "use strict";

  var HOC = (root.HOC = root.HOC || {});

  /* ======================================================================
     1. HOCGL — fullscreen-quad renderer
     ====================================================================== */

  var VERT =
    "attribute vec2 aPos;varying vec2 vUv;" +
    "void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.0,1.0);}";

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("[hoc:gl]", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function HOCGL(canvas, frag, opts) {
    opts = opts || {};
    var gl =
      canvas.getContext("webgl", {
        alpha: opts.alpha !== false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: "high-performance"
      }) || null;
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[hoc:gl] link", gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    // One triangle covers the viewport with no seam down the diagonal.
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    var loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Cache uniform locations + types up front so set() is allocation-free.
    var uniforms = {};
    var n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(prog, i);
      var name = info.name.replace(/\[0\]$/, "");
      uniforms[name] = {
        loc: gl.getUniformLocation(prog, info.name),
        type: info.type,
        size: info.size
      };
    }

    var textures = {};
    var texUnit = 0;
    var dpr = 1;
    var lost = false;

    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      lost = true;
    });

    var api = {
      gl: gl,
      get lost() {
        return lost;
      },

      set: function (name, v) {
        var u = uniforms[name];
        if (!u) return api;
        var t = u.type;
        if (t === gl.FLOAT) gl.uniform1f(u.loc, v);
        else if (t === gl.FLOAT_VEC2) gl.uniform2f(u.loc, v[0], v[1]);
        else if (t === gl.FLOAT_VEC3) gl.uniform3f(u.loc, v[0], v[1], v[2]);
        else if (t === gl.FLOAT_VEC4) gl.uniform4f(u.loc, v[0], v[1], v[2], v[3]);
        else if (t === gl.INT || t === gl.BOOL) gl.uniform1i(u.loc, v);
        else if (t === gl.SAMPLER_2D) gl.uniform1i(u.loc, v);
        return api;
      },

      /** Upload an HTMLImageElement / video / canvas as a texture.
          Returns true only if the pixels actually landed — over file:// a
          local image counts as cross-origin and texImage2D throws, and a
          caller that ignores that ends up showing an empty black quad on top
          of a perfectly good poster. */
      texture: function (name, source) {
        var slot = textures[name];
        if (!slot) {
          slot = textures[name] = { unit: texUnit++, tex: gl.createTexture() };
        }
        gl.activeTexture(gl.TEXTURE0 + slot.unit);
        gl.bindTexture(gl.TEXTURE_2D, slot.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        try {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            source
          );
        } catch (e) {
          // Tainted (file://), or not decoded yet.
          return false;
        }
        api.set(name, slot.unit);
        return true;
      },

      resize: function (maxDpr) {
        var r = canvas.getBoundingClientRect();
        dpr = Math.min(root.devicePixelRatio || 1, maxDpr || 2);
        var w = Math.max(1, Math.round(r.width * dpr));
        var h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        api.set("uRes", [w, h]);
        return api;
      },

      render: function () {
        if (lost) return api;
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return api;
      },

      destroy: function () {
        Object.keys(textures).forEach(function (k) {
          gl.deleteTexture(textures[k].tex);
        });
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        var ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      }
    };
    return api;
  }

  HOC.GL = HOCGL;

  /* ======================================================================
     2. SHARED GLSL
     ====================================================================== */

  var NOISE = [
    "float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
    "float vnoise(vec2 p){",
    "  vec2 i=floor(p),f=fract(p);",
    "  vec2 u=f*f*(3.0-2.0*f);",
    "  float a=hash21(i),b=hash21(i+vec2(1.0,0.0));",
    "  float c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));",
    "  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);",
    "}",
    "const mat2 ROT=mat2(0.8,-0.6,0.6,0.8);",
    "float fbm(vec2 p){",
    "  float v=0.0,a=0.5;",
    "  for(int i=0;i<5;i++){v+=a*vnoise(p);p=ROT*p*2.03;a*=0.5;}",
    "  return v;",
    "}"
  ].join("\n");

  /* ======================================================================
     3. HERO SHADER  §10
     The poster, drawn back through a shader that lets the pointer *pull* the
     surface in its direction of travel. The brief is explicit: it must read
     as "the video feels alive", not as "there is an effect". Peak UV
     displacement is 0.016 — about 20px at 1440 — and falls off fast.
     ====================================================================== */

  HOC.shaderHero = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uTex;",
    "uniform vec2 uRes;",
    "uniform vec2 uTexRes;",
    "uniform vec2 uPointer;",
    "uniform vec2 uVel;",
    "uniform float uTime;",
    "uniform float uIntensity;",
    NOISE,
    "void main(){",
    // cover-fit the texture into the viewport
    "  float sa=uRes.x/uRes.y, ta=uTexRes.x/uTexRes.y;",
    "  vec2 ratio=vec2(min(sa/ta,1.0), min(ta/sa,1.0));",
    "  vec2 cuv=vec2(vUv.x*ratio.x+(1.0-ratio.x)*0.5,",
    "                vUv.y*ratio.y+(1.0-ratio.y)*0.5);",
    // aspect-corrected distance so the falloff is a circle, not an ellipse
    "  vec2 ap=vec2((vUv.x-uPointer.x)*sa,(vUv.y-uPointer.y));",
    "  float infl=smoothstep(0.46,0.0,length(ap));",
    // slow ambient drift so the plate breathes with no pointer at all
    "  vec2 flow=vec2(fbm(vUv*2.4+uTime*0.045)-0.5,",
    "                 fbm(vUv*2.4+vec2(11.3,7.7)-uTime*0.038)-0.5);",
    "  float grain=0.7+0.6*vnoise(vUv*3.0+uTime*0.05);",
    "  vec2 disp=(uVel*infl*0.016+flow*0.007)*uIntensity*grain;",
    // ≤1-2px perceived chromatic separation at the displaced edges (§14)
    "  vec3 col;",
    "  col.r=texture2D(uTex,cuv+disp*1.05).r;",
    "  col.g=texture2D(uTex,cuv+disp).g;",
    "  col.b=texture2D(uTex,cuv+disp*0.95).b;",
    // The pulled area lifts very slightly, like light through moving liquid.
    // Kept low because the HOC film is light-key — on a pale plate a bigger
    // lift clips to white instead of reading as refraction.
    "  col+=infl*length(uVel)*0.05*vec3(0.55,0.72,0.70)*(1.0-col);",
    "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  /* ======================================================================
     4. COLOR ALCHEMY SHADER  §14

     Butterfly pea steeps indigo. Hibiscus is an acid; where it reaches, the
     pigment turns violet and then magenta. The transition must NOT be a
     radial gradient — real pigment spreads unevenly.

     So the reaction is a threshold against an FBM field: as the reaction
     level rises, more of the field falls below it and turns, blooming
     outward in ragged fingers. The pointer adds a local bump so the user
     feels they caused it, and the level itself is fed by both pointer travel
     and scroll (§14 scroll alternative for non-pointer devices).
     ====================================================================== */

  HOC.shaderAlchemy = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform vec2 uRes;",
    "uniform vec2 uPointer;",
    "uniform float uVelocity;",
    "uniform float uProgress;",
    "uniform float uTime;",
    "uniform vec3 uBlue;",
    "uniform vec3 uViolet;",
    "uniform vec3 uMagenta;",
    "uniform float uGlass;",
    NOISE,
    "void main(){",
    "  float asp=uRes.x/uRes.y;",
    "  vec2 p=(vUv-0.5)*vec2(asp,1.0);",
    // Wide screens: sit the glass right of centre so the headline owns the
    // left. Portrait: centre it.
    "  float shift=asp>1.15?0.215:0.0;",
    "  vec2 g=vec2(p.x-shift*asp*0.5,p.y);",

    // --- tumbler: tapered walls, softened base, open top -----------------
    "  float hTop=0.375, hBot=0.395;",
    "  float wTop=0.168, wBot=0.150;",
    "  float t=clamp((g.y+hBot)/(hTop+hBot),0.0,1.0);",
    "  float halfW=mix(wBot,wTop,t);",
    "  halfW*=0.855+0.145*sqrt(clamp((g.y+hBot)/0.085,0.0,1.0));", // rounded base
    "  float dx=abs(g.x)-halfW;",
    "  float d=max(max(dx,g.y-hTop),-g.y-hBot);",
    "  float inside=smoothstep(0.0035,-0.0035,d);",
    "  float wall=smoothstep(0.0075,0.0,abs(d));",

    // --- pigment field ---------------------------------------------------
    "  vec2 q=vUv*vec2(asp,1.0);",
    "  float warp=fbm(q*1.7+uTime*0.02);",
    "  float field=fbm(q*3.4+vec2(warp*1.5,-uTime*0.035));",
    "  field=field*0.82+0.18*fbm(q*8.0-uTime*0.05);",
    "  vec2 ap=vec2((vUv.x-uPointer.x)*asp,vUv.y-uPointer.y);",
    "  float local=smoothstep(0.30,0.0,length(ap))*(0.18+uVelocity*0.50);",
    // A rising threshold against noise: the boundary is ragged fingers, not
    // a radial gradient. This is the whole point of the section (§14).
    "  float level=uProgress*1.24+local;",
    "  float react=smoothstep(field-0.19,field+0.19,level);",

    // --- liquid ----------------------------------------------------------
    "  float surface=hTop-0.052+0.0045*sin(g.x*26.0+uTime*0.7);",
    "  float inLiquid=inside*smoothstep(0.004,-0.004,g.y-surface);",
    "  vec3 col=mix(uBlue,uViolet,smoothstep(0.02,0.60,react));",
    "  col=mix(col,uMagenta,smoothstep(0.50,1.0,react));",
    // depth: denser and darker toward the base
    "  col*=0.62+0.52*smoothstep(-hBot,surface,g.y);",
    // slow caustic sheet, kept well under a highlight
    "  float caustic=fbm(q*6.0+vec2(uTime*0.08,uTime*0.05));",
    "  col+=pow(caustic,4.0)*0.20*mix(vec3(0.45,0.55,1.0),vec3(1.0,0.55,0.8),react);",

    // --- the empty glass above the liquid --------------------------------
    "  vec3 air=mix(vec3(0.030,0.031,0.045),col*0.30,0.35);",
    "  vec3 glassCol=mix(air,col,inLiquid);",

    // --- ground + bounce --------------------------------------------------
    "  vec3 ground=vec3(0.026,0.027,0.038);",
    "  float floorY=smoothstep(-hBot-0.10,-hBot,g.y)*(1.0-smoothstep(-hBot,-hBot+0.02,g.y));",
    "  float bounce=smoothstep(0.30,0.0,abs(g.x))*smoothstep(-hBot-0.16,-hBot,g.y)*(1.0-inside);",
    "  ground+=col*bounce*0.22;",
    "  vec3 outCol=mix(ground,glassCol,inside);",

    // --- glass edges: a thin bright line, a left-wall specular, and at most
    //     1-2px of chromatic separation. No glow, no glitch (§14, §59).
    "  float px=1.2/uRes.y;",
    "  float er=smoothstep(0.0060,0.0,abs(d-px));",
    "  float eb=smoothstep(0.0060,0.0,abs(d+px));",
    "  outCol.r+=er*0.10*uGlass;",
    "  outCol.b+=eb*0.12*uGlass;",
    "  outCol+=wall*0.22*uGlass*vec3(0.86,0.90,1.0);",
    "  float spec=smoothstep(0.012,0.0,abs(g.x+halfW*0.72))*inside;",
    "  outCol+=spec*0.10*vec3(1.0);",
    // rim ellipse at the mouth of the glass
    "  float rimE=abs(length(vec2(g.x/max(wTop,0.001),(g.y-hTop)/0.028))-1.0);",
    "  outCol+=smoothstep(0.16,0.0,rimE)*0.16*uGlass;",
    // meniscus line where liquid meets glass
    "  outCol+=smoothstep(0.0045,0.0,abs(g.y-surface))*inside*0.14;",

    // --- grain + vignette so overlay type always holds --------------------
    "  outCol+=(hash21(vUv*uRes)-0.5)*0.018;",
    "  float vig=smoothstep(1.30,0.22,length(p));",
    "  outCol*=0.70+0.30*vig;",
    "  gl_FragColor=vec4(outCol,1.0);",
    "}"
  ].join("\n");

  /* ======================================================================
     5. LEAF TO GLASS — canvas 2D scene  §13

     One pure function of progress. The desktop controller scrubs it with
     ScrollTrigger; the mobile controller calls it at three fixed values.
     Deterministic PRNG so the botanicals land in the same place every frame.
     ====================================================================== */

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  var clamp = function (v, a, b) {
    return v < a ? a : v > b ? b : v;
  };
  // progress within a window, eased
  function span(p, a, b) {
    return clamp((p - a) / (b - a), 0, 1);
  }
  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  var PIECES = null;
  function buildPieces() {
    var r = rng(20260827);
    var kinds = ["petal", "leaf", "blade"];
    var out = [];
    for (var i = 0; i < 22; i++) {
      out.push({
        kind: kinds[i % 3],
        // start: loose cluster above the glass
        sx: 0.5 + (r() - 0.5) * 0.62,
        sy: -0.06 - r() * 0.30,
        // rest: spread through the lower half of the liquid
        rx: 0.5 + (r() - 0.5) * 0.58,
        ry: 0.46 + r() * 0.42,
        rot: r() * Math.PI * 2,
        spin: (r() - 0.5) * 5.2,
        size: 0.036 + r() * 0.040,
        delay: r() * 0.55,
        drift: (r() - 0.5) * 0.16,
        bob: r() * Math.PI * 2
      });
    }
    return out;
  }

  var ICE = null;
  function buildIce() {
    var r = rng(77341);
    var out = [];
    for (var i = 0; i < 5; i++) {
      out.push({
        x: 0.5 + (r() - 0.5) * 0.46,
        y: 0.20 + r() * 0.30,
        s: 0.13 + r() * 0.07,
        rot: (r() - 0.5) * 0.9,
        delay: i * 0.09
      });
    }
    return out;
  }

  var DROPS = null;
  function buildDrops() {
    var r = rng(9931);
    var out = [];
    for (var i = 0; i < 34; i++) {
      out.push({
        x: r(),
        y: 0.12 + r() * 0.84,
        s: 0.004 + r() * 0.008,
        delay: r()
      });
    }
    return out;
  }

  /** Interior of the tumbler in normalised glass-box coordinates. */
  function glassPath(ctx, X, Y, W, H) {
    var topIn = 0.055 * W; // slight taper
    var r = 0.16 * W;
    ctx.beginPath();
    ctx.moveTo(X + topIn, Y);
    ctx.lineTo(X + W - topIn, Y);
    ctx.lineTo(X + W, Y + H - r);
    ctx.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H);
    ctx.lineTo(X + r, Y + H);
    ctx.quadraticCurveTo(X, Y + H, X, Y + H - r);
    ctx.lineTo(X + topIn, Y);
    ctx.closePath();
  }

  function drawPiece(ctx, kind, s, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.beginPath();
    if (kind === "petal") {
      // hibiscus petal: a lens
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.85, -s * 0.4, s * 0.7, s * 0.6, 0, s);
      ctx.bezierCurveTo(-s * 0.7, s * 0.6, -s * 0.85, -s * 0.4, 0, -s);
      ctx.fill();
    } else if (kind === "leaf") {
      // mint leaf: pointed oval + midrib
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.72, -s * 0.5, s * 0.72, s * 0.5, 0, s);
      ctx.bezierCurveTo(-s * 0.72, s * 0.5, -s * 0.72, -s * 0.5, 0, -s);
      ctx.fill();
      ctx.save();
      ctx.globalAlpha *= 0.45;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.86);
      ctx.lineTo(0, s * 0.86);
      ctx.stroke();
      ctx.restore();
    } else {
      // lemongrass blade: a thin arc
      ctx.moveTo(-s * 0.18, -s * 1.25);
      ctx.quadraticCurveTo(s * 0.34, 0, -s * 0.1, s * 1.25);
      ctx.quadraticCurveTo(-s * 0.02, 0, -s * 0.18, -s * 1.25);
      ctx.fill();
    }
  }

  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3)
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * Draw the whole scene.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w css pixels
   * @param {number} h css pixels
   * @param {number} p 0..1 scene progress
   * @param {object} o { liquid: '#hex', ink: '#hex', time: ms }
   */
  function drawGlassScene(ctx, w, h, p, o) {
    o = o || {};
    if (!PIECES) {
      PIECES = buildPieces();
      ICE = buildIce();
      DROPS = buildDrops();
    }
    var liquid = hexToRgb(o.liquid || "#B4324B");
    var line = o.ink || "rgba(241,239,232,0.85)";
    var t = (o.time || 0) / 1000;

    ctx.clearRect(0, 0, w, h);

    // Glass box: tall, centred, with headroom above for the falling stage.
    var GH = h * 0.70;
    var GW = Math.min(w * 0.66, GH * 0.60);
    var GX = (w - GW) / 2;
    var GY = h - GH - h * 0.06;

    var toX = function (nx) {
      return GX + nx * GW;
    };
    var toY = function (ny) {
      return GY + ny * GH;
    };

    /* ---- 0-0.30 : dry botanicals gather and fall --------------------- */
    var fall = easeInOut(span(p, 0.12, 0.36));

    /* ---- 0.30-0.52 : water rises ------------------------------------ */
    var fill = easeOut(span(p, 0.3, 0.54));
    var level = 0.90 * fill; // fraction of interior height filled, from bottom

    /* ---- 0.50-0.74 : colour diffuses -------------------------------- */
    var tint = easeInOut(span(p, 0.5, 0.76));

    /* ---- 0.72-0.90 : ice -------------------------------------------- */
    var iceIn = span(p, 0.72, 0.9);

    /* ---- 0.86-1.00 : condensation ----------------------------------- */
    var dew = span(p, 0.86, 1.0);

    // ------------------------------------------------------------------
    // Liquid, clipped to the glass interior
    // ------------------------------------------------------------------
    ctx.save();
    glassPath(ctx, GX, GY, GW, GH);
    ctx.clip();

    // The empty part of the vessel still has two glass walls behind it.
    var airGrad = ctx.createLinearGradient(GX, 0, GX + GW, 0);
    airGrad.addColorStop(0, "rgba(255,255,255,0.055)");
    airGrad.addColorStop(0.2, "rgba(255,255,255,0.012)");
    airGrad.addColorStop(0.8, "rgba(255,255,255,0.012)");
    airGrad.addColorStop(1, "rgba(255,255,255,0.045)");
    ctx.fillStyle = airGrad;
    ctx.fillRect(GX, GY, GW, GH);

    if (level > 0.001) {
      var surfaceY = GY + GH * (1 - level);
      // a gently moving meniscus
      var wob = Math.sin(t * 0.9) * GH * 0.006 * (1 - fill * 0.6);

      var grad = ctx.createLinearGradient(0, surfaceY, 0, GY + GH);
      var a0 = 0.22 + 0.55 * tint;
      var a1 = 0.34 + 0.62 * tint;
      grad.addColorStop(
        0,
        "rgba(" + liquid[0] + "," + liquid[1] + "," + liquid[2] + "," + a0 * 0.72 + ")"
      );
      grad.addColorStop(
        1,
        "rgba(" + liquid[0] + "," + liquid[1] + "," + liquid[2] + "," + a1 + ")"
      );
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(GX - 4, surfaceY + wob);
      ctx.bezierCurveTo(
        GX + GW * 0.32, surfaceY - GH * 0.012 + wob,
        GX + GW * 0.68, surfaceY + GH * 0.012 + wob,
        GX + GW + 4, surfaceY + wob
      );
      ctx.lineTo(GX + GW + 4, GY + GH + 4);
      ctx.lineTo(GX - 4, GY + GH + 4);
      ctx.closePath();
      ctx.fill();

      // pigment blooming out of each botanical, not a uniform wash
      if (tint > 0.01) {
        ctx.globalCompositeOperation = "source-over";
        for (var d = 0; d < PIECES.length; d += 2) {
          var pc = PIECES[d];
          var cx = toX(pc.rx);
          var cy = toY(0.10 + pc.ry * 0.88);
          if (cy < surfaceY) continue;
          var rad = GW * (0.10 + 0.42 * tint) * (0.6 + pc.size * 6);
          var g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
          g2.addColorStop(
            0,
            "rgba(" + liquid[0] + "," + liquid[1] + "," + liquid[2] + "," + 0.30 * tint + ")"
          );
          g2.addColorStop(1, "rgba(" + liquid[0] + "," + liquid[1] + "," + liquid[2] + ",0)");
          ctx.fillStyle = g2;
          ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        }
      }
    }

    // ------------------------------------------------------------------
    // Ice
    // ------------------------------------------------------------------
    if (iceIn > 0.001) {
      ICE.forEach(function (c) {
        var k = easeOut(clamp((iceIn - c.delay) / 0.55, 0, 1));
        if (k <= 0) return;
        var size = GW * c.s;
        var fromY = GY - GH * 0.18;
        var toYy = toY(c.y);
        var y = fromY + (toYy - fromY) * k + Math.sin(t * 1.1 + c.x * 9) * size * 0.05;
        var x = toX(c.x);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(c.rot * k);
        ctx.globalAlpha = 0.30 + 0.30 * k;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = Math.max(1, size * 0.05);
        var r2 = size * 0.16;
        ctx.beginPath();
        ctx.moveTo(-size / 2 + r2, -size / 2);
        ctx.arcTo(size / 2, -size / 2, size / 2, size / 2, r2);
        ctx.arcTo(size / 2, size / 2, -size / 2, size / 2, r2);
        ctx.arcTo(-size / 2, size / 2, -size / 2, -size / 2, r2);
        ctx.arcTo(-size / 2, -size / 2, size / 2, -size / 2, r2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.5 * k;
        ctx.beginPath();
        ctx.moveTo(-size * 0.22, -size * 0.3);
        ctx.lineTo(size * 0.1, size * 0.16);
        ctx.stroke();
        ctx.restore();
      });
      ctx.globalAlpha = 1;
    }

    // ------------------------------------------------------------------
    // Botanicals: above the rim before they fall, inside it afterwards
    // ------------------------------------------------------------------
    // Unclip: before they fall the botanicals hang ABOVE the rim, so they
    // must be able to draw outside the vessel. The x-bounds guard below
    // keeps them from spilling through the walls once they have landed.
    ctx.restore();

    ctx.save();
    PIECES.forEach(function (pc, i) {
      var k = easeInOut(clamp((fall - pc.delay * 0.5) / 0.5, 0, 1));
      var nx = pc.sx + (pc.rx - pc.sx) * k + pc.drift * Math.sin(k * 3.1) * (1 - k);
      var ny = pc.sy + (0.10 + pc.ry * 0.88 - pc.sy) * k;

      // settle: bob slowly once suspended in liquid
      if (k > 0.98 && level > 0.05) {
        ny += Math.sin(t * 0.7 + pc.bob) * 0.006;
        nx += Math.cos(t * 0.5 + pc.bob) * 0.004;
      }
      var x = toX(nx);
      var y = toY(ny);

      // hide anything that would draw outside the glass after it has landed
      if (k > 0.05 && (x < GX - 6 || x > GX + GW + 6)) return;

      var s = GW * pc.size;
      var alpha = k < 0.02 ? 0.9 : 0.9 - 0.28 * tint; // pigment leaches out
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pc.rot + pc.spin * k + (k > 0.98 ? Math.sin(t * 0.4 + i) * 0.08 : 0));
      ctx.globalAlpha = alpha;
      var col =
        pc.kind === "petal"
          ? "rgba(" + liquid[0] + "," + liquid[1] + "," + liquid[2] + ",0.92)"
          : pc.kind === "leaf"
          ? "rgba(122,158,116,0.88)"
          : "rgba(186,178,116,0.85)";
      drawPiece(ctx, pc.kind, s, col);
      ctx.restore();
    });
    ctx.restore();

    // ------------------------------------------------------------------
    // Glass itself, drawn over the contents
    // ------------------------------------------------------------------
    ctx.save();
    ctx.lineJoin = "round";
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1.1, GW * 0.006);
    glassPath(ctx, GX, GY, GW, GH);
    ctx.stroke();

    // inner highlight down the left wall
    var hg = ctx.createLinearGradient(GX, 0, GX + GW, 0);
    hg.addColorStop(0, "rgba(255,255,255,0.16)");
    hg.addColorStop(0.16, "rgba(255,255,255,0.02)");
    hg.addColorStop(0.84, "rgba(255,255,255,0.02)");
    hg.addColorStop(1, "rgba(255,255,255,0.10)");
    ctx.save();
    glassPath(ctx, GX, GY, GW, GH);
    ctx.clip();
    ctx.fillStyle = hg;
    ctx.fillRect(GX, GY, GW, GH);
    ctx.restore();

    // rim ellipse
    ctx.beginPath();
    ctx.ellipse(GX + GW / 2, GY, GW * 0.445, GW * 0.075, 0, 0, Math.PI * 2);
    ctx.stroke();

    // condensation on the outside
    if (dew > 0.001) {
      DROPS.forEach(function (dp) {
        var k = clamp((dew - dp.delay * 0.6) / 0.4, 0, 1);
        if (k <= 0) return;
        var x = GX + dp.x * GW;
        var y = GY + dp.y * GH;
        ctx.globalAlpha = 0.42 * k;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(x, y, GW * dp.s * (0.5 + k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // A puddle of reflected colour under the glass once there is liquid.
    if (level > 0.05) {
      var ry = GY + GH;
      var rrx = GW * 0.72;
      var rry = GH * 0.055;
      var rg = ctx.createRadialGradient(
        GX + GW / 2, ry, 0, GX + GW / 2, ry, rrx
      );
      rg.addColorStop(
        0,
        "rgba(" + liquid[0] + "," + liquid[1] + "," + liquid[2] + "," +
          0.20 * (0.3 + tint) + ")"
      );
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.translate(GX + GW / 2, ry);
      ctx.scale(1, rry / rrx);
      ctx.translate(-(GX + GW / 2), -ry);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(GX + GW / 2, ry, rrx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  HOC.drawGlassScene = drawGlassScene;
})(window, document);
