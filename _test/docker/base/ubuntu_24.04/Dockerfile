# Base image - vanilla Ubuntu 24.04 with some fixes

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Universal requirements for all CI scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates \
	locales

# Fix locales
RUN \
	echo 'en_US.UTF-8 UTF-8' >/etc/locale.gen && \
	echo 'LANG="en_US.UTF-8"' >/etc/default/locale && \
	dpkg-reconfigure --frontend=noninteractive locales

ENV LANG=en_US.UTF-8
