import { useEffect, useRef, useState, useCallback } from "react";

const SV_W  = 256;
const SV_H  = 160;
const HUE_W = 256;
const HUE_H = 14;

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn)      h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else                 h = (rn - gn) / d + 4;
    h /= 6;
  }
  return [h, max > 0 ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const rows: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t],
    [p, q, v], [t, p, v], [v, p, q],
  ];
  const [r, g, b] = rows[i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

interface Props {
  r: number;
  g: number;
  b: number;
  onChange: (r: number, g: number, b: number) => void;
}

export function ColorPicker({ r, g, b, onChange }: Props) {
  const svRef  = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);

  const [derivedH, s, v] = rgbToHsv(r, g, b);
  const [localH, setLocalH] = useState(derivedH);
  const h = s > 0.02 ? derivedH : localH;

  // Draw SV square
  useEffect(() => {
    const canvas = svRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = `hsl(${h * 360}, 100%, 50%)`;
    ctx.fillRect(0, 0, SV_W, SV_H);

    const wGrad = ctx.createLinearGradient(0, 0, SV_W, 0);
    wGrad.addColorStop(0, "rgba(255,255,255,1)");
    wGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = wGrad;
    ctx.fillRect(0, 0, SV_W, SV_H);

    const bGrad = ctx.createLinearGradient(0, 0, 0, SV_H);
    bGrad.addColorStop(0, "rgba(0,0,0,0)");
    bGrad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = bGrad;
    ctx.fillRect(0, 0, SV_W, SV_H);

  }, [h, s, v]);

  // Draw hue bar
  useEffect(() => {
    const canvas = hueRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, HUE_W, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, HUE_W, HUE_H);

    // Hue indicator
    const hx = Math.round(h * HUE_W);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hx - 2, 0, 4, HUE_H);
    ctx.stroke();
  }, [h]);

  const handleSvPointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!(e.buttons & 1)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ns = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nv = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
    const [nr, ng, nb] = hsvToRgb(h, ns, nv);
    onChange(nr, ng, nb);
  }, [h, onChange]);

  const handleHuePointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!(e.buttons & 1)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nh = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / rect.width));
    setLocalH(nh);
    const [nr, ng, nb] = hsvToRgb(nh, s, v);
    onChange(nr, ng, nb);
  }, [s, v, onChange]);

  return (
    <div className="color-picker">
      <div className="color-picker-sv-wrap">
        <canvas
          ref={svRef}
          className="color-picker-sv"
          width={SV_W}
          height={SV_H}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handleSvPointer(e); }}
          onPointerMove={handleSvPointer}
        />
        <div
          className="color-picker-dot"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
        />
      </div>
      <canvas
        ref={hueRef}
        className="color-picker-hue"
        width={HUE_W}
        height={HUE_H}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handleHuePointer(e); }}
        onPointerMove={handleHuePointer}
      />
      <div className="color-picker-swatch" style={{ background: `rgb(${r},${g},${b})` }} />
    </div>
  );
}