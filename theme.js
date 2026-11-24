// Glass Flood theme script. Runs only when the song or the page changes; nothing
// here runs per frame or on a timer once Spotify has started. The one exception
// is the Animated backdrop, which is off unless chosen in the theme's menu.
(async function flood() {
  // Installed both locally and through Marketplace: run once.
  if (window.__flood) return;
  window.__flood = true;

  // Startup only: Spicetify's objects appear a moment after this script loads.
  while (!window.Spicetify?.Player?.addEventListener || !Spicetify.GraphQL?.Definitions || !document.querySelector("#main-view")) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const root = document.documentElement;

  // ---- Options: chosen in the menu, kept in this browser profile -----------
  const CHOICES = {
    page: ["flood", "top", "off"],
    motion: ["still", "drift", "float", "live"],
    glass: ["clear", "liquid"],
  };
  // Sliders: [lowest, highest].
  const RANGES = { tint: [0, 80], speed: [25, 200], blur: [0, 100], bright: [0, 100] };
  const DEFAULTS = { page: "flood", motion: "still", glass: "clear", tint: 38, speed: 100, blur: 50, bright: 50 };
  const STORE = "glass-flood:options";
  const opts = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
    for (const key in CHOICES) if (CHOICES[key].includes(saved[key])) opts[key] = saved[key];
    for (const key in RANGES) {
      if (Number.isFinite(saved[key])) opts[key] = Math.min(RANGES[key][1], Math.max(RANGES[key][0], Math.round(saved[key])));
    }
  } catch (err) {
    console.warn("[flood] saved options unreadable, using defaults", err);
  }
  function applyOptions() {
    root.dataset.floodPage = opts.page;
    root.dataset.floodMotion = opts.motion;
    root.dataset.floodGlass = opts.glass;
    root.style.setProperty("--flood-tint", String(opts.tint / 100));
    root.style.setProperty("--flood-speed", String(opts.speed / 100));
    // Brightness is the strength of the dark veil over the backdrop.
    root.style.setProperty("--flood-dim", String(Math.min(1, ((100 - opts.bright) / 100) * 1.1)));
  }
  // The one way options change, from the menu or a preset.
  function update(patch) {
    Object.assign(opts, patch);
    applyOptions();
    try {
      localStorage.setItem(STORE, JSON.stringify(opts));
    } catch (err) {
      console.warn("[flood] options not saved", err);
    }
    if ("blur" in patch) repaint();
    setBar();
    live.sync();
  }

  // ---- Backdrop: the cover, blurred once into a 96px canvas -----------------
  const SIZE = 96;
  const bg = document.createElement("div");
  bg.id = "flood-bg";
  const layers = [0, 1].map(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    bg.appendChild(canvas);
    return canvas;
  });
  document.body.prepend(bg);
  let front = 0;
  let pending = null;

  // Spotify gives covers as spotify:image:<id>; ads and some podcasts give a URL.
  // Local files have no fetchable cover.
  function coverUrl(uri) {
    if (!uri) return null;
    if (/^https:\/\//.test(uri)) return uri;
    const m = /^spotify:image:([0-9a-f]+)$/i.exec(uri);
    return m ? "https://i.scdn.co/image/" + m[1] : null;
  }

  function showLayer(next) {
    layers.forEach((layer, i) => layer.classList.toggle("flood-show", i === next));
    front = next;
    live.setCover(next < 0 ? null : layers[next]);
  }

  // ---- Animated backdrop (opt-in): the same blurred cover, slowly swirled ---
  // One small WebGL canvas (320x200, stretched by CSS) and one cheap shader.
  // It draws at most 30 times a second, and only while music plays and the
  // window is visible; paused, hidden or reduced-motion it holds a still frame.
  const live = (() => {
    const FADE = 900;
    const FRAME = 1000 / 30;
    const calm = matchMedia("(prefers-reduced-motion: reduce)");
    let canvas = null;
    let gl = null;
    let uni = null;
    let source = null; // the 2D canvas now showing, or null for no cover
    let blend = 1;
    let clock = 0;
    let lastDraw = 0;
    let raf = 0;

    const VERT = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
    // The cover is pushed around by two layers of slow noise, the second fed
    // by the first, which is what makes it flow like liquid instead of sliding.
    const FRAG = `precision highp float;
      uniform sampler2D a; uniform sampler2D b; uniform float blend; uniform float t;
      varying vec2 uv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y) * 2.0 - 1.0;
      }
      void main() {
        float s = t * 0.09;
        vec2 big = vec2(noise(uv * 1.4 + vec2(s, s * 0.7)), noise(uv * 1.4 + vec2(-s * 0.8, s * 0.5) + 50.0));
        vec2 fine = vec2(noise(uv * 3.1 + big * 1.5 + vec2(s * 1.2, -s) + 100.0),
                         noise(uv * 3.1 + big * 1.5 + vec2(-s, s * 1.1) + 17.0));
        // Strongest in the middle, calmer at the edges so they never tear.
        float hold = 0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.75, length(uv - 0.5)));
        vec2 q = clamp(uv + (big * 0.65 + fine * 0.35) * 0.42 * hold, 0.0, 1.0);
        vec3 c = mix(texture2D(a, q), texture2D(b, q), blend).rgb;
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.25);
        gl_FragColor = vec4(c, 1.0);
      }`;

    function texture(unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      for (const [k, v] of [["WRAP_S", "CLAMP_TO_EDGE"], ["WRAP_T", "CLAMP_TO_EDGE"], ["MIN_FILTER", "LINEAR"], ["MAG_FILTER", "LINEAR"]]) {
        gl.texParameteri(gl.TEXTURE_2D, gl["TEXTURE_" + k], gl[v]);
      }
    }
    function upload(unit, from) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (from) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, from);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([11, 11, 16, 255]));
    }
    function build() {
      gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
      if (!gl) throw new Error("WebGL is not available");
      const program = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const at = gl.getAttribLocation(program, "p");
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      texture(0);
      texture(1);
      gl.uniform1i(gl.getUniformLocation(program, "a"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "b"), 1);
      uni = { blend: gl.getUniformLocation(program, "blend"), t: gl.getUniformLocation(program, "t") };
      upload(0, source);
      upload(1, source);
      blend = 1;
    }
    function draw() {
      gl.uniform1f(uni.blend, 0.5 - 0.5 * Math.cos(blend * Math.PI));
      gl.uniform1f(uni.t, clock);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // Player.data is empty for a moment at launch, and isPlaying() throws then.
    const moving = () => Spicetify.Player.data?.isPaused === false && !calm.matches;
    function frame(now) {
      raf = 0;
      if (!gl || opts.motion !== "live") return;
      const dt = now - lastDraw;
      if (dt >= FRAME - 2) {
        const step = Math.min(dt, 100);
        lastDraw = now;
        if (moving()) clock += (step / 1000) * (opts.speed / 100);
        if (blend < 1) blend = Math.min(1, blend + step / FADE);
        draw();
      }
      wake();
    }
    // Keeps the loop alive only while there is something to animate.
    function wake() {
      if (!raf && gl && opts.motion === "live" && (blend < 1 || moving())) raf = requestAnimationFrame(frame);
    }
    function sync() {
      if (opts.motion !== "live") return;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "flood-gl";
        canvas.width = 320;
        canvas.height = 200;
        canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          gl = null;
        });
        canvas.addEventListener("webglcontextrestored", () => {
          build();
          draw();
          wake();
        });
        try {
          build();
        } catch (err) {
          console.warn("[flood] animated backdrop unavailable", err);
          canvas = gl = null;
          return update({ motion: "still" });
        }
        bg.appendChild(canvas);
      }
      lastDraw = performance.now();
      draw();
      wake();
    }
    // The two backdrop layers take turns, so the outgoing cover is still
    // intact in its own canvas when the new one arrives.
    function setCover(next) {
      const previous = source;
      source = next;
      if (!gl) return;
      upload(0, previous);
      upload(1, next);
      blend = 0;
      lastDraw = performance.now();
      wake();
    }
    // The cover was redrawn in place (blur changed): take it again.
    function refresh() {
      if (!gl) return;
      upload(1, source);
      if (opts.motion === "live") draw();
    }
    calm.addEventListener("change", wake);
    return { sync, setCover, refresh, wake };
  })();

  let current = null; // the cover image now on screen
  function drawCover(img, layer) {
    const ctx = layers[layer].getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    // The Blur slider's 0-100 maps to 3-19px on this 96px canvas.
    ctx.filter = "blur(" + (3 + opts.blur * 0.16).toFixed(1) + "px) saturate(1.7)";
    // Drawn larger than the canvas so the blur never reaches a clear edge.
    ctx.drawImage(img, -SIZE * 0.25, -SIZE * 0.25, SIZE * 1.5, SIZE * 1.5);
  }
  // Blur changed: redraw the cover that is showing, in place.
  function repaint() {
    if (!current || front < 0) return;
    drawCover(current, front);
    live.refresh();
  }
  function paintCover(uri) {
    if (pending) pending.onload = pending.onerror = null;
    pending = null;
    const url = coverUrl(uri);
    if (!url) {
      current = null;
      return showLayer(-1); // no cover: plain dark backdrop
    }
    const img = new Image();
    // Spotify's image host allows this, and without it WebGL refuses the canvas.
    img.crossOrigin = "anonymous";
    pending = img;
    img.onload = () => {
      pending = null;
      const next = front === 0 ? 1 : 0; // the hidden layer
      drawCover(img, next);
      current = img;
      showLayer(next);
    };
    img.onerror = () => {
      pending = null;
      current = null;
      showLayer(-1);
    };
    img.src = url;
  }

  // ---- Colours ------------------------------------------------------------
  const rgb = (c) => [c.red, c.green, c.blue];
  const css = (v) => "rgb(" + v.map(Math.round).join(",") + ")";
  const mix = (a, b, t) => a.map((x, i) => x * (1 - t) + b[i] * t);
  const INK = [16, 16, 21];
  let songDark = INK;
  let pageColour = null;

  function setBar() {
    // Only the full flood colours the page all the way down to the stuck bars.
    const page = opts.page === "flood" ? pageColour : null;
    root.style.setProperty("--flood-bar", css(mix(page || songDark, INK, 0.5)));
  }

  function setAccent(accent) {
    for (const name of ["button", "button-active"]) {
      if (accent) {
        root.style.setProperty("--spice-" + name, css(accent));
        root.style.setProperty("--spice-rgb-" + name, accent.join(","));
      } else {
        // Back to the colour scheme's own accent.
        root.style.removeProperty("--spice-" + name);
        root.style.removeProperty("--spice-rgb-" + name);
      }
    }
  }

  async function onSong() {
    const item = Spicetify.Player.data?.item;
    const meta = item?.metadata || {};
    const cover = meta.image_url;
    paintCover(meta.image_small_url || cover);
    let accent = null;
    songDark = INK;
    if (coverUrl(cover)) {
      try {
        const res = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getDynamicColorsByUris, { imageUris: [cover] });
        if (Spicetify.Player.data?.item?.uri !== item.uri) return; // skipped ahead meanwhile
        const dark = res?.data?.dynamicColors?.[0]?.dark;
        if (dark) {
          accent = rgb(dark.encoreBaseSetTextColor);
          songDark = rgb(dark.higherContrast.backgroundBase);
        }
      } catch (err) {
        console.warn("[flood] no colours for this cover", err);
      }
    }
    setAccent(accent);
    setBar();
  }

  // ---- Page colour: Spotify writes it on the top bar's background ---------
  const mainView = document.querySelector("#main-view");
  // Accepts #rgb, #rrggbb, #rrggbbaa and rgb()/rgba(). See-through
  // values are Spotify's scrim, not a page colour, so they are ignored.
  function parse(value) {
    const v = (value || "").trim();
    let c = null;
    let m = /^#([0-9a-f]{3,8})$/i.exec(v);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      c = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
      c[3] /= 255;
    } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(v))) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      c = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    if (!c || c.slice(0, 3).some(isNaN) || c[3] < 0.9) return null;
    return c.slice(0, 3);
  }
  function readPage() {
    const el = mainView.querySelector(".main-topBar-background");
    const next = el ? parse(el.style.getPropertyValue("--background-base")) : null;
    if (String(next) === String(pageColour)) return;
    pageColour = next;
    if (next) root.style.setProperty("--flood-page", css(next));
    else root.style.removeProperty("--flood-page");
    setBar();
  }
  // The top bar is a small subtree, so watching it costs nothing while lists scroll.
  const barWatch = new MutationObserver(readPage);
  let watched = null;
  function attach() {
    const bar = mainView.querySelector(":scope > .main-topBar-container");
    if (bar !== watched) {
      barWatch.disconnect();
      watched = bar;
      if (bar) barWatch.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    }
    readPage();
  }
  new MutationObserver(attach).observe(mainView, { childList: true });
  attach();

  // Which kind of page is open, for the CSS that tidies the top of the page.
  const history = Spicetify.Platform?.History;
  const setRoute = (location) => (root.dataset.floodRoute = location.pathname.split("/")[1] || "home");
  if (history) {
    history.listen(setRoute);
    setRoute(history.location);
  }
  // Backdrop motion only runs while music plays.
  function onPlayPause() {
    root.toggleAttribute("data-flood-playing", Spicetify.Player.data?.isPaused === false);
    live.wake();
  }

  applyOptions();
  live.sync();
  buildMenu();
  Spicetify.Player.addEventListener("onplaypause", onPlayPause);
  Spicetify.Player.addEventListener("songchange", onSong);
  // Startup only: a paused Spotify restores its last song a moment after launch
  // and sends no songchange for it.
  while (!Spicetify.Player.data?.item) await new Promise((resolve) => setTimeout(resolve, 250));
  onPlayPause();
  onSong();

  // ---- Menu: a small glass popover under a top-bar button -------------------
  async function buildMenu() {
    const el = (tag, props, kids) => {
      const node = Object.assign(document.createElement(tag), props || {});
      for (const kid of kids || []) node.append(kid);
      return node;
    };
    const PRESETS = [
      ["Classic", DEFAULTS],
      ["Cinematic", { page: "top", motion: "live", glass: "liquid", tint: 28, speed: 80, blur: 45, bright: 60 }],
      ["Calm", { page: "off", motion: "drift", glass: "clear", tint: 46, speed: 60, blur: 70, bright: 42 }],
      ["Glassy", { page: "off", motion: "float", glass: "liquid", tint: 16, speed: 100, blur: 50, bright: 58 }],
    ];
    const SEGMENTS = [
      ["page", "Page colour", [["flood", "Flood"], ["top", "Top fade"], ["off", "Off"]]],
      ["motion", "Backdrop", [["still", "Still"], ["drift", "Drift"], ["float", "Float"], ["live", "Flow"]]],
      ["glass", "Glass", [["clear", "Clear"], ["liquid", "Liquid"]]],
    ];
    const SLIDERS = [
      ["tint", "Tint", (v) => v + "%"],
      ["speed", "Speed", (v) => (v / 100).toFixed(1) + "\u00d7"],
      ["blur", "Blur", String],
      ["bright", "Brightness", String],
    ];
    const menu = el("div", { id: "flood-menu", hidden: true });
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Glass Flood options");
    menu.append(el("div", { className: "flood-menu-title", textContent: "Glass Flood" }));
    const syncs = []; // each control registers how to show the current options
    const render = () => syncs.forEach((sync) => sync());
    const segment = (label, choices, isOn, pick) => {
      const group = el("div", { className: "flood-seg" });
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", label);
      for (const [value, text] of choices) {
        const button = el("button", { type: "button", textContent: text });
        button.addEventListener("click", () => {
          pick(value);
          render();
        });
        syncs.push(() => button.setAttribute("aria-pressed", String(isOn(value))));
        group.append(button);
      }
      return group;
    };
    menu.append(
      segment(
        "Presets",
        PRESETS.map(([name, values]) => [values, name]),
        (values) => Object.keys(values).every((key) => opts[key] === values[key]),
        (values) => update({ ...values })
      )
    );
    for (const [key, label, choices] of SEGMENTS) {
      const group = segment(label, choices, (value) => opts[key] === value, (value) => update({ [key]: value }));
      menu.append(el("div", { className: "flood-menu-row" }, [el("span", { textContent: label }), group]));
    }
    for (const [key, label, show] of SLIDERS) {
      const value = el("output");
      const slider = el("input", { type: "range", min: String(RANGES[key][0]), max: String(RANGES[key][1]), step: "1" });
      slider.setAttribute("aria-label", label);
      slider.addEventListener("input", () => {
        update({ [key]: Number(slider.value) });
        render();
      });
      syncs.push(() => {
        slider.value = String(opts[key]);
        value.textContent = show(opts[key]);
      });
      menu.append(el("div", { className: "flood-menu-row" }, [el("span", { textContent: label }), el("div", { className: "flood-tint" }, [slider, value])]));
    }
    render();
    document.body.append(menu);

    // Startup only, and separate from the backdrop so a Spotify build without
    // this top-bar API still gets the theme.
    while (!Spicetify.Topbar?.Button) await new Promise((resolve) => setTimeout(resolve, 250));
    const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 .9l.55.6C11.7 5 13.25 7.6 13.25 9.75a5.25 5.25 0 0 1-10.5 0C2.75 7.6 4.3 5 7.45 1.5L8 .9zm0 2.25C5.5 6.05 4.25 8.2 4.25 9.75a3.75 3.75 0 0 0 7.5 0C11.75 8.2 10.5 6.05 8 3.15z"/></svg>';
    const opener = new Spicetify.Topbar.Button("Glass Flood", ICON, toggleMenu, false, true);
    function closeOnOutside(e) {
      if (e.type === "keydown" ? e.key === "Escape" : !menu.contains(e.target) && !opener.element.contains(e.target)) toggleMenu();
    }
    function toggleMenu() {
      const open = menu.hidden;
      if (open) {
        const at = opener.element.getBoundingClientRect();
        menu.style.top = Math.round(at.bottom + 8) + "px";
        menu.style.right = Math.max(8, Math.round(innerWidth - at.right)) + "px";
      }
      const hadFocus = menu.contains(document.activeElement); // hiding drops focus
    menu.hidden = !open;
      // These listeners exist only while the menu is open.
      const listen = open ? "addEventListener" : "removeEventListener";
      for (const type of ["pointerdown", "keydown"]) document[listen](type, closeOnOutside, true);
      window[listen]("resize", toggleMenu);
      if (open) menu.querySelector("button").focus();
      else if (hadFocus) (opener.element.matches("button") ? opener.element : opener.element.querySelector("button"))?.focus(); // element may be a wrapper
    }
  }
})();
