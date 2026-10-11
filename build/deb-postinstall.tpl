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

chmod 4755 '/opt/GenieTerm/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
