// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Web shell for nfi-desk. `/api` is proxied to the Effect backend so the
// browser only ever talks to our server — never to freqtrade directly
// (no freqtrade CORS configuration needed).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env["VITE_API_PROXY_TARGET"] ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
  },
})
