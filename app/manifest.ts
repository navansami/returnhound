import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lost & Found — Fairmont The Palm",
    short_name: "Lost & Found",
    description: "Lost & Found management for Royal Service at Fairmont The Palm.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
