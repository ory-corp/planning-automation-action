SHELL=/bin/bash

.PHONY: deps
deps:
	npm install @actions/github @actions/core
	ls test/.secrets || echo "GITHUB_TOKEN=\"change_me\"" > test/.secrets
	ls test/.env || cp test/.env.sample test/.env
	act --version || brew install act

.PHONY: test
test: deps
	rm -rf test/.github/actions/planning-automation-action
	mkdir -p test/.github/actions/planning-automation-action/graphql
	cp -Rf graphql test/.github/actions/planning-automation-action/
	cp -f action.js test/.github/actions/planning-automation-action/
	cp -f action.yml test/.github/actions/planning-automation-action/
	cd test && ./test.sh
