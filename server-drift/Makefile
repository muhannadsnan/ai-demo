# Thin wrapper over docker compose. The point is not to hide the commands —
# `make help` prints them — but to make the common operations impossible to get
# subtly wrong at 23:00 when something is down.

COMPOSE := docker compose
SHA     := $(shell git rev-parse --short HEAD 2>/dev/null || echo local)

.DEFAULT_GOAL := help
.PHONY: help up down restart build deploy logs ps health shell version rollback

help:  ## Show this help
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up:  ## Start everything in the background
	$(COMPOSE) up -d

down:  ## Stop everything (volumes are preserved)
	$(COMPOSE) down

restart:  ## Restart the app only, leaving the proxy and its certificates alone
	$(COMPOSE) restart app

build:  ## Build the image, tagged with the current git SHA
	APP_VERSION=$(SHA) $(COMPOSE) build

deploy:  ## Build and roll out the current commit
	APP_VERSION=$(SHA) $(COMPOSE) up -d --build
	@echo "deployed $(SHA)"

rollback:  ## Roll back to a previous image: make rollback VERSION=abc1234
	@test -n "$(VERSION)" || (echo "usage: make rollback VERSION=<sha>"; exit 1)
	APP_VERSION=$(VERSION) $(COMPOSE) up -d --no-build
	@echo "rolled back to $(VERSION)"

logs:  ## Follow application logs
	$(COMPOSE) logs -f --tail=100 app

ps:  ## Show container status and health
	$(COMPOSE) ps

health:  ## Ask the running app which AI backend is wired up
	@$(COMPOSE) exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"

shell:  ## Open a shell in the app container
	$(COMPOSE) exec app sh

version:  ## Show which image tag is actually running
	@$(COMPOSE) ps --format '{{.Service}}\t{{.Image}}'
