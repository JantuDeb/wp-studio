#!/bin/sh
set -eu

docker-entrypoint.sh "$@" &
wordpress_pid=$!

for _attempt in $(seq 1 60); do
	if [ -f /var/www/html/wp-config.php ]; then
		break
	fi
	sleep 1
done

chown -R studio:www-data /var/www/html
chmod -R g+rwX /var/www/html
/usr/sbin/sshd

wait "$wordpress_pid"
