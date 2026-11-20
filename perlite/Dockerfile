FROM php:fpm-alpine

LABEL maintainer="sec77 https://github.com/secure-77/Perlite"

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

# mbstring (Perlite and Parsedown use mb_* functions): the official image
# stopped compiling it in from PHP 8.6 (docker-library/php#1654), so build it.
# oniguruma stays installed because the extension links against it.
RUN apk add --no-cache oniguruma \
 && apk add --no-cache --virtual .mbstring-build-deps $PHPIZE_DEPS oniguruma-dev \
 && (php -m | grep -qi '^mbstring$' || docker-php-ext-install -j"$(nproc)" mbstring) \
 && apk del .mbstring-build-deps \
 && php -m | grep -qi '^mbstring$'

WORKDIR /var/www/perlite/
COPY ./index.php ./
COPY ./helper.php ./
COPY ./content.php ./
COPY ./leaflet.php ./
COPY ./*.svg ./
COPY ./*.ico ./
COPY ./.styles/ ./.styles/
COPY ./.js/ ./.js/
COPY ./.src/ ./.src/
COPY ./vendor/ ./vendor/

VOLUME /var/www/perlite/

EXPOSE 9000
