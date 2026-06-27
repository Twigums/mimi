import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AR_MIN,
         AR_MAX,
         arToMs,
         VOLUME_MIN,
         VOLUME_MAX,
         VOLUME_STEP,
         CURSOR_SIZE_MIN,
         CURSOR_SIZE_MAX,
         TRAIL_FADE_MIN,
         TRAIL_FADE_MAX,
         OFFSET_STEP,
         TIMING_OFFSET_MIN,
         TIMING_OFFSET_MAX,
         resetSettings,
       } from "../core/settings";

import { useApproachRate,
         useVolume,
         useHitsoundVolume,
         useUiVolume,
         useHiddenMod,
         useCursorSize,
         useCursorR,
         useCursorG,
         useCursorB,
         useTrailFadeSpeed,
         useTrailShape,
         useTrailDecay,
         useMusicOffset
       } from "./hooks/useSettings";

import { TestPlay } from "./TestPlay";
import { ColorPicker } from "./ColorPicker";
import { useLang } from "./hooks/useLang";

interface Props {
  isSongPage?: boolean;
}

const sliderFill = (val: number, min: number, max: number): CSSProperties =>
  ({ '--fill': `${((val - min) / (max - min)) * 100}%` } as CSSProperties);

export function OptionsPanel({ isSongPage = false }: Props) {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      setOpen(false);
      setExiting(false);
      document.body.classList.remove('options-open');
    }, 240);
  }, []);

  useEffect(() => () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    document.body.classList.remove('options-open');
  }, []);

  const [ar, setAr] = useApproachRate();
  const [vol, setVol] = useVolume();
  const [hsVol, setHsVol] = useHitsoundVolume();
  const [uiVol, setUiVol] = useUiVolume();
  const [hidden, setHidden] = useHiddenMod();
  const [cursorSize, setCursorSize] = useCursorSize();
  const [cursorR, setCursorR] = useCursorR();
  const [cursorG, setCursorG] = useCursorG();
  const [cursorB, setCursorB] = useCursorB();
  const [trailFadeSpeed, setTrailFadeSpeed] = useTrailFadeSpeed();
  const [trailShape, setTrailShape] = useTrailShape();
  const [trailDecay, setTrailDecay] = useTrailDecay();
  const [musicOffset, setMusicOffset] = useMusicOffset();
  const lang = useLang();

  useEffect(() => {
    const btn = document.getElementById("settings-btn");
    const handleOpen = () => {
      setOpen(true);
      document.body.classList.add('options-open');
    };
    btn?.addEventListener("click", handleOpen);
    return () => btn?.removeEventListener("click", handleOpen);
  }, []);

  const handleColorChange = useCallback((r: number, g: number, b: number): void => {
    setCursorR(r);
    setCursorG(g);
    setCursorB(b);
  }, [setCursorR, setCursorG, setCursorB]);

  // common settings stay open
  const [trailOpen, setTrailOpen] = useState(() => localStorage.getItem("trailAccordionOpen") === "true");

  if (!open) return null;

  const ms = Math.round(arToMs(ar));
  const isJp = lang === "jp";
  const fmtOffset = (ms: number): string =>
    (ms >= 0 ? "+" : "") + (ms / 1000).toFixed(2) + "s";

  return (
    <div className={`options-backdrop${exiting ? " exiting" : ""}`} onClick={close}>
      <div className={`options-panel${exiting ? " exiting" : ""}`} onClick={e => e.stopPropagation()}>

        <button
          className="options-close"
          onClick={close}
          aria-label={isJp ? "閉じる" : "Close"}
        >
          ×
        </button>

        <h2 className="options-title">
          {isJp ? "オプション" : "Options"}
        </h2>

        <TestPlay loop variant="panel" frameScale={0.6} />

        <div className="options-grid">

          <section className="options-section">
            <h3 className="options-section-title">{isJp ? "音量" : "Audio"}</h3>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "ミュージック" : "Music Volume"}</span>
                <span className="options-setting-value">{vol}%</span>
              </label>
              <input
                type="range"
                className="options-slider"
                min={VOLUME_MIN}
                max={VOLUME_MAX}
                step={VOLUME_STEP}
                value={vol}
                style={sliderFill(vol, VOLUME_MIN, VOLUME_MAX)}
                onChange={e => setVol(Number(e.target.value))}
              />
            </div>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "ヒット音量" : "Hitsound Volume"}</span>
                <span className="options-setting-value">{hsVol}%</span>
              </label>
              <input
                type="range"
                className="options-slider"
                min={VOLUME_MIN}
                max={VOLUME_MAX}
                step={VOLUME_STEP}
                value={hsVol}
                style={sliderFill(hsVol, VOLUME_MIN, VOLUME_MAX)}
                onChange={e => setHsVol(Number(e.target.value))}
              />
            </div>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "操作音量" : "Interface Volume"}</span>
                <span className="options-setting-value">{uiVol}%</span>
              </label>
              <input
                type="range"
                className="options-slider"
                min={VOLUME_MIN}
                max={VOLUME_MAX}
                step={VOLUME_STEP}
                value={uiVol}
                style={sliderFill(uiVol, VOLUME_MIN, VOLUME_MAX)}
                onChange={e => setUiVol(Number(e.target.value))}
              />
            </div>
          </section>

          <section className="options-section">
            <h3 className="options-section-title">{isJp ? "ゲームプレイ" : "Gameplay"}</h3>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "アプローチレート" : "Approach Rate"}</span>
                <span className="options-setting-value">AR {ar}</span>
              </label>
              <input
                type="range"
                className="options-slider"
                min={AR_MIN}
                max={AR_MAX}
                step={1}
                value={ar}
                style={sliderFill(ar, AR_MIN, AR_MAX)}
                disabled={isSongPage}
                onChange={e => setAr(Number(e.target.value))}
              />
              <span className="options-ms-label">{ms}ms</span>
              {isSongPage && (
                <p className="options-note">
                  {isJp
                    ? "ARはホームページでのみ変更できます。"
                    : "Approach rate can only be changed from the home page."}
                </p>
              )}
            </div>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "音楽オフセット" : "Music Offset"}</span>
                <span className="options-setting-value">{fmtOffset(musicOffset)}</span>
              </label>
              <input
                type="range"
                className="options-slider"
                min={TIMING_OFFSET_MIN}
                max={TIMING_OFFSET_MAX}
                step={OFFSET_STEP}
                value={musicOffset}
                style={sliderFill(
                  Math.max(TIMING_OFFSET_MIN, Math.min(TIMING_OFFSET_MAX, musicOffset)),
                  TIMING_OFFSET_MIN,
                  TIMING_OFFSET_MAX,
                )}
                onChange={e => setMusicOffset(Number(e.target.value))}
              />
              <p className="options-note">
                {isJp
                  ? "早押しなら負の方向に、遅れ気味なら正の方向に調整してください。"
                  : "If you are hitting early, move this negative; if you are hitting late, move this positive."}
              </p>
            </div>
          </section>

          <section className="options-section">
            <h3 className="options-section-title">{isJp ? "モディファイア" : "Modifiers"}</h3>

            <div className="options-row options-row--mod">
              <label className="options-mod-label">
                <input
                  type="checkbox"
                  className="options-mod-checkbox"
                  checked={hidden}
                  onChange={e => setHidden(e.target.checked)}
                />
                <span>{isJp ? "ヒドゥン" : "Hidden"}</span>
              </label>
            </div>
          </section>

          <section className="options-section">
            <h3 className="options-section-title">{isJp ? "カーソル" : "Cursor"}</h3>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "カーソルサイズ" : "Cursor Size"}</span>
                <span className="options-setting-value">{cursorSize}</span>
              </label>
              <input
                type="range"
                className="options-slider"
                min={CURSOR_SIZE_MIN}
                max={CURSOR_SIZE_MAX}
                step={1}
                value={cursorSize}
                style={sliderFill(cursorSize, CURSOR_SIZE_MIN, CURSOR_SIZE_MAX)}
                onChange={e => setCursorSize(Number(e.target.value))}
              />
            </div>

            <div className="options-row">
              <label className="options-label">
                <span>{isJp ? "カーソルカラー" : "Cursor Color"}</span>
              </label>
              <ColorPicker r={cursorR} g={cursorG} b={cursorB} onChange={handleColorChange} />
            </div>
          </section>

          <section className={`options-section options-accordion${trailOpen ? " options-accordion--open" : ""}`}>
            <button
              className="options-accordion-summary"
              onClick={() => {
                const v = !trailOpen;
                setTrailOpen(v);
                localStorage.setItem("trailAccordionOpen", String(v));
              }}
            >
              <span>{isJp ? "トレイル" : "Trail"}</span>
              <span className="options-accordion-chevron">▾</span>
            </button>
            <div className="options-accordion-body">
              <div className="options-accordion-body-inner">

                <div className="options-row">
                  <label className="options-label">
                    <span>{isJp ? "トレイル形状" : "Trail Shape"}</span>
                  </label>
                  <div className="options-chip-group">
                    {(["circle", "star", "square"] as const).map(s => (
                      <button
                        key={s}
                        className={`options-chip${trailShape === s ? " options-chip--active" : ""}`}
                        onClick={() => setTrailShape(s)}
                      >
                        {isJp
                          ? s === "circle" ? "丸" : s === "star" ? "星" : "四角"
                          : s === "circle" ? "Circle" : s === "star" ? "Star" : "Square"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="options-row">
                  <label className="options-label">
                    <span>{isJp ? "トレイル動作" : "Trail Decay"}</span>
                  </label>
                  <div className="options-chip-group">
                    {(["fade", "scatter"] as const).map(d => (
                      <button
                        key={d}
                        className={`options-chip${trailDecay === d ? " options-chip--active" : ""}`}
                        onClick={() => setTrailDecay(d)}
                      >
                        {isJp
                          ? d === "fade" ? "フェード" : "散布"
                          : d === "fade" ? "Fade" : "Scatter"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="options-row">
                  <label className="options-label">
                    <span>{isJp ? "フェード速度" : "Trail Fade Speed"}</span>
                    <span className="options-setting-value">{trailFadeSpeed}</span>
                  </label>
                  <input
                    type="range"
                    className="options-slider"
                    min={TRAIL_FADE_MIN}
                    max={TRAIL_FADE_MAX}
                    step={1}
                    value={trailFadeSpeed}
                    style={sliderFill(trailFadeSpeed, TRAIL_FADE_MIN, TRAIL_FADE_MAX)}
                    onChange={e => setTrailFadeSpeed(Number(e.target.value))}
                  />
                  {trailDecay === "scatter" && (
                    <p className="options-note">
                      {isJp
                        ? "フェード速度はフェードモードのみ適用されます。"
                        : "Trail fade speed only applies in Fade decay mode."}
                    </p>
                  )}
                </div>

              </div>
            </div>
          </section>

        </div>

        <button
          className="options-reset"
          onClick={() => {
            const keepAr = ar;
            resetSettings();
            if (isSongPage) setAr(keepAr);
          }}
        >
          {isJp ? "デフォルトに戻す" : "Reset to defaults"}
        </button>

      </div>
    </div>
  );
}
