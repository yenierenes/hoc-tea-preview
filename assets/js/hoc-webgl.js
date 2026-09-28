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
      /** The device-pixel ratio the last resize() settled on. */
      get dpr() {
        return dpr;
      },

      set: function (name, v) {
        var u = uniforms[name];
        if (!u) return api;
        var t = u.type;
        // Uniform arrays (uniform vec4 uDrop[6]) take the whole flat array.
        if (u.size > 1) {
          if (t === gl.FLOAT) gl.uniform1fv(u.loc, v);
          else if (t === gl.FLOAT_VEC2) gl.uniform2fv(u.loc, v);
          else if (t === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, v);
          else if (t === gl.FLOAT_VEC4) gl.uniform4fv(u.loc, v);
          return api;
        }
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
      texture: function (name, source, opts) {
        opts = opts || {};
        var slot = textures[name];
        if (!slot) {
          slot = textures[name] = { unit: texUnit++, tex: gl.createTexture() };
        }
        gl.activeTexture(gl.TEXTURE0 + slot.unit);
        gl.bindTexture(gl.TEXTURE_2D, slot.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        // Cut-outs with soft alpha edges want premultiplied texels, or linear
        // filtering drags whatever colour sits under alpha 0 into the edge.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!opts.premultiply);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          return false;
        }
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        // WebGL1 can only mipmap power-of-two images. Art drawn much smaller
        // than its source (the hibiscus pieces) shimmers without it.
        var w = source.naturalWidth || source.videoWidth || source.width;
        var h = source.naturalHeight || source.videoHeight || source.height;
        var pot = w > 0 && h > 0 && (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
        if (opts.mipmap && pot) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
     4. COLOR ALCHEMY SHADER  §14 — rebuilt

     The first version drove the colour from two invisible things at once —
     scroll progress and how far the pointer had travelled — and never showed
     what actually causes the change. People could not tell what they were
     doing, so they could not tell what they were seeing.

     This one renders the real mechanism. Butterfly pea steeps blue; its
     pigment reads acidity as colour; hibiscus is naturally acidic. So:

       * the glass holds blue tea, with dried butterfly-pea flowers resting on
         the bottom — you can see where the blue comes from
       * each hibiscus piece (uDrop) falls in, rings the surface, and sinks,
         bleeding a plume of pigment behind it through a shared flow field so
         the ribbons curl together like ink in water
       * the whole glass follows more slowly (uLevel), the way a steeping
         glass actually evens out

     Coordinates are glass-local: y runs -1..1 over the glass's box, whose
     place on the canvas comes from a DOM element (uVessel), so CSS owns the
     layout and this shader only ever draws.
     ====================================================================== */

  HOC.shaderAlchemy = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "varying vec2 vUv;",
    "uniform vec2 uRes;",
    "uniform vec4 uVessel;",   // centre x, centre y, half-width, half-height (canvas px)
    "uniform float uTime;",
    "uniform float uLevel;",   // 0..1 how far the whole glass has turned
    "uniform float uFill;",    // 0..1 liquid height (drains and refills on reset)
    "uniform float uFade;",    // 0..1 clears pieces and plumes during a reset
    "uniform vec4 uDrop[4];",  // x, time dropped, strength, seed   (strength 0: empty)
    "uniform vec2 uGhost;",    // x, alpha of the pointer preview above the rim
    "uniform sampler2D uSprites;", // [ hibiscus | butterfly pea ], premultiplied
    "uniform vec3 uBg;",
    NOISE,
    "float fbm4(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=ROT*p*2.03;a*=0.5;}return v/0.9375;}",

    // --- the glass, in glass-local units ---------------------------------
    "const float E=0.15;",        // how far above the glass we sit: ellipse ratio
    "const float W_TOP=0.455;",
    "const float W_BOT=0.395;",
    "const float WALL=0.018;",
    "const float FOOT=0.080;",
    "const float Y_TOP=1.0-E*W_TOP;",
    "const float Y_BOT=-1.0+E*W_BOT;",
    "const float Y_INB=Y_BOT+FOOT;",
    "const float Y_FULL=Y_TOP-0.22;",
    "const float T_FALL=0.62;",

    "float halfW(float y){return mix(W_BOT,W_TOP,clamp((y-Y_BOT)/(Y_TOP-Y_BOT),0.0,1.0));}",
    "float arc(float x,float w){float k=x/w;return E*w*sqrt(max(0.0,1.0-k*k));}",
    "float ellDist(vec2 q,vec2 ab){float k0=length(q/ab);float k1=length(q/(ab*ab));return k0*(k0-1.0)/max(k1,1e-5);}",

    // Butterfly pea's anthocyanins: blue near neutral, violet, then magenta.
    // Violet sits at exactly half way and magenta at full, so the scale
    // beside the glass can be read straight off uLevel.
    // Deep rather than bright: pigment in a dark room, not neon (§59).
    "vec3 pigment(float a){",
    "  vec3 c=mix(vec3(0.085,0.175,0.560),vec3(0.360,0.150,0.585),smoothstep(0.0,0.5,a));",
    "  return mix(c,vec3(0.660,0.110,0.360),smoothstep(0.5,1.0,a));",
    "}",

    // One cell of the sprite strip, premultiplied, centred on c, rotated by r.
    // No early return: sampling stays in uniform control flow so the mip
    // level is always well defined.
    "vec4 sprite(vec2 p,vec2 c,float s,float r,float cell){",
    "  vec2 d=(p-c)/s;",
    "  float cs=cos(r),sn=sin(r);",
    "  d=vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y);",
    "  float inb=step(abs(d.x),1.0)*step(abs(d.y),1.0);",
    "  vec2 uv=clamp(d*0.5+0.5,0.0,1.0);",
    "  uv.x=(uv.x*0.98+0.01+cell)*0.5;",
    "  return texture2D(uSprites,uv)*inb;",
    "}",

    "void main(){",
    "  vec2 frag=gl_FragCoord.xy;",
    "  vec2 p=(frag-uVessel.xy)/uVessel.w;",
    "  float px=1.0/uVessel.w;",
    "  float t=uTime;",

    // --- the ground: a backlight behind the glass that carries the colour
    //     of whatever it shines through, and the table it stands on --------
    "  vec2 sv=vUv-0.5;",
    "  vec3 col=uBg*(1.0-0.35*dot(sv,sv));",
    "  vec3 tint=pigment(uLevel);",
    "  vec2 hq=vec2(p.x/1.05,(p.y-0.12)/1.45);",
    "  col+=(vec3(0.040,0.044,0.064)+tint*0.17*uFill)*exp(-dot(hq,hq)*1.7);",
    "  vec2 cq=vec2(p.x/(W_BOT*1.20),(p.y-Y_BOT+0.014)/(E*W_BOT*1.7));",
    "  col*=1.0-0.62*exp(-dot(cq,cq)*1.4);",
    "  vec2 bq=vec2(p.x/0.60,(p.y+1.07)/0.085);",
    "  col+=tint*0.22*exp(-dot(bq,bq))*uFill;",

    // Everything expensive lives near the glass. The box edge is far from any
    // sprite, so the branch never splits a quad that is sampling one.
    "  if(abs(p.x)<0.80&&p.y>-1.30&&p.y<Y_TOP+0.52){",

    // --- silhouettes ------------------------------------------------------
    "    float w=halfW(p.y);",
    "    float wi=w-WALL;",
    "    float dOut=max(abs(p.x)-w,max((Y_BOT-arc(p.x,W_BOT))-p.y,p.y-(Y_TOP+arc(p.x,W_TOP))));",
    "    float outer=smoothstep(px,-px,dOut);",
    "    float ibot=Y_INB-arc(p.x,W_BOT-WALL);",
    "    float dIn=max(abs(p.x)-wi,max(ibot-p.y,p.y-(Y_TOP+arc(p.x,W_TOP-WALL))));",
    "    float inner=smoothstep(px,-px,dIn);",

    // --- the liquid: a body seen through the wall, and a surface seen from
    //     slightly above ------------------------------------------------------
    "    float ySurf=mix(Y_INB+0.02,Y_FULL,uFill);",
    "    float ws=halfW(ySurf)-WALL;",
    "    float wave=(0.0035*sin(p.x*21.0+t*1.25)+0.0022*sin(p.x*39.0-t*1.8))*uFill;",
    "    float front=ySurf-arc(p.x,ws)+wave;",
    "    float back=ySurf+arc(p.x,ws)+wave;",
    "    float live=step(0.03,uFill);",
    "    float body=inner*smoothstep(px,-px,p.y-front)*live;",
    "    float topS=inner*smoothstep(-px,px,p.y-front)*smoothstep(px,-px,p.y-back)*live;",

    // --- one flow field for every plume, so the ribbons curl together -----
    "    vec2 fq=p*vec2(2.3,1.5);",
    "    vec2 flow=vec2(fbm4(fq+vec2(0.0,t*0.10)),fbm4(fq+vec2(7.3,-t*0.08)))-0.5;",
    "    vec2 pw=p+flow*0.17;",

    "    float local=0.0;",
    "    float ripple=0.0;",
    "    vec4 sunk=vec4(0.0);",
    "    vec4 fallIn=vec4(0.0);",  // falling, already below the rim: behind its front edge
    "    vec4 fallOut=vec4(0.0);", // falling, still above the glass
    "    for(int i=0;i<4;i++){",
    "      vec4 d=uDrop[i];",
    "      float age=t-d.y;",
    "      if(d.z<=0.0||age<0.0)continue;",
    "      float seed=d.w;",
    "      float yStart=Y_TOP+0.34;",
    "      float ft=min(age,T_FALL)/T_FALL;",
    "      float sinkT=max(age-T_FALL,0.0);",
    "      float depth=max(ySurf-Y_INB-0.12,0.0)*(1.0-exp(-sinkT/1.9));",
    "      float sway=0.028*sin(sinkT*1.6+seed*6.2832)*(1.0-exp(-sinkT*0.9));",
    "      float inAir=step(age,T_FALL);",
    "      vec2 P=vec2(d.x+sway,mix(ySurf-depth,yStart+(ySurf-yStart)*ft*ft,inAir));",

    // the piece itself: tumbling in the air, rocking once it is in
    "      float spin=seed*6.2832+age*1.6*inAir+(T_FALL*1.6+0.35*sin(sinkT*1.1+seed*4.0))*(1.0-inAir);",
    "      float size=0.090*(0.88+0.24*fract(seed*13.7));",
    "      vec4 s=sprite(p,P,size,spin,0.0);",
    "      s.rgb*=mix(1.0,0.58,1.0-exp(-sinkT/2.6));", // gives its colour up
    "      s*=1.0-uFade;",
    "      float below=step(P.y,Y_TOP-0.01);",
    "      vec4 si=s*inAir*below;",
    "      fallIn=si+fallIn*(1.0-si.a);",
    "      vec4 so=s*inAir*(1.0-below);",
    "      fallOut=so+fallOut*(1.0-so.a);",
    "      vec4 sb=s*(1.0-inAir);",
    "      sunk=sb+sunk*(1.0-sb.a);",

    // the plume: a trail from where it went in to where it is now, released
    // earliest (and so spread widest) near the surface
    "      if(sinkT>0.0){",
    "        vec2 En=vec2(d.x,ySurf-0.012);",
    "        vec2 ba=P-En;",
    "        vec2 pa=pw-En;",
    "        float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-4),0.0,1.0);",
    "        float dist=length(pa-ba*h);",
    "        float rel=sinkT*(1.0-h);",
    "        float r=0.016+0.080*sqrt(rel)+0.015*sinkT;",
    "        float strength=d.z*(1.0-exp(-sinkT/0.75));",
    "        float trail=smoothstep(r,r*0.18,dist)*exp(-rel*0.10);",
    "        float head=smoothstep(0.070+0.035*sqrt(sinkT),0.0,length(pw-P));",
    "        float pool=smoothstep(Y_INB+0.30,Y_INB+0.02,pw.y)*smoothstep(0.50,0.0,abs(pw.x-P.x))*(1.0-exp(-sinkT/3.2));",
    "        local+=strength*(0.85*trail+0.95*head+0.40*pool);",
    "        vec2 rq=vec2(p.x-d.x,(p.y-ySurf)/E);",
    "        ripple+=smoothstep(0.011,0.0,abs(length(rq)-sinkT*0.36))*exp(-sinkT*2.3);",
    "      }",
    "    }",
    "    local*=1.0-uFade;",

    // filaments: ridged noise in the same flowing frame, so the ribbons have
    // grain instead of reading as soft blobs
    "    float ridge=1.0-abs(fbm4(pw*6.2+vec2(t*0.05,-t*0.03))*2.0-1.0);",
    "    local=clamp(local,0.0,1.35)*(0.55+0.70*ridge);",
    "    float g=uLevel*(0.80+0.40*fbm4(pw*2.1+vec2(-t*0.02,t*0.015)));",
    "    float acid=clamp(g+local*(1.0-0.6*g),0.0,1.0);",

    // --- backlit liquid: a luminous core, dark toward the walls, a little
    //     brighter under the surface, a slow caustic shimmer ----------------
    "    vec3 pig=pigment(acid);",
    "    float xn=clamp(p.x/max(wi,0.01),-1.0,1.0);",
    "    float core=smoothstep(0.0,1.0,sqrt(max(0.0,1.0-xn*xn)));",
    "    float vert=mix(0.72,1.10,smoothstep(Y_INB,ySurf,p.y));",
    "    vec3 liq=pig*(0.22+0.74*core)*vert;",
    "    liq+=pig*pig*0.30*core*core;",
    "    float ca=fbm4(p*vec2(5.0,2.8)+vec2(t*0.11,-t*0.07));",
    "    liq+=pig*pow(ca,3.0)*0.60*core;",

    // the cavity: air above the liquid, liquid below
    "    vec3 air=col*0.90+vec3(0.010,0.012,0.018)+tint*0.035*uFill;",
    "    vec3 cav=mix(air,liq,body);",

    // butterfly-pea flowers resting on the bottom: this is where the blue
    // comes from, and they take the liquid's colour like everything in it
    "    vec4 fl=vec4(0.0);",
    "    for(int j=0;j<3;j++){",
    "      float fj=float(j);",
    "      vec2 c=vec2(-0.215+0.215*fj+0.03*sin(fj*2.3),Y_INB+0.035+0.030*fract(fj*0.618));",
    "      c.x+=0.006*sin(t*0.55+fj*2.0)*live;",
    "      float r=-0.75+fj*1.25+0.05*sin(t*0.45+fj)*live;",
    "      vec4 s=sprite(p,c,0.078+0.010*fj,r,1.0);",
    "      fl=s+fl*(1.0-s.a);",
    "    }",
    "    fl*=inner;",
    "    vec3 flc=mix(fl.rgb,pig*fl.a*0.55,0.42*body)*(0.80+0.30*core*body);",
    "    cav=flc+cav*(1.0-fl.a);",
    "    sunk*=inner;",
    "    vec3 skc=mix(sunk.rgb,pig*sunk.a*0.50,0.38)*(0.82+0.28*core);",
    "    cav=skc+cav*(1.0-sunk.a);",

    // the surface, seen from above, with the rings each piece leaves
    "    vec3 surf=pig*(0.80+0.30*core)+vec3(0.07,0.08,0.10);",
    "    surf=mix(surf,vec3(0.62,0.64,0.72),0.08+0.22*smoothstep(0.35,1.0,abs(p.x/max(ws,0.01))));",
    "    surf+=ripple*0.35;",
    "    cav=mix(cav,surf,topS);",
    "    cav+=smoothstep(2.5*px,0.0,abs(p.y-front))*inner*live*0.22;",

    // --- glass: the cavity through thin side walls, a heavy foot that holds
    //     some of the colour, then light on the edges ------------------------
    "    vec3 glassCol=mix(col,cav,inner);",
    "    float wallBand=clamp(outer-inner,0.0,1.0);",
    "    float foot=outer*smoothstep(-px,px,ibot-p.y);",
    "    vec3 footCol=col*0.55+tint*0.30*uFill+vec3(0.045,0.050,0.062);",
    // a side wall with liquid behind it carries the liquid's darkest edge
    "    float bodyH=smoothstep(px,-px,p.y-front)*live;",
    "    vec3 sideCol=mix(col*0.60+vec3(0.050,0.055,0.068),liq*0.85+vec3(0.030,0.034,0.046),bodyH);",
    "    glassCol=mix(glassCol,sideCol,clamp(wallBand-foot,0.0,1.0));",
    "    glassCol=mix(glassCol,footCol,foot);",
    "    col=mix(col,glassCol,outer);",

    // The far half of the rim sits behind a piece on its way in, the near
    // half and the front wall's light in front of it.
    "    float far=step(Y_TOP,p.y);",
    "    float edge=smoothstep(2.2*px,0.0,abs(dOut))*0.30;",
    "    float dr=ellDist(vec2(p.x,p.y-Y_TOP),vec2(W_TOP-WALL*0.5,E*(W_TOP-WALL*0.5)));",
    "    float rim=smoothstep(WALL*0.55,WALL*0.15,abs(dr));",
    "    col+=edge*far*vec3(0.90,0.93,1.0);",
    "    col=mix(col,vec3(0.80,0.84,0.90),rim*0.22*far);",
    "    col=fallIn.rgb+col*(1.0-fallIn.a);",

    "    float xo=p.x/max(w,0.01);",
    "    float vfade=smoothstep(Y_BOT+0.10,Y_BOT+0.45,p.y)*smoothstep(Y_TOP+0.04,Y_TOP-0.32,p.y);",
    "    float spec=smoothstep(0.080,0.0,abs(xo+0.64))*0.18+smoothstep(0.024,0.0,abs(xo-0.80))*0.13;",
    "    col+=spec*vfade*outer*vec3(0.95,0.97,1.0);",
    "    col+=edge*(1.0-far)*vec3(0.90,0.93,1.0);",
    "    col+=smoothstep(1.6*px,0.0,abs(dIn))*0.10;",
    // at most a pixel of chromatic separation on the outline — never a glitch
    "    col.r+=smoothstep(2.0*px,0.0,abs(dOut-1.5*px))*0.05;",
    "    col.b+=smoothstep(2.0*px,0.0,abs(dOut+1.5*px))*0.06;",
    "    col+=smoothstep(2.0*px,0.0,abs(p.y-ibot))*step(abs(p.x),W_BOT-WALL)*0.16;",
    "    col=mix(col,vec3(0.80,0.84,0.90),rim*0.52*(1.0-far));",

    // --- pieces still above the glass, then the preview under the pointer --
    "    col=fallOut.rgb+col*(1.0-fallOut.a);",
    "    if(uGhost.y>0.001){",
    "      vec2 gc=vec2(uGhost.x,Y_TOP+0.24+0.012*sin(t*2.3));",
    "      vec4 gs=sprite(p,gc,0.082,0.45+0.08*sin(t*1.4),0.0)*(0.62*uGhost.y);",
    "      col=gs.rgb+col*(1.0-gs.a);",
    "      float guide=smoothstep(1.5*px,0.0,abs(p.x-uGhost.x))*step(ySurf+0.02,p.y)*step(p.y,gc.y-0.10);",
    "      col+=guide*step(0.5,fract(p.y*28.0))*0.18*uGhost.y;",
    "    }",
    "  }",

    "  col+=(hash21(frag)-0.5)*0.016;",
    "  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);",
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
