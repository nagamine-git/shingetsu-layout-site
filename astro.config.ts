import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  adapter: cloudflare(),
  integrations: [sitemap({ filter: (page) => !page.includes("/contact/") })],
  build: { inlineStylesheets: "always" },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssMinify: true,
      minify: "esbuild",
    },
  },
  site: "https://shingetsu-layout.com",
});
