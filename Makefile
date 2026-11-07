COMPOSE ?= docker compose

.PHONY: setup env mobile-env up down nuke logs ps migrate seed backend-venv backend-lint backend-test \
        backend-check backend-test-integration mobile-install mobile-check mobile-start check

# First command after a fresh clone: env files, backend/.venv and mobile packages. Safe to repeat.
setup: env mobile-env backend-venv mobile-install
	@echo "Setup done. Next: make up && make migrate && make seed"

env:
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

mobile-env:
	@test -f mobile/.env.local || (cp mobile/.env.example mobile/.env.local && echo "created mobile/.env.local from mobile/.env.example")

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

# Load or update the exercise library; safe to run every time.
seed:
	$(COMPOSE) exec api python -m app.commands.seed

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

## Mobile (pnpm) -------------------------------------------------------------
mobile-install:
	cd mobile && pnpm install

mobile-check:
	cd mobile && pnpm lint && pnpm typecheck && pnpm test

# --go: with expo-dev-client installed, plain `expo start` targets a development build.
mobile-start:
	cd mobile && pnpm start --go

## Everything that must be green before merging to main
check: backend-check mobile-check
