#!/usr/bin/env sh
# 构建 + 打包 + 安装进 desktop profile。
# 用法：pnpm run install:desktop   （之后重启 DeepSeek Harness 生效）
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${DSH_DESKTOP_PROFILE:-$HOME/.dsh/profiles/desktop}"
APP_PNPM="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.mjs"

cd "$ROOT"
pnpm build
TARBALL="$(pnpm pack | tail -1)"
TARBALL="$ROOT/$(basename "$TARBALL")"
echo "packed: $TARBALL"

# profile 的依赖固定指向该 tarball（版本变化也能自动跟上）
node -e '
const fs = require("node:fs")
const [pkgPath, tarball] = process.argv.slice(1)
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
pkg.dependencies["dsh-session-finder"] = "file:" + tarball
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
' "$PROFILE/package.json" "$TARBALL"

cd "$PROFILE"
if [ -f "$APP_PNPM" ]; then
  node "$APP_PNPM" install
else
  pnpm install
fi
echo "installed dsh-session-finder into $PROFILE — 重启 DeepSeek Harness 生效"
