#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${0:A:h}/../.."
finish() { print '\n按回车关闭窗口。'; read -r reply; }
trap finish EXIT
service="gui/$(id -u)/com.capx.newsnow.mac-worker"
if launchctl print "$service" >/dev/null 2>&1; then
  launchctl kickstart "$service"
  print '后台更新任务已启动，无需等待本窗口。'
  exit 0
fi
if [[ "$(git branch --show-current)" != main || -n "$(git status --porcelain)" ]]; then
  print '源码有未提交改动或当前不在 main，已停止，避免覆盖其他工作。'
  exit 1
fi
git pull --ff-only origin main
codex login status
print '开始用 ChatGPT 订阅处理一批新信息。请保持 Mac 唤醒和联网。'
node_modules/.bin/tsx --tsconfig tsconfig.node.json tools/ai-bridge/mac-batch.ts --source all --limit 12
# Even when no new article batch exists, recheck old zero-attachment records
# against the current attachment discovery rules. This command may create
# result.json itself when it restores attachments.
node_modules/.bin/tsx --tsconfig tsconfig.node.json tools/ai-bridge/backfill-attachments.ts --limit 24
if [[ ! -f .data/mac-batch/result.json ]]; then
  print '没有待发布的新结果。'
  exit 0
fi
node_modules/.bin/tsx --tsconfig tsconfig.node.json tools/ai-bridge/apply-batch.ts
if git diff --quiet -- data/intelligence-snapshot.json shared/intelligence-snapshot.ts; then
  print '没有待发布的新结果。'
  exit 0
fi
git diff --check
git add data/intelligence-snapshot.json shared/intelligence-snapshot.ts
git commit -m 'chore(data): publish Mac subscription batch'
git push origin main
print '结果已提交，Cloudflare 正在自动部署。部署成功后网站显示新结果。'
print '部署进度：https://github.com/caaaptaintop/newsnow/actions/workflows/cloudflare-pages.yml'
