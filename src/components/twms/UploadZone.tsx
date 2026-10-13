"use client";

import { useCallback, useState } from "react";

interface Props {
  label:    string;
  hint:     string;
  file:     File | null;
  onFile:   (f: File) => void;
  optional?: boolean;
}

export default function UploadZone({ label, hint, file, onFile, optional }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
  };

  return (
    <label
      className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
        dragging
          ? "border-primary bg-primary/20"
          : file
          ? "border-green-500 bg-green-900/10"
          : "border-slate-600 bg-slate-800/40 hover:border-slate-400"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={optional ? ".csv,.xlsx,.xls" : ".csv"}
        className="hidden"
        onChange={handleChange}
      />
      {file ? (
        <>
          <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-400 font-medium text-sm">{file.name}</span>
          <span className="text-slate-400 text-xs">Cliquer pour changer</span>
        </>
      ) : (
        <>
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span className="text-white font-semibold text-sm">{label}</span>
          <span className="text-slate-400 text-xs text-center">{hint}</span>
        </>
      )}
    </label>
  );
}
