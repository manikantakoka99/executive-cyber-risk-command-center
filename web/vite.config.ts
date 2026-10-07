import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow temporary Cloudflare quick tunnels when sharing a live demo
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
