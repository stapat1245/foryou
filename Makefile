PYTHON ?= python3
IMAGE ?= rose-bouquet
CONTAINER ?= rose-bouquet
PORT ?= 8080

DATA_STAMP := web/data/.built

.PHONY: help deps assets check-data serve docker-build docker-run docker-up docker-down up down restart logs clean

help:
	@printf '%s\n' \
		'  make assets       bake the animation frames for the web page' \
		'  make serve        serve the page at http://localhost:$(PORT)' \
		'  make docker-build build the Docker image' \
		'  make docker-run   build and run the container in the foreground' \
		'  make up           build and run the container in the background' \
		'  make down         stop the background container' \
		'  make restart      stop and start the container again' \
		'  make logs         follow the container logs' \
		'  make clean        remove generated frame data'

deps:
	$(PYTHON) -m pip install -r requirements.txt

$(DATA_STAMP): rose_bouquet.py tools/export_web.py
	$(PYTHON) tools/export_web.py --out web/data
	@touch $(DATA_STAMP)

assets: $(DATA_STAMP)

serve: assets
	@printf 'Rose bouquet: http://localhost:%s\n' '$(PORT)'
	$(PYTHON) -m http.server $(PORT) --directory web

check-data:
	@if [ ! -s web/data/frames.bin.gz ] || [ ! -s web/data/meta.json ]; then \
		echo "error: missing web/data; run make assets or copy the pre-built frames" >&2; \
		exit 1; \
	fi

docker-build: check-data
	docker build -t $(IMAGE) .

docker-run: docker-build
	-docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run --rm --name $(CONTAINER) -p $(PORT):80 $(IMAGE)

up: docker-build
	-docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run -d --rm --name $(CONTAINER) -p $(PORT):80 $(IMAGE)
	@printf 'Rose bouquet: http://localhost:%s\n' '$(PORT)'

down:
	-docker stop $(CONTAINER) >/dev/null 2>&1 || true

restart:
	$(MAKE) down
	$(MAKE) up

logs:
	docker logs -f $(CONTAINER)

clean:
	rm -rf web/data

docker-up: up

docker-down: down
