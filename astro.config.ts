import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
  },
  site: "https://shingetsu.pages.dev",
});
