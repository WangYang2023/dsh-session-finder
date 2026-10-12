#!/usr/bin/env sh
# 构建 + 打包 + 安装进 desktop profile。
# 用法：pnpm run install:desktop   （之后重启 DeepSeek Harness 生效）
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${DSH_DESKTOP_PROFILE:-$HOME/.dsh/profiles/desktop}"
APP_PNPM="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.mjs"

cd "$ROOT"
pnpm build
PACKED="$(pnpm pack | tail -1)"
PACKED="$ROOT/$(basename "$PACKED")"

# 包名带上内容哈希：依赖 spec 是固定的 file: 路径时，pnpm 看到同名文件会判定
# "Already up to date" 而不重新拷贝；换名字才能让每次构建真正生效。
HASH="$(shasum -a 256 "$PACKED" | cut -c1-12)"
TARBALL="${PACKED%.tgz}-$HASH.tgz"
mv "$PACKED" "$TARBALL"
for old in "$ROOT"/dsh-session-finder-*.tgz; do
  [ "$old" = "$TARBALL" ] && continue
  [ -f "$old" ] && rm -f "$old"
done
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
