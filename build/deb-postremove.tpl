#!/bin/bash

# dpkg also invokes postrm during upgrades; the new package still owns the alternative.
case "$1" in
    remove|purge) ;;
    *) exit 0 ;;
esac

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'genieterm' '/opt/GenieTerm/genieterm' || true
fi
if [ -L '/usr/bin/genieterm' ] && [ "$(readlink '/usr/bin/genieterm')" = '/opt/GenieTerm/genieterm' ]; then
    rm -f '/usr/bin/genieterm'
fi

if [ -f /etc/apparmor.d/genieterm ]; then
    if hash apparmor_parser 2>/dev/null; then
        apparmor_parser --remove /etc/apparmor.d/genieterm 2>/dev/null || true
    fi
    rm -f /etc/apparmor.d/genieterm
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
