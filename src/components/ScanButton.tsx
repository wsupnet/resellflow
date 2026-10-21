"use client";

import { useState } from "react";
import BarcodeScanner from "./BarcodeScanner";

/** A small button that opens the camera scanner and returns the decoded code. */
export default function ScanButton({
  onCode,
  label = "Scan",
  className = "btn-ghost"
}: {
  onCode: (code: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        title="Scan a barcode with your camera"
      >
        {/* simple barcode glyph */}
        <span aria-hidden className="mr-1">▮▯▮▮▯</span>
        {label}
      </button>
      {open && (
        <BarcodeScanner
          onClose={() => setOpen(false)}
          onDetected={(code) => {
            setOpen(false);
            onCode(code);
          }}
        />
      )}
    </>
  );
}
