FROM wordpress:php8.3-apache

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssh-server default-mysql-client less \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /run/sshd \
	&& useradd -m -s /bin/bash studio \
	&& echo 'studio:studio' | chpasswd \
	&& usermod -aG www-data studio \
	&& sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
	&& sed -i 's/^#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
	&& curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp-cli.phar \
	&& chmod +x /usr/local/bin/wp-cli.phar

COPY entrypoint.sh /usr/local/bin/studio-ssh-entrypoint
COPY wp /usr/local/bin/wp
RUN chmod +x /usr/local/bin/studio-ssh-entrypoint /usr/local/bin/wp

ENTRYPOINT [ "studio-ssh-entrypoint" ]
CMD [ "apache2-foreground" ]
