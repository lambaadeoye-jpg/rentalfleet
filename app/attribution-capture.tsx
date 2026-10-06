"use client";
import { useEffect } from "react";
import { captureFirstTouch } from "@/lib/attribution";

export default function AttributionCapture() {
  useEffect(() => {
    captureFirstTouch();
  }, []);
  return null;
}
