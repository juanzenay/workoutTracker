import type { MetadataRoute } from "next";
import { getStrings } from "@/strings";

export default function manifest(): MetadataRoute.Manifest {
  const strings = getStrings();
  return {
    name: strings.app.name,
    short_name: strings.app.name,
    description: strings.app.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0f10",
    theme_color: "#0f0f10",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
