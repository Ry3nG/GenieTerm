#!/bin/sh
n=0
until curl -s http://127.0.0.1:9333/json 2>/dev/null | grep -q '"type": "page"'; do
    sleep 2; n=$((n+1)); [ $n -gt 60 ] && echo "no window" && exit 1
done
sleep 6
echo "window up"
