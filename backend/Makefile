# All Python tooling runs from backend/.venv — nothing is installed globally.
PYTHON ?= python3.12
VENV   ?= .venv
BIN    := $(VENV)/bin
# Written only after a full install, so a failed install or a changed pyproject.toml reruns it.
STAMP  := $(VENV)/.installed
SERVICES_COVERAGE ?= 95

# Keep the shell's Python settings away from the venv: a global PYTHONPATH would shadow its
# packages, and pip's user mode (from the environment or pip.conf) fails inside a venv.
unexport PYTHONPATH PYTHONHOME VIRTUAL_ENV PIP_TARGET PIP_PREFIX
export PIP_USER := 0

.PHONY: venv lint format test test-unit test-integration check migrate seed revision run

venv: $(STAMP)

# Every command below depends on this, so a fresh clone gets its venv on the first one it runs.
$(STAMP): pyproject.toml
	@$(PYTHON) -c 'import sys; sys.exit(sys.version_info[:2] != (3, 12))' 2>/dev/null || \
		(echo "Python 3.12 is required. Install it with 'pyenv install 3.12.3', or pass PYTHON=/path/to/python3.12." && exit 1)
	$(PYTHON) -m venv --clear $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e '.[dev]'
	$(BIN)/pip check
	@touch $(STAMP)

lint: $(STAMP)
	$(BIN)/ruff check .
	$(BIN)/ruff format --check .
	$(BIN)/mypy

format: $(STAMP)
	$(BIN)/ruff check --fix .
	$(BIN)/ruff format .

# Full suite (unit + integration) with the coverage gate: services must stay at >= 95%.
# Needs `make up` from the repo root: API tests run against the real Postgres test database.
test: $(STAMP)
	$(BIN)/pytest --cov --cov-report=term
	$(BIN)/coverage report --include='app/services/*' --fail-under=$(SERVICES_COVERAGE)

# Fast subset that needs no external services.
test-unit: $(STAMP)
	$(BIN)/pytest -m "not integration"

# Integration tests only (postgres + redis + a Celery worker reachable on localhost).
test-integration: $(STAMP)
	$(BIN)/pytest -m integration

check: lint test

migrate: $(STAMP)
	$(BIN)/alembic upgrade head

# Load or update the exercise library (idempotent).
seed: $(STAMP)
	$(BIN)/python -m app.commands.seed

revision: $(STAMP)
	@test -n "$(m)" || (echo 'usage: make revision m="describe change"' && exit 1)
	$(BIN)/alembic revision --autogenerate -m "$(m)"

run: $(STAMP)
	$(BIN)/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
