"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat, NotFoundException } from "@zxing/library";

/**
 * Full-screen camera barcode scanner (ZXing — works on iOS Safari too).
 *
 * Feedback: frame is WHITE while searching, RED when a barcode is detected but
 * not yet decoded (move/align), GREEN on lock. Tap to refocus. Many phones expose
 * a rear ULTRA-WIDE lens that can't focus on close barcodes, so a camera switcher
 * + zoom slider are provided to get onto the sharp main lens.
 */
const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE
    ]
  ]
]);

type Status = "searching" | "detected" | "locked";

export default function BarcodeScanner({
  onDetected,
  onClose
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDeviceId = useRef<string | null>(null);

  const [mode, setMode] = useState<"auto" | string>("auto"); // "auto" or a deviceId
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("searching");
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; val: number } | null>(null);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; key: number } | null>(null);

  function track(): MediaStreamTrack | null {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    return stream?.getVideoTracks?.()[0] ?? null;
  }

  async function toggleTorch() {
    const t = track();
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      setTorchOn((v) => !v);
    } catch {
      /* ignore */
    }
  }

  async function applyZoom(val: number) {
    const t = track();
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ zoom: val }] } as unknown as MediaTrackConstraints);
      setZoom((z) => (z ? { ...z, val } : z));
    } catch {
      /* ignore */
    }
  }

  function switchCamera() {
    // Cycle within the rear cameras when there are several (the main + ultra-wide
    // + tele); fall back to all cameras only if we can't tell them apart.
    const rears = devices.filter((d) => /back|rear|environment/i.test(d.label));
    const pool = rears.length >= 2 ? rears : devices;
    if (pool.length < 2) return;
    const idx = pool.findIndex((d) => d.deviceId === activeDeviceId.current);
    const next = pool[(idx + 1) % pool.length];
    setStatus("searching");
    setZoom(null);
    setTorchOn(false);
    // Remember this lens so it becomes the default next time.
    try {
      localStorage.setItem("scannerDeviceId", next.deviceId);
    } catch {
      /* ignore */
    }
    setMode(next.deviceId);
  }

  async function onTapFocus(e: React.MouseEvent<HTMLDivElement>) {
    const t = track();
    const rect = videoRef.current?.getBoundingClientRect();
    if (rect) setFocusRing({ x: e.clientX - rect.left, y: e.clientY - rect.top, key: Date.now() });
    if (!t || !rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const caps = (t.getCapabilities?.() ?? {}) as { focusMode?: string[] };
    const advanced: Record<string, unknown>[] = [];
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("single-shot")) advanced.push({ focusMode: "single-shot" });
    advanced.push({ pointsOfInterest: [{ x, y }] });
    try {
      await t.applyConstraints({ advanced } as unknown as MediaTrackConstraints);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let cancelled = false;

    const secure = typeof window !== "undefined" && (window.isSecureContext || location.hostname === "localhost");
    if (!secure) {
      setError("Camera needs a secure connection (HTTPS or localhost). Open the app over HTTPS to scan.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support camera access.");
      return;
    }

    // Phase 1 (mode === "auto"): get permission, choose the MAIN rear camera, then
    // re-open it BY DEVICE ID (opening by id is what reliably exposes the torch on
    // Android). Picking the main lens is the hard part — labels are often generic
    // ("camera2 0, facing back"), so we (1) honor a remembered choice, then
    // (2) probe each rear lens and pick the highest-resolution one (the ultra-wide
    // /tele are normally lower-res than the main sensor).
    if (mode === "auto") {
      (async () => {
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
          tmp.getTracks().forEach((t) => t.stop());
        } catch (e) {
          if (!cancelled) {
            setError(
              (e as { name?: string })?.name === "NotAllowedError"
                ? "Camera permission was denied. Allow camera access and try again."
                : "Couldn't start the camera. Make sure no other app is using it."
            );
          }
          return;
        }
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (cancelled) return;
        setDevices(cams);
        const rears = cams.filter((d) => /back|rear|environment/i.test(d.label));

        // 1) Remembered choice wins.
        const saved = typeof window !== "undefined" ? localStorage.getItem("scannerDeviceId") : null;
        if (saved && cams.some((d) => d.deviceId === saved)) {
          setMode(saved);
          return;
        }

        // 2) Probe rear lenses for the highest-resolution one (≈ the main sensor).
        let pickId: string | null = null;
        if (rears.length > 1) {
          let bestPx = 0;
          for (const cam of rears) {
            if (cancelled) return;
            try {
              const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId } } });
              const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { width?: { max?: number }; height?: { max?: number } };
              s.getTracks().forEach((x) => x.stop());
              const px = (caps.width?.max ?? 0) * (caps.height?.max ?? 0);
              if (px > bestPx) {
                bestPx = px;
                pickId = cam.deviceId;
              }
            } catch {
              /* skip a lens that won't open for probing */
            }
          }
        }
        if (cancelled) return;

        // 3) Fallbacks: label heuristic, then first rear, then anything.
        const mainByLabel = rears.find((d) => !/wide|ultra|tele|depth|macro|zoom/i.test(d.label));
        const finalId = pickId ?? mainByLabel?.deviceId ?? rears[0]?.deviceId ?? cams[0]?.deviceId ?? null;
        setMode(finalId ?? "default");
      })();
      return () => {
        cancelled = true;
      };
    }

    // Phase 2: actually scan, opening the chosen device by id.
    const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 120 });

    const onResult = (result: unknown, err: unknown, controls: IScannerControls) => {
      if (cancelled) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      if (result) {
        if (revertTimer.current) clearTimeout(revertTimer.current);
        setStatus("locked");
        controls.stop();
        if (navigator.vibrate) navigator.vibrate(60);
        setTimeout(() => onDetected((result as { getText(): string }).getText()), 350);
        return;
      }
      if (err && !(err instanceof NotFoundException)) {
        setStatus("detected");
        if (revertTimer.current) clearTimeout(revertTimer.current);
        revertTimer.current = setTimeout(() => setStatus("searching"), 700);
      }
    };

    reader
      .decodeFromVideoDevice(mode === "default" ? undefined : mode, videoRef.current!, onResult)
      .then(() => {
        const t = track();
        if (!t) return;
        t.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints).catch(() => {});
        activeDeviceId.current = t.getSettings().deviceId ?? null;
        const caps = (t.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number; step: number } };
        if (caps.zoom && caps.zoom.max > caps.zoom.min) {
          const val = (t.getSettings() as { zoom?: number }).zoom ?? caps.zoom.min;
          setZoom({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, val });
        }
      })
      .catch((e) => {
        if (e?.name === "NotAllowedError") setError("Camera permission was denied. Allow camera access and try again.");
        else setError("Couldn't start the camera. Make sure no other app is using it.");
      });

    return () => {
      cancelled = true;
      if (revertTimer.current) clearTimeout(revertTimer.current);
      controlsRef.current?.stop();
    };
  }, [mode, onDetected]);

  const rearCount = devices.filter((d) => /back|rear|environment/i.test(d.label)).length;
  const frameColor =
    status === "locked" ? "border-emerald-400" : status === "detected" ? "border-red-500" : "border-white/80";
  const statusText =
    status === "locked" ? "Locked on!" : status === "detected" ? "Barcode detected — hold steady / align" : "Searching…";
  const statusDot = status === "locked" ? "bg-emerald-400" : status === "detected" ? "bg-red-500" : "bg-white/70";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="font-medium">Scan a barcode</span>
        <div className="flex items-center gap-2">
          {rearCount > 1 && (
            <button onClick={switchCamera} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm">
              Switch lens
            </button>
          )}
          <button
            onClick={toggleTorch}
            aria-label="Toggle flashlight"
            className={`rounded-lg px-3 py-1.5 ${torchOn ? "bg-yellow-300 text-slate-900" : "bg-white/15 text-white"}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M13 2 4 13h6l-1 9 9-12h-6l1-8z" />
            </svg>
          </button>
          <button onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm">
            Close
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden" onClick={onTapFocus}>
        {error ? (
          <div className="mx-6 max-w-sm rounded-xl bg-white p-5 text-center text-sm text-slate-700">{error}</div>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            {/* object-contain fits the whole camera frame to the screen; object-cover
                crops a landscape sensor into the portrait viewport, which looks
                "zoomed in" and hides the edges of the barcode. */}
            <video ref={videoRef} className="h-full w-full object-contain" muted playsInline autoPlay />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={`h-40 w-72 rounded-xl border-4 transition-colors duration-150 ${frameColor} shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]`} />
            </div>

            {focusRing && (
              <span
                key={focusRing.key}
                className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-yellow-300"
                style={{ left: focusRing.x, top: focusRing.y }}
              />
            )}

            <div className="absolute bottom-16 left-0 right-0 text-center text-sm text-white/90">
              <span className="inline-flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${statusDot} ${status === "searching" ? "animate-pulse" : ""}`} />
                {statusText}
              </span>
            </div>

            {zoom && (
              <div className="absolute bottom-4 left-0 right-0 flex items-center gap-2 px-8 text-white/80">
                <span className="text-xs">Zoom</span>
                <input
                  type="range"
                  min={zoom.min}
                  max={zoom.max}
                  step={zoom.step}
                  value={zoom.val}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  className="flex-1 accent-emerald-400"
                />
              </div>
            )}
          </>
        )}
      </div>

      <p className="p-4 text-center text-xs text-white/60">
        Blurry? Tap <b>Switch lens</b> to get off the ultra-wide, then zoom in. Tap the view to refocus.
      </p>
    </div>
  );
}
