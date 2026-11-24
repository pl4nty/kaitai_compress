# Dirs expected to be shared with this container:
#
# * /kaitai_compress - Kaitai Compress repo

FROM kaitai-compress-test-base-ubuntu_24.04:latest

# Ruby plus what native gems need to build and load
RUN apt-get install -y --no-install-recommends \
	ruby \
	ruby-dev \
	build-essential \
	zlib1g-dev \
	libsnappy-dev \
	liblzma-dev \
	libbz2-dev \
	libssl-dev

# Check ruby version
RUN ruby --version | grep -q '^ruby 3\.2' && echo "Version check OK"

# Test and compression gems, from _test/Gemfile (copied in by build-images)
COPY Gemfile /
ENV BUNDLE_GEMFILE=/Gemfile
RUN gem install bundler && bundle install

WORKDIR /kaitai_compress/_test
ENTRYPOINT ["bundle", "exec", "./run-ruby"]
