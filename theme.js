// Glass Flood theme script. Runs only when the song or the page changes; nothing
// here runs per frame or on a timer once Spotify has started.
(async function flood() {
  // Installed both locally and through Marketplace: run once.
  if (window.__flood) return;
  window.__flood = true;

  // Startup only: Spicetify's objects appear a moment after this script loads.
  while (!window.Spicetify?.Player?.addEventListener || !Spicetify.GraphQL?.Definitions || !document.querySelector("#main-view")) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const root = document.documentElement;

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
  }

  function paintCover(uri) {
    if (pending) pending.onload = pending.onerror = null;
    pending = null;
    const url = coverUrl(uri);
    if (!url) return showLayer(-1); // no cover: plain dark backdrop
    const img = new Image();
    pending = img;
    img.onload = () => {
      pending = null;
      const next = front === 0 ? 1 : 0; // the hidden layer
      const ctx = layers[next].getContext("2d");
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.filter = "blur(11px) saturate(1.7)";
      // Drawn larger than the canvas so the blur never reaches a clear edge.
      ctx.drawImage(img, -SIZE * 0.25, -SIZE * 0.25, SIZE * 1.5, SIZE * 1.5);
      showLayer(next);
    };
    img.onerror = () => {
      pending = null;
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
    root.style.setProperty("--flood-bar", css(mix(pageColour || songDark, INK, 0.5)));
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

  Spicetify.Player.addEventListener("songchange", onSong);
  onSong();
})();
