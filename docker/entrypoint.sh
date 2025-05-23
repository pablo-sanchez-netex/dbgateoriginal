#!/bin/sh

printenv | grep -v "no_proxy" >> /etc/environment
HOST_DOMAIN="dockerhost"
ping -q -c1 $HOST_DOMAIN > /dev/null 2>&1
if [ $? != 0 ]
then
  HOST_IP=$(ip route | awk 'NR==1 {print $3}')
  echo "$HOST_IP $HOST_DOMAIN" >> /etc/hosts
fi
service cron start

exec node bundle.js --listen-api
fgsdfgdfs
