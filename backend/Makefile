# All Python tooling runs from backend/.venv — nothing is installed globally.
PYTHON ?= python3.12
VENV   ?= .venv
BIN    := $(VENV)/bin
SERVICES_COVERAGE ?= 95

.PHONY: venv lint format test test-unit test-integration check migrate revision run

venv:
	$(PYTHON) -m venv $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e '.[dev]'

lint:
	$(BIN)/ruff check .
	$(BIN)/ruff format --check .
	$(BIN)/mypy

format:
	$(BIN)/ruff check --fix .
	$(BIN)/ruff format .

# Full suite (unit + integration) with the coverage gate: services must stay at >= 95%.
# Needs `make up` from the repo root: API tests run against the real Postgres test database.
test:
	$(BIN)/pytest --cov --cov-report=term
	$(BIN)/coverage report --include='app/services/*' --fail-under=$(SERVICES_COVERAGE)

# Fast subset that needs no external services.
test-unit:
	$(BIN)/pytest -m "not integration"

# Integration tests only (postgres + redis + a Celery worker reachable on localhost).
test-integration:
	$(BIN)/pytest -m integration

check: lint test

migrate:
	$(BIN)/alembic upgrade head

revision:
	@test -n "$(m)" || (echo 'usage: make revision m="describe change"' && exit 1)
	$(BIN)/alembic revision --autogenerate -m "$(m)"

run:
	$(BIN)/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
