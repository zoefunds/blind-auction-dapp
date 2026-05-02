"use client";
import { useEffect } from "react";
import { Buffer } from "buffer";

export default function BufferPolyfill() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).Buffer = (window as any).Buffer || Buffer;
      (window as any).global = (window as any).global || window;
    }
  }, []);
  return null;
}
