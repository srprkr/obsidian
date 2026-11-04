// Canvas drawing helpers shared by the main waveform and the release-trigger mini view.

/** Draws the peak overview between two fractions of the sample across the full canvas width. */
export function drawPeaks(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  fromFraction: number,
  toFraction: number,
  width: number,
  height: number,
  fullScalePixels: number, // distance from the centre line that a full-scale sample reaches
  zoom: number, // vertical magnification (1 = true level)
  colour: string
) {
  const bins = peaks.length / 2;
  if (bins === 0) return;

  const centre = height / 2;
  const span = Math.max(1e-6, toFraction - fromFraction);
  ctx.fillStyle = colour;

  for (let x = 0; x < width; x++) {
    const binFrom = Math.floor((fromFraction + (x / width) * span) * bins);
    const binTo = Math.max(binFrom + 1, Math.floor((fromFraction + ((x + 1) / width) * span) * bins));

    let lo = 1, hi = -1;
    for (let b = binFrom; b < binTo && b < bins; b++) {
      lo = Math.min(lo, peaks[b * 2]);
      hi = Math.max(hi, peaks[b * 2 + 1]);
    }
    if (lo > hi) continue;

    const yTop = centre - Math.min(1, hi * zoom) * fullScalePixels;
    const yBottom = centre - Math.max(-1, lo * zoom) * fullScalePixels;
    ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#09090b");
  gradient.addColorStop(1, "#040405");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

/** Vertical line with a small dot, used for playheads. */
export function drawPlayhead(ctx: CanvasRenderingContext2D, x: number, height: number, colour: string, dotY: number, dotRadius = 3.5) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, dotY, dotRadius, 0, Math.PI * 2);
  ctx.fill();
}

/** Marker line with a labelled flag at the top or bottom. */
export function drawMarker(ctx: CanvasRenderingContext2D, x: number, height: number, colour: string, label: string, atTop: boolean) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();

  // Keep the flag inside the canvas when the marker sits at either edge.
  const badgeX = Math.min(ctx.canvas.clientWidth - 22, Math.max(22, x));
  const badgeY = atTop ? 16 : height - 16;
  ctx.fillStyle = colour;
  ctx.beginPath();
  // roundRect is missing in older WebKit (macOS 10.15 / 11).
  if (typeof ctx.roundRect === "function") ctx.roundRect(badgeX - 22, badgeY - 10, 44, 20, 3);
  else ctx.rect(badgeX - 22, badgeY - 10, 44, 20);
  ctx.fill();

  ctx.fillStyle = "#09090b";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, badgeX, badgeY);
}

/** Keeps a canvas's backing store at 2x its CSS size for crisp lines; returns the CSS size. */
export function syncCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = 2;
  if (canvas.width !== width * scale || canvas.height !== height * scale) {
    canvas.width = width * scale;
    canvas.height = height * scale;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(scale, 0, 0, scale, 0, 0);
  return { width, height };
}
