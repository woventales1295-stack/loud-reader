// Unsigned builds must still carry a valid (ad-hoc) signature, or Apple-silicon Macs report the app as "damaged".
const { execFileSync } = require("child_process"); const path = require("path");
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  if (/-temp$/.test(ctx.appOutDir)) return;   // per-architecture halves of a universal build must stay byte-identical; only the merged app is signed
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
