FROM wordpress:php8.3-apache

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssh-server default-mysql-client less \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /run/sshd \
	&& useradd -m -s /bin/bash studio \
	&& echo 'studio:studio' | chpasswd \
	&& usermod -aG www-data studio \
	&& sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
	&& sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
	&& sed -i 's/^#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
	&& curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp-cli.phar \
	&& chmod +x /usr/local/bin/wp-cli.phar

# Authorize a fixed, test-only public key so the integration suite can exercise public-key auth.
# The matching private key (test_key) is committed alongside this fixture; it is NOT a secret and
# must never be used outside this disposable container.
COPY test_key.pub /tmp/test_key.pub
RUN mkdir -p /home/studio/.ssh \
	&& cat /tmp/test_key.pub > /home/studio/.ssh/authorized_keys \
	&& rm /tmp/test_key.pub \
	&& chmod 700 /home/studio/.ssh \
	&& chmod 600 /home/studio/.ssh/authorized_keys \
	&& chown -R studio:studio /home/studio/.ssh

COPY entrypoint.sh /usr/local/bin/studio-ssh-entrypoint
COPY wp /usr/local/bin/wp
RUN chmod +x /usr/local/bin/studio-ssh-entrypoint /usr/local/bin/wp

ENTRYPOINT [ "studio-ssh-entrypoint" ]
CMD [ "apache2-foreground" ]
