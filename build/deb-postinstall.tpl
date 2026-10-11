#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/genieterm' ] && [ "$(readlink '/usr/bin/genieterm')" != '/etc/alternatives/genieterm' ]; then
        rm -f '/usr/bin/genieterm'
    fi
    update-alternatives --install '/usr/bin/genieterm' 'genieterm' '/opt/GenieTerm/genieterm' 100 || ln -sf '/opt/GenieTerm/genieterm' '/usr/bin/genieterm'
else
    ln -sf '/opt/GenieTerm/genieterm' '/usr/bin/genieterm'
fi

# Ubuntu 23.10+ restricts unprivileged user namespaces through AppArmor, which Chromium's sandbox
# needs. Like Ubuntu's own profiles for Chrome and VS Code, this one only grants userns to the app's
# binary; it leaves the app otherwise unconfined. The setuid helper below covers kernels without
# user namespaces.
# The userns rule needs AppArmor 4 (abi/4.0); older releases don't restrict user namespaces anyway.
if [ -e /etc/apparmor.d/abi/4.0 ] && hash apparmor_parser 2>/dev/null && [ -e /sys/kernel/security/apparmor ]; then
    cat > /etc/apparmor.d/genieterm <<'PROFILE'
# Installed by the GenieTerm package. Lets Chromium's sandbox use user namespaces.
abi <abi/4.0>,
include <tunables/global>

profile genieterm /opt/GenieTerm/genieterm flags=(unconfined) {
  userns,

  include if exists <local/genieterm>
}
PROFILE
    if ! apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/genieterm 2>/dev/null; then
        # never leave a profile behind that would fail at the next AppArmor reload
        rm -f /etc/apparmor.d/genieterm
    fi
fi

chmod 4755 '/opt/GenieTerm/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
