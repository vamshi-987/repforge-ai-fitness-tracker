COMPOSE ?= docker compose

.PHONY: env up down nuke logs ps migrate backend-venv backend-lint backend-test backend-check \
        backend-test-integration

env:
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

## Docker stack ---------------------------------------------------------------
up: env
	$(COMPOSE) up -d --build --wait

down:
	$(COMPOSE) down

# Also deletes the postgres / redis / minio volumes.
nuke:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f --tail=100 api worker beat

ps:
	$(COMPOSE) ps

migrate:
	$(COMPOSE) exec api alembic upgrade head

## Backend (runs from backend/.venv) ------------------------------------------
backend-venv:
	$(MAKE) -C backend venv

backend-lint:
	$(MAKE) -C backend lint

backend-test:
	$(MAKE) -C backend test

backend-check:
	$(MAKE) -C backend check

backend-test-integration: env
	$(MAKE) -C backend test-integration
