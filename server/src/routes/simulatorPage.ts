import { readFileSync } from "node:fs";

// Plain HTML file so it can be edited without touching TypeScript.
export const SIMULATOR_HTML = readFileSync(new URL("../../public/simulator.html", import.meta.url), "utf8");
