# PostgreSQL 16 with pgvector, on the SAME alpine base the data was created on.
#
# The obvious move is pgvector/pgvector:pg16, but that image is Debian-based.
# This database was initialised under alpine with collation en_US.utf8 and the
# libc provider, and musl's en_US.utf8 does not sort identically to glibc's —
# every text btree index would be subtly wrong until a full REINDEX. Staying on
# alpine avoids the problem instead of repairing it.
FROM postgres:16-alpine

ARG PGVECTOR_VERSION=v0.8.0

RUN set -eux; \
    apk add --no-cache --virtual .build-deps build-base git; \
    git clone --branch "$PGVECTOR_VERSION" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector; \
    cd /tmp/pgvector; \
    # with_llvm=no skips the JIT bitcode, which needs a matching clang that
    # this alpine release does not package. pgvector runs fine without it.
    make OPTFLAGS="" with_llvm=no; \
    make install with_llvm=no; \
    cd /; rm -rf /tmp/pgvector; \
    apk del .build-deps
