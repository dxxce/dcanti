const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: true,
  minify: false,
  // vscode is provided by the host at runtime, never bundle it.
  external: ["vscode"],
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[esbuild] watching...");
  } else {
    await esbuild.build(options);
    console.log("[esbuild] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
