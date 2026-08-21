import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const findings = [];

const manifest = readText(join("src", "app", "manifest.ts"));
const serviceWorker = readText(join("public", "sw.js"));
const offline = readText(join("public", "offline.html"));

expectIncludes(manifest, 'name: "生生不息"', "manifest should use the product name");
expectIncludes(manifest, 'display: "standalone"', "manifest should use standalone display");
expectIncludes(manifest, 'start_url: "/"', "manifest should start at the app root");
expectIncludes(manifest, 'theme_color: "#16736b"', "manifest should define the theme color");
expectIncludes(manifest, 'src: "/icons/icon.svg"', "manifest should reference the app icon");
expectIncludes(manifest, 'src: "/icons/maskable.svg"', "manifest should reference the maskable icon");
expectIncludes(manifest, 'purpose: "maskable"', "manifest should mark the maskable icon purpose");

checkSvgIcon(join("public", "icons", "icon.svg"));
checkSvgIcon(join("public", "icons", "maskable.svg"));

expectIncludes(offline, "<!doctype html>", "offline shell should be an HTML document");
expectIncludes(offline, "现在暂时离线", "offline shell should explain the offline state");
expectIncludes(offline, 'name="viewport"', "offline shell should be responsive");

expectIncludes(serviceWorker, "perpetual-renewal-pwa-v1", "service worker should version its cache");
expectIncludes(serviceWorker, '"/offline.html"', "service worker should cache the offline shell");
expectIncludes(serviceWorker, 'url.pathname.startsWith("/api/")', "service worker should skip API requests");
expectIncludes(serviceWorker, 'request.method !== "GET"', "service worker should skip non-GET requests");
expectIncludes(serviceWorker, 'request.mode === "navigate"', "service worker should handle offline navigation");

if (findings.length > 0) {
  console.error("PWA check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("PWA check passed: manifest, icons, offline shell, and service worker boundaries are valid.");

function checkSvgIcon(file) {
  const content = readText(file);
  if (!content) return;

  if (!content.includes("<svg") || !content.includes("</svg>")) {
    findings.push(`${file} should be a complete SVG document.`);
  }

  if (!content.includes("viewBox=")) {
    findings.push(`${file} should define a viewBox.`);
  }
}

function expectIncludes(content, snippet, message) {
  if (!content) {
    return;
  }

  if (!content.includes(snippet)) {
    findings.push(message);
  }
}

function readText(file) {
  if (!existsSync(file)) {
    findings.push(`${file} is missing.`);
    return "";
  }

  return readFileSync(file, "utf8");
}
