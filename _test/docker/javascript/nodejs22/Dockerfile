# Dirs expected to be shared with this container:
#
# * /kaitai_compress - Kaitai Compress repo

FROM kaitai-compress-test-base-ubuntu_24.04:latest

# Ubuntu's nodejs package is too old; use the official build.
ENV NODE_VERSION=22
RUN apt-get install -y --no-install-recommends curl xz-utils && \
	curl -fsSL "https://nodejs.org/dist/latest-v${NODE_VERSION}.x/SHASUMS256.txt" -o /tmp/SHASUMS256.txt && \
	TARBALL=$(grep -o "node-v[0-9.]*-linux-x64.tar.xz" /tmp/SHASUMS256.txt | head -1) && \
	curl -fsSL "https://nodejs.org/dist/latest-v${NODE_VERSION}.x/$TARBALL" -o "/tmp/$TARBALL" && \
	(cd /tmp && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -) && \
	tar -xJf "/tmp/$TARBALL" -C /usr/local --strip-components=1 && \
	rm /tmp/*.tar.xz /tmp/SHASUMS256.txt && \
	node --version | grep -q "^v${NODE_VERSION}\." && echo "Version check OK"

# Compression routines dependencies - generates /node_modules in container root
COPY package.json /
RUN npm install

ENV JAVASCRIPT_MODULES_DIR=/node_modules
WORKDIR /kaitai_compress/_test
ENTRYPOINT ["./run-javascript"]
