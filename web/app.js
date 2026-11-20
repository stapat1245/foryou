(() => {
  "use strict";

  const FONT = 'Consolas, Menlo, "DejaVu Sans Mono", "Courier New", monospace';
  const BLACK = 0xff000000;

  const screen = document.getElementById("screen");
  const starCanvas = document.getElementById("stars");
  const starCtx = starCanvas.getContext("2d");
  const loader = document.getElementById("loader");
  const loaderTitle = document.getElementById("loader-title");
  const loaderDetail = document.getElementById("loader-detail");
  const bar = document.getElementById("bar");

  const out = screen.getContext("2d");

  let meta = null;
  let chars = null;
  let colours = null;
  let cells = 0;
  let frameIndex = 0;
  let paused = false;
  let running = false;
  let nextFrameAt = 0;
  let lastTick = 0;

  let atlas = null;
  let art = null;
  let tintStill = null;
  let tintMoving = null;
  let stillLayer = null;
  let movingLayer = null;
  let trail = null;
  let tight = null;
  let wide = null;
  let stillImage = null;
  let movingImage = null;
  let stillPixels = null;
  let movingPixels = null;

  const STAR_COLOURS = [
    [255, 255, 255],
    [255, 150, 190],
    [170, 205, 255],
    [255, 214, 150],
  ];
  let starField = [];
  let starWidth = 0;
  let starHeight = 0;
  let starPx = 11;

  const red = Array.from({ length: 32 }, (_, i) => Math.round((i * 255) / 31));
  const green = Array.from({ length: 64 }, (_, i) => Math.round((i * 255) / 63));
  const blue = Array.from({ length: 32 }, (_, i) => Math.round((i * 255) / 31));

  function layer(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext("2d") };
  }

  function setProgress(value) {
    bar.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  }

  async function download(url, onProgress) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      onProgress(1);
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) onProgress(received / total);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    onProgress(1);
    return bytes.buffer;
  }

  async function gunzip(buffer) {
    if (!("DecompressionStream" in window)) {
      throw new Error("this browser cannot unpack the animation data");
    }
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }


  function makeStar() {
    const u = Math.random();
    let colour = 0;
    if (u < 0.18) colour = 1;
    else if (u < 0.32) colour = 2;
    else if (u < 0.42) colour = 3;
    return {
      x: Math.random() * starWidth,
      y: Math.random() * starHeight,
      speed: 2 + Math.random() * 6,
      beat: 2.5 + Math.random() * 4.5,
      phase: Math.random(),
      fire: Math.random(),
      colour,
    };
  }

  function resizeStars(width, height, scale) {
    starWidth = width;
    starHeight = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    starCanvas.width = Math.max(1, Math.round(width * dpr));
    starCanvas.height = Math.max(1, Math.round(height * dpr));
    starCanvas.style.width = `${width}px`;
    starCanvas.style.height = `${height}px`;
    starCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    starPx = Math.max(6, 11 * scale);
    const count = Math.max(40, Math.round((width * height) / 3200));
    starField = Array.from({ length: count }, makeStar);
  }

  function drawStars(now) {
    if (!starField.length) return;
    starCtx.clearRect(0, 0, starWidth, starHeight);
    starCtx.textAlign = "center";
    starCtx.textBaseline = "middle";
    starCtx.font = `${starPx}px ${FONT}`;
    for (const star of starField) {
      const y = ((star.y - now * star.speed) % starHeight + starHeight) % starHeight;
      const cycle = (now / star.beat + star.phase) % 1;
      const peak = Math.max(0, 1 - (Math.abs(cycle - 0.5) * star.beat) / 0.24);
      const glow = 0.3 + 0.35 * star.fire + Math.pow(peak, 1.5);
      const alpha = Math.min(1, glow * 0.85);
      const colour = STAR_COLOURS[star.colour];
      starCtx.fillStyle = `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`;
      starCtx.fillText(glow > 0.95 ? "*" : glow > 0.55 ? "+" : ".", star.x, y);
    }
  }

  function buildAtlas() {
    const { cw, ch, fontPx } = meta;
    const canvas = document.createElement("canvas");
    canvas.width = 95 * cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${fontPx}px ${FONT}`;
    for (let i = 0; i < 95; i++) {
      const glyph = String.fromCharCode(32 + i);
      const metrics = ctx.measureText(glyph);
      const ascent = metrics.actualBoundingBoxAscent || 0;
      const descent = metrics.actualBoundingBoxDescent || 0;
      const width = metrics.width;
      const height = ascent + descent;
      const x = Math.round(i * cw + (cw - width) / 2);
      const y = Math.round((ch - height) / 2 + ascent);
      ctx.fillText(glyph, x, y);
    }
    return canvas;
  }

  function setupLayers() {
    const { width, height, cols, rows } = meta;
    art = layer(width, height);
    tintStill = layer(cols, rows);
    tintMoving = layer(cols, rows);
    stillLayer = layer(width, height);
    movingLayer = layer(width, height);
    trail = layer(width, height);
    tight = layer(Math.floor(width / 4), Math.floor(height / 4));
    wide = layer(Math.floor(width / 8), Math.floor(height / 8));
    stillImage = tintStill.ctx.createImageData(cols, rows);
    movingImage = tintMoving.ctx.createImageData(cols, rows);
    stillPixels = new Uint32Array(stillImage.data.buffer);
    movingPixels = new Uint32Array(movingImage.data.buffer);
    art.ctx.fillStyle = "#000";
    art.ctx.fillRect(0, 0, width, height);
    resetTrail();
  }

  function resetTrail() {
    const ctx = trail.ctx;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, meta.width, meta.height);
  }

  function compose(target, tintCanvas) {
    const ctx = target.ctx;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tintCanvas, 0, 0, meta.width, meta.height);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(art.canvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
  }

  function drawGlow() {
    const { width, height } = meta;
    const tightCtx = tight.ctx;
    const wideCtx = wide.ctx;
    tightCtx.globalCompositeOperation = "source-over";
    tightCtx.clearRect(0, 0, tight.canvas.width, tight.canvas.height);
    tightCtx.filter = "blur(2px)";
    tightCtx.imageSmoothingEnabled = true;
    tightCtx.drawImage(screen, 0, 0, tight.canvas.width, tight.canvas.height);
    tightCtx.filter = "none";

    wideCtx.globalCompositeOperation = "source-over";
    wideCtx.clearRect(0, 0, wide.canvas.width, wide.canvas.height);
    wideCtx.filter = "blur(3px)";
    wideCtx.imageSmoothingEnabled = true;
    wideCtx.drawImage(tight.canvas, 0, 0, wide.canvas.width, wide.canvas.height);
    wideCtx.filter = "none";

    out.globalCompositeOperation = "lighter";
    out.imageSmoothingEnabled = true;
    out.globalAlpha = 0.75;
    out.drawImage(tight.canvas, 0, 0, width, height);
    out.globalAlpha = 0.45;
    out.drawImage(wide.canvas, 0, 0, width, height);
    out.globalAlpha = 1;
    out.globalCompositeOperation = "source-over";
  }

  function renderFrame(index) {
    drawStars(performance.now() / 1000);
    const { cols, rows, cw, ch, width, height } = meta;
    const base = index * cells;

    stillPixels.fill(BLACK);
    movingPixels.fill(BLACK);

    const actx = art.ctx;
    actx.globalCompositeOperation = "source-over";
    actx.imageSmoothingEnabled = false;
    actx.fillStyle = "#000";
    actx.fillRect(0, 0, width, height);

    for (let row = 0; row < rows; row++) {
      const rowBase = row * cols;
      for (let col = 0; col < cols; col++) {
        const packed = chars[base + rowBase + col];
        const code = packed & 0x7f;
        if (!code) continue;
        const colour = colours[base + rowBase + col];
        const r = red[colour >> 11];
        const g = green[(colour >> 5) & 63];
        const b = blue[colour & 31];
        const pixel = BLACK | (b << 16) | (g << 8) | r;
        if (packed & 0x80) stillPixels[rowBase + col] = pixel;
        else movingPixels[rowBase + col] = pixel;
        actx.drawImage(atlas, code * cw, 0, cw, ch, col * cw, row * ch, cw, ch);
      }
    }

    tintStill.ctx.putImageData(stillImage, 0, 0);
    tintMoving.ctx.putImageData(movingImage, 0, 0);

    compose(movingLayer, tintMoving.canvas);
    compose(stillLayer, tintStill.canvas);

    const tctx = trail.ctx;
    tctx.globalCompositeOperation = "multiply";
    tctx.fillStyle = "#727272";
    tctx.fillRect(0, 0, width, height);
    tctx.globalCompositeOperation = "lighten";
    tctx.drawImage(movingLayer.canvas, 0, 0);
    tctx.globalCompositeOperation = "source-over";

    out.globalCompositeOperation = "source-over";
    out.drawImage(trail.canvas, 0, 0);
    out.globalCompositeOperation = "lighten";
    out.drawImage(stillLayer.canvas, 0, 0);
    out.globalCompositeOperation = "source-over";

    drawGlow();
  }

  function drawNextFrame() {
    if (frameIndex === 0) resetTrail();
    renderFrame(frameIndex);
    frameIndex = (frameIndex + 1) % meta.frames;
  }

  function tick(now) {
    if (running && !paused) {
      if (now - lastTick > 500) {
        resetTrail();
        nextFrameAt = now;
      }
      let drawn = 0;
      while (now >= nextFrameAt && drawn < 3) {
        drawNextFrame();
        nextFrameAt += 1000 / meta.fps;
        drawn++;
      }
      if (nextFrameAt < now - 500) nextFrameAt = now + 1000 / meta.fps;
    }
    lastTick = now;
    requestAnimationFrame(tick);
  }

  function fit() {
    if (!meta) return;
    const viewport = window.visualViewport;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;
    const scale = Math.min(width / meta.width, height / meta.height);
    screen.style.width = `${Math.max(1, Math.round(meta.width * scale))}px`;
    screen.style.height = `${Math.max(1, Math.round(meta.height * scale))}px`;
    resizeStars(width, height, scale);
    drawStars(performance.now() / 1000);
  }

  function restart() {
    if (!running) return;
    frameIndex = 0;
    resetTrail();
    drawNextFrame();
    nextFrameAt = performance.now() + 1000 / meta.fps;
    lastTick = performance.now();
  }

  function screenshot() {
    if (!running) return;
    const viewport = window.visualViewport;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;
    const shot = document.createElement("canvas");
    shot.width = Math.round(width);
    shot.height = Math.round(height);
    const ctx = shot.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(starCanvas, 0, 0, width, height);
    const rect = screen.getBoundingClientRect();
    ctx.drawImage(screen, rect.left, rect.top, rect.width, rect.height);
    shot.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `rose-bouquet-${Date.now()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function start() {
    atlas = buildAtlas();
    setupLayers();
    fit();
    window.addEventListener("resize", fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space") {
        event.preventDefault();
        paused = !paused;
        if (!paused) {
          nextFrameAt = performance.now() + 1000 / meta.fps;
          lastTick = performance.now();
        }
      } else if (event.key === "r" || event.key === "R") {
        restart();
      } else if (event.key === "s" || event.key === "S") {
        screenshot();
      } else if (event.key === "f" || event.key === "F") {
        toggleFullscreen();
      } else if (event.key === "Escape" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    });

    drawNextFrame();
    running = true;
    nextFrameAt = performance.now() + 1000 / meta.fps;
    lastTick = performance.now();
    requestAnimationFrame(tick);
    requestAnimationFrame(() => loader.classList.add("hidden"));
  }

  function fail(error) {
    console.error(error);
    loader.classList.add("error");
    loaderTitle.textContent = "could not grow the bouquet";
    if (location.protocol === "file:") {
      loaderDetail.textContent = "open the page through a web server (make serve, or Docker)";
    } else {
      loaderDetail.textContent = String((error && error.message) || error);
    }
  }

  async function load() {
    if (location.protocol === "file:") {
      throw new Error("the frame data must be served over HTTP");
    }
    setProgress(0.03);
    loaderDetail.textContent = "loading frames";
    const metadata = await fetch("data/meta.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`data/meta.json returned ${response.status}`);
      return response.json();
    });
    const compressed = await download("data/frames.bin.gz", setProgress);
    loaderDetail.textContent = "unpacking frames";
    setProgress(1);
    const raw = await gunzip(compressed);
    const info = metadata.data;
    if (raw.byteLength < info.coloursOffset + info.coloursBytes) {
      throw new Error("the frame data is incomplete");
    }
    meta = metadata;
    cells = info.cells;
    chars = new Uint8Array(raw, 0, info.charsBytes);
    colours = new Uint16Array(raw, info.coloursOffset, cells * meta.frames);
    start();
  }

  load().catch(fail);
})();
