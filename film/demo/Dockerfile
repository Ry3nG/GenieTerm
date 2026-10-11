FROM python:3.11-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        openssh-server procps less nano curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128 \
    && pip install --no-cache-dir tensorboard numpy packaging psutil ninja einops setuptools wheel
RUN useradd -m -s /bin/bash ml && mkdir -p /home/ml/.ssh /run/sshd
COPY authorized_keys /home/ml/.ssh/authorized_keys
COPY bashrc-extra /tmp/bashrc-extra
COPY llm /home/ml/llm
RUN cat /tmp/bashrc-extra >> /home/ml/.bashrc && chown -R ml:ml /home/ml \
    && chmod 700 /home/ml/.ssh && chmod 600 /home/ml/.ssh/authorized_keys \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
CMD ["/usr/sbin/sshd", "-D", "-e"]
