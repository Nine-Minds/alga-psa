import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const mobileNodeModulesPath = path.join(projectRoot, "node_modules");
const browserEntryPath = path.join(
  projectRoot,
  "scripts/ticket-mobile-editor-browser-entry.ts",
);
const outputModulePath = path.join(
  projectRoot,
  "src/features/ticketRichText/generatedEditorHtml.ts",
);

const result = await build({
  entryPoints: [browserEntryPath],
  absWorkingDir: projectRoot,
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  nodePaths: [mobileNodeModulesPath],
  plugins: [{
    name: "mobile-editor-dependencies",
    setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData?.mobileEditorResolution) return;
        // Shared editor source lives outside mobile. Its bare imports must use
        // mobile's locked packages even when a root workspace install exists.
        // Retain nested package resolution for dependencies already in mobile.
        const resolveDir = args.resolveDir.startsWith(`${mobileNodeModulesPath}${path.sep}`)
          ? args.resolveDir : projectRoot;
        const result = await builder.resolve(args.path, {
          resolveDir,
          kind: args.kind,
          pluginData: { mobileEditorResolution: true },
        });
        if (result.errors.length) return result;
        if (!result.path.startsWith(`${mobileNodeModulesPath}${path.sep}`)) {
          return { errors: [{ text: `Mobile editor dependency ${args.path} must be installed inside ee/mobile/node_modules` }] };
        }
        // The recursion guard is only for builder.resolve above; don't pass it
        // to the loaded module and accidentally bypass its transitive imports.
        return { ...result, pluginData: undefined };
      });
    },
  }],
  target: ["es2019"],
  minify: true,
  legalComments: "none",
});

const bundle = result.outputFiles[0]?.text ?? "";
const escapedBundle = bundle.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      /* Light defaults; the app overrides these from the tenant's theme pair,
         first as an injected <style> and then through the set-theme message. */
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --editor-bg: #ffffff;
        --editor-text: #111827;
        --editor-text-secondary: #6b7280;
        --editor-link: #0f766e;
        --editor-mention-bg: #dbeafe;
        --editor-mention-text: #1e40af;
      }

      html,
      body,
      #editor-root {
        margin: 0;
        padding: 0;
        min-height: 100%;
        height: 100%;
        background: var(--editor-bg);
      }

      body {
        color: var(--editor-text);
      }

      #editor-root {
        box-sizing: border-box;
        min-height: 100%;
        height: 100%;
        padding: 12px;
        display: flex;
        flex-direction: column;
      }

      .ProseMirror {
        min-height: 100%;
        flex: 1;
        outline: none;
        white-space: pre-wrap;
        word-break: break-word;
        cursor: text;
      }

      .ProseMirror p,
      .ProseMirror ul,
      .ProseMirror ol,
      .ProseMirror h1,
      .ProseMirror h2,
      .ProseMirror h3,
      .ProseMirror h4,
      .ProseMirror h5,
      .ProseMirror h6,
      .ProseMirror blockquote {
        margin: 0 0 8px;
      }

      .ProseMirror > *:last-child {
        margin-bottom: 0;
      }

      .ProseMirror ul,
      .ProseMirror ol {
        padding-left: 20px;
      }

      .ProseMirror a {
        color: var(--editor-link);
        text-decoration: underline;
      }

      .ProseMirror blockquote {
        padding-left: 8px;
        border-left: 2px solid var(--editor-text-secondary);
        color: var(--editor-text-secondary);
      }

      .ProseMirror img {
        max-width: 100%;
        height: auto;
      }

      .mention-badge {
        display: inline;
        padding: 1px 4px;
        border-radius: 4px;
        background-color: var(--editor-mention-bg);
        color: var(--editor-mention-text);
        font-weight: 500;
        white-space: nowrap;
        user-select: none;
      }
    </style>
  </head>
  <body>
    <div id="editor-root"></div>
    <script>${escapedBundle}</script>
    <script>
      document.getElementById('editor-root').addEventListener('click', function(e) {
        if (e.target === this || e.target === document.body) {
          var pm = this.querySelector('.ProseMirror');
          if (pm && pm.getAttribute('contenteditable') === 'true' && !pm.contains(e.target)) {
            pm.focus();
          }
        }
      });
    </script>
  </body>
</html>`;

const moduleSource = `// Generated by ee/mobile/scripts/generate-ticket-mobile-editor-html.mjs
export const TICKET_MOBILE_EDITOR_HTML = ${JSON.stringify(html)} as const;
export const TICKET_MOBILE_EDITOR_BASE_URL = "https://mobile.alga.local/editor/" as const;
`;

await fs.mkdir(path.dirname(outputModulePath), { recursive: true });
await fs.writeFile(outputModulePath, moduleSource, "utf8");
