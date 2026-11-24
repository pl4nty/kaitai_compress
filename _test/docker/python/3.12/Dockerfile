# Dirs expected to be shared with this container:
#
# * /kaitai_compress - Kaitai Compress repo

FROM kaitai-compress-test-base-ubuntu_24.04:latest

RUN apt-get install -y --no-install-recommends \
	python3 \
	python3-venv

# Check python version
RUN python3 --version | grep -q '^Python 3\.12' && echo "Version check OK"

# Compression modules, from _test/requirements-python.txt (copied in by build-images)
COPY requirements-python.txt /
RUN python3 -m venv /venv && /venv/bin/pip install -r /requirements-python.txt
ENV PATH=/venv/bin:$PATH

WORKDIR /kaitai_compress/_test
ENTRYPOINT ["./run-python"]
