FROM node:22

RUN apt-get update && apt-get install -y \
    iputils-ping \
    iproute2 \
    unixodbc \
    jq \
    curl \
    tini \
 && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
    cron \
    && rm -rf /var/lib/apt/lists/*

# INSTALL AZ CLI
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

# Configurar cron job (¡sin touch /etc/environment!)
RUN echo "*/1 * * * * root . /etc/environment && bash /etc/croncheck/check_users.sh > /proc/1/fd/1 2>/proc/1/fd/2" > /etc/cron.d/check-users-cron && \
    chmod 0644 /etc/cron.d/check-users-cron

RUN echo "*/5 * * * * root . /etc/environment && bash /etc/croncheck/purgue_logs.sh > /proc/1/fd/1 2>/proc/1/fd/2" > /etc/cron.d/purgue_logs  && \
    chmod 0644 /etc/cron.d/purgue_logs
RUN echo "holaaaaaaaaaaaagfsfdgsdfgsfdgsaaaadddda"

WORKDIR /home/dbgate-docker
COPY . .

RUN ["chmod", "+x", "/home/dbgate-docker/entrypoint.sh"]

EXPOSE 3000
VOLUME /root/.dbgate

ENTRYPOINT ["tini", "--"]
CMD ["/home/dbgate-docker/entrypoint.sh"]
