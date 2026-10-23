import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// GitHub Pages serves project sites from /<repository>/. Set BASE_PATH when
// building for a project page; leave it unset for local development or a
// user/organization root site.
const base = (process.env.BASE_PATH ?? "").replace(/\/$/, "");

export default defineConfig({
  plugins: [
    sveltekit({
      paths: { base },
      preprocess: vitePreprocess(),
      adapter: adapter({
        pages: "build",
        assets: "build",
        fallback: "404.html",
        precompress: false,
        strict: false,
      }),
    }),
  ],
  worker: {
    format: "es",
  },
});
