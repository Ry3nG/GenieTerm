import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    root: __dirname,
    base: "./",
    publicDir: path.resolve(__dirname, "../../public"),
    plugins: [
        tsconfigPaths(),
        svgr({ svgrOptions: { exportType: "default", ref: true, svgo: false }, include: "**/*.svg" }),
        react(),
        tailwindcss(),
    ],
    build: { outDir: path.resolve(__dirname, "../../site/demo"), emptyOutDir: true },
});
