"use client";

import { useState } from "react";
import { uploadPhotos, deletePhoto } from "@/lib/actions";
import ConfirmButton from "@/components/ConfirmButton";

export interface PhotoRef {
  id: string;
}

export default function PhotoManager({ itemId, photos }: { itemId: string; photos: PhotoRef[] }) {
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      await uploadPhotos(fd);
      form.reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {photos.length > 0 ? (
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/photo/${p.id}?size=thumb`}
                alt="item"
                className="h-full w-full cursor-zoom-in object-cover"
                onClick={() => setLightbox(p.id)}
              />
              <form action={deletePhoto} className="absolute right-1 top-1">
                <input type="hidden" name="id" value={p.id} />
                <ConfirmButton
                  message="Delete this photo?"
                  className="rounded-full bg-black/60 px-1.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
                >
                  ✕
                </ConfirmButton>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-slate-500">No photos yet.</p>
      )}

      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="file" name="photos" accept="image/*" multiple required className="text-sm" />
        <button className="btn-ghost py-1.5 text-sm" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        <span className="text-xs text-slate-400">Phone: choose Camera to snap one.</span>
      </form>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/photo/${lightbox}`} alt="item" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
