#!/bin/bash
# MiniFund —— 解除 macOS 安全限制（Gatekeeper 隔离属性）
#
# 适用场景：从网络下载的应用未经过 Apple 付费签名/公证，
# 首次打开时被系统拦截，提示「已损坏，无法打开」或「无法验证开发者」。
# 本脚本会移除应用的 com.apple.quarantine 隔离标记，之后即可正常打开。

set -u

APP_NAME="MiniFund"
APP="/Applications/${APP_NAME}.app"

echo "==============================================="
echo "   ${APP_NAME} 安全限制解除工具"
echo "==============================================="
echo

if [ ! -d "$APP" ]; then
  echo "✗ 未在「应用程序」中找到 ${APP_NAME}.app。"
  echo
  echo "  请先将本磁盘映像中的 ${APP_NAME}.app 拖入「应用程序」文件夹，"
  echo "  然后重新双击运行本脚本。"
  echo
  read -n 1 -s -r -p "按任意键关闭窗口..."
  echo
  exit 1
fi

echo "→ 正在解除隔离属性：$APP"
if xattr -dr com.apple.quarantine "$APP" 2>/dev/null; then
  echo "✓ 完成！现在可以正常双击打开 ${APP_NAME} 了。"
else
  echo "  普通权限解除失败，尝试以管理员身份重试（可能需要输入开机密码）..."
  if sudo xattr -dr com.apple.quarantine "$APP"; then
    echo "✓ 完成！现在可以正常双击打开 ${APP_NAME} 了。"
  else
    echo "✗ 解除失败，请参考「首次打开必读.txt」中的手动命令。"
  fi
fi

echo
read -n 1 -s -r -p "按任意键关闭窗口..."
echo
