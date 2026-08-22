#!/system/bin/sh
set -eu

# Kitsune Mask's SU-list mode rejects apps before a normal root prompt appears.
# Provision only the fixed scanner-control package and its current Android UID.
PACKAGE='cc.odyliao.pikminagentcontrol'
PROCESS="$PACKAGE"

UID_VALUE="$(cmd package list packages -U "$PACKAGE" 2>/dev/null \
    | sed -n "s/^package:${PACKAGE} uid:\([0-9][0-9]*\).*/\1/p" \
    | head -n 1)"

case "$UID_VALUE" in
    ''|*[!0-9]*)
        echo "Control app is not installed or its UID cannot be resolved." >&2
        exit 1
        ;;
esac

magisk --sqlite "INSERT OR REPLACE INTO sulist(package_name,process) VALUES('$PACKAGE','$PROCESS');"
magisk --sqlite "INSERT OR REPLACE INTO policies(uid,policy,until,logging,notification) VALUES($UID_VALUE,2,0,1,1);"

echo "Root access allowed for $PACKAGE (uid=$UID_VALUE)."
