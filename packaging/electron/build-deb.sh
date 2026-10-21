#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="${project_dir}/outputs/electron/linux-unpacked"
package_root="$(mktemp -d)"
package_name="zoho-mail-tray"
package_version="$(node -p "require('${project_dir}/package.json').version")"
package_arch="$(dpkg --print-architecture)"
output_dir="${project_dir}/outputs/electron"
deb_file="${output_dir}/${package_name}_${package_version}_${package_arch}.deb"

cleanup() {
  rm -rf "${package_root}"
}
trap cleanup EXIT

if [[ ! -x "${app_dir}/zoho-mail-tray" || ! -f "${app_dir}/resources/app.asar" ]]; then
  printf 'Electron app files are missing. Run electron-builder --dir first.\n' >&2
  exit 1
fi

install -d "${package_root}/DEBIAN" \
  "${package_root}/opt/zoho-mail-tray" \
  "${package_root}/usr/share/applications" \
  "${package_root}/usr/share/icons/hicolor/128x128/apps"
cp -a "${app_dir}/." "${package_root}/opt/zoho-mail-tray/"
chmod 4755 "${package_root}/opt/zoho-mail-tray/chrome-sandbox"
install -m 0644 "${project_dir}/icons/zoho-tray.png" \
  "${package_root}/usr/share/icons/hicolor/128x128/apps/zoho-mail-tray.png"

cat >"${package_root}/DEBIAN/control" <<EOF
Package: ${package_name}
Version: ${package_version}
Section: mail
Priority: optional
Architecture: ${package_arch}
Maintainer: Zoho Mail Tray contributors <noreply@example.invalid>
Homepage: https://mail.zoho.com
Depends: libasound2, libatk1.0-0, libatk-bridge2.0-0, libatspi2.0-0, libgbm1, libgtk-3-0, libnotify4, libnss3, libsecret-1-0, libuuid1, libxss1, libxtst6, xdg-utils
Description: Linux tray app for Zoho Mail using Chromium
 Separate persistent sessions for Zoho accounts with a system tray menu.
EOF

cat >"${package_root}/usr/share/applications/com.example.zohomailtray.desktop" <<'EOF'
[Desktop Entry]
Name=Zoho Mail Tray
Comment=Zoho Mail in separate Chromium-backed desktop windows
Exec=/opt/zoho-mail-tray/zoho-mail-tray %U
StartupWMClass=com.example.zohomailtray
Icon=zoho-mail-tray
Terminal=false
Type=Application
Categories=Office;Email;
EOF

mkdir -p "${output_dir}"
dpkg-deb --build --root-owner-group "${package_root}" "${deb_file}"
printf 'Built %s\n' "${deb_file}"
